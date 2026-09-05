#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
  createTrainingSnapshot,
  getTrainingLocator,
  resolveHistoricalOriginal
} = require('../utils/training-original')
const { buildMigrationPlan } = require('./migrate-training-contents-0728')

const ROOT_DIR = path.resolve(__dirname, '..')
const canonical = JSON.parse(fs.readFileSync(
  path.join(ROOT_DIR, 'data/import/0728-final/canonical-training-contents.json'),
  'utf8'
))
const readingDay1 = canonical.find(item => item.moduleId === 'reading' && item.day === 1)
const readingDay2 = canonical.find(item => item.moduleId === 'reading' && item.day === 2)

function testHistoricalResolution() {
  const archived = {
    ...readingDay1,
    status: 'inactive',
    active: false
  }
  const archivedResult = resolveHistoricalOriginal({
    contentId: readingDay1.contentId,
    category: 'reading',
    day: 1
  }, archived)
  assert.equal(archivedResult.found, true)
  assert.equal(archivedResult.source, 'training_contents_exact')
  assert.equal(archivedResult.content.content, readingDay1.content)

  const wrongSameDay = resolveHistoricalOriginal({
    contentId: readingDay1.contentId,
    category: 'reading',
    day: 1
  }, {
    ...readingDay2,
    day: 1
  })
  assert.equal(wrongSameDay.found, false)
  assert.equal(wrongSameDay.message, HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE)

  const metadata = createTrainingSnapshot({
    contentId: readingDay1.contentId,
    day: 1,
    displayTitle: '作品保存时的标题'
  }, 'reading')
  const snapshotResult = resolveHistoricalOriginal({
    ...metadata,
    contentId: readingDay1.contentId,
    trainingContentSnapshot: '作品保存时已有的历史正文'
  }, {
    ...readingDay1,
    content: '后来修改的云端正文'
  })
  assert.equal(snapshotResult.source, 'submission_snapshot')
  assert.equal(snapshotResult.content.content, '作品保存时已有的历史正文')

  assert.equal(getTrainingLocator({ category: 'reading', day: 1 }).canView, false)
  assert.equal(getTrainingLocator({ contentId: readingDay1.contentId, category: 'reading' }).canView, true)
  assert.equal(getTrainingLocator({ contentId: 'reading-day-1', category: 'reading' }).canView, false)
}

function testImportPlan() {
  const legacyRecord = {
    _id: 'legacy-reading-day-1',
    contentId: 'reading-day-1',
    category: 'reading',
    moduleId: 'reading',
    day: 1,
    sortOrder: 1,
    title: readingDay1.title,
    content: readingDay1.content,
    status: 'published',
    active: true,
    visible: true,
    updateSource: 'controlled_import'
  }
  const migrationPlan = buildMigrationPlan(canonical, [legacyRecord], {
    migrationId: 'history-test'
  })
  assert.equal(migrationPlan.conflicts.length, 0)
  assert.ok(migrationPlan.upserts.some(item => item.contentId === readingDay1.contentId))
  assert.ok(migrationPlan.deletions.some(item => (
    item.recordId === legacyRecord._id &&
    item.mappedContentId === readingDay1.contentId
  )))

  const adminEdited = {
    ...readingDay1,
    _id: readingDay1.contentId,
    title: '管理员保留标题',
    updateSource: 'admin',
    contentVersion: Number(readingDay1.contentVersion || 1) + 1,
    version: Number(readingDay1.contentVersion || 1) + 1
  }
  const guardedPlan = buildMigrationPlan(canonical, [adminEdited], {
    migrationId: 'history-admin-guard'
  })
  assert.ok(guardedPlan.conflicts.some(item => (
    item.code === 'NEWER_ADMIN_EDIT' && item.contentId === readingDay1.contentId
  )))
  assert.equal(
    guardedPlan.upserts.some(item => item.contentId === readingDay1.contentId),
    false,
    '默认同步不得覆盖管理员修改'
  )

  const idempotentPlan = buildMigrationPlan(canonical, canonical, {
    migrationId: 'history-idempotency'
  })
  assert.equal(idempotentPlan.summary.changeCount, 0)
  assert.equal(idempotentPlan.unchanged.length, 966)
  assert.equal(idempotentPlan.conflicts.length, 0)
}

function testSubmissionReferenceWiring() {
  const taskDetail = fs.readFileSync(path.join(ROOT_DIR, 'pages/task-detail/task-detail.js'), 'utf8')
  const localData = fs.readFileSync(path.join(ROOT_DIR, 'utils/local-data.js'), 'utf8')
  const cloudApi = fs.readFileSync(path.join(ROOT_DIR, 'cloudfunctions/cloudApi/index.js'), 'utf8')

  assert.match(taskDetail, /contentId,\s*\n\s*taskId:\s*contentId/)
  assert.match(taskDetail, /\.\.\.trainingSnapshot/)
  assert.doesNotMatch(taskDetail, /getTaskByModuleAndContentId\(moduleId, contentId\)\s*\|\|\s*getTaskByModuleAndDay/)
  assert.match(localData, /trainingContentSnapshot:\s*normalizedDraft\.trainingContentSnapshot/)
  assert.match(cloudApi, /trainingContentSnapshot:\s*work\.trainingContentSnapshot/)
  assert.match(cloudApi, /case 'getTrainingContentById'/)
}

testHistoricalResolution()
testImportPlan()
testSubmissionReferenceWiring()

console.log('[check-training-history] 通过', {
  permanentExactLookup: true,
  sameDayFallbackBlocked: true,
  snapshotPriority: true,
  oldRuntimeIdRejected: true,
  migrationAdminGuard: true,
  migrationIdempotent: true,
  submissionReferenceWired: true
})
