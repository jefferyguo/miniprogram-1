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
const {
  getVersionedContentId,
  planCategoryImport
} = require('./import-reading-retelling-to-cloud')

const ROOT_DIR = path.resolve(__dirname, '..')

function testHistoricalResolution() {
  const archived = {
    contentId: 'reading-day-1',
    category: 'reading',
    day: 1,
    title: '旧版 Day 1',
    content: '旧版原文',
    status: 'archived',
    active: false
  }
  const archivedResult = resolveHistoricalOriginal({
    contentId: 'reading-day-1',
    category: 'reading',
    day: 1
  }, archived)
  assert.equal(archivedResult.found, true)
  assert.equal(archivedResult.source, 'training_contents_exact')
  assert.equal(archivedResult.content.content, '旧版原文')

  const wrongSameDay = resolveHistoricalOriginal({
    contentId: 'reading-day-1',
    category: 'reading',
    day: 1
  }, {
    contentId: 'reading-v4-day-1',
    category: 'reading',
    day: 1,
    content: '新版同 Day 原文'
  })
  assert.equal(wrongSameDay.found, false)
  assert.equal(wrongSameDay.message, HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE)

  const snapshot = createTrainingSnapshot({
    contentId: 'reading-v4-day-1',
    day: 1,
    displayTitle: '新版标题',
    material: '作品保存时的原文'
  }, 'reading')
  const snapshotResult = resolveHistoricalOriginal({
    ...snapshot,
    contentId: 'reading-v4-day-1'
  }, {
    contentId: 'reading-v4-day-1',
    content: '后来修改的云端正文'
  })
  assert.equal(snapshotResult.source, 'submission_snapshot')
  assert.equal(snapshotResult.content.content, '作品保存时的原文')

  assert.equal(getTrainingLocator({ category: 'reading', day: 1 }).canView, false)
  assert.equal(getTrainingLocator({ contentId: 'speech-v4-day-56' }).moduleId, 'speech')
}

function testImportPlan() {
  const incoming = [{
    contentId: getVersionedContentId('reading', 1),
    category: 'reading',
    day: 1,
    title: '新版',
    content: '新版正文'
  }]
  const firstPlan = planCategoryImport([
    {
      _id: 'legacy-with-id',
      contentId: 'reading-day-1',
      category: 'reading',
      day: 1,
      status: 'published',
      active: true,
      visible: true
    },
    {
      _id: 'legacy-without-id',
      category: 'reading',
      day: 2,
      status: 'active',
      active: true,
      visible: true
    }
  ], incoming)
  assert.equal(firstPlan.upserts.filter(entry => !entry.old).length, 1)
  assert.deepEqual(firstPlan.archive.map(item => item._id).sort(), ['legacy-with-id', 'legacy-without-id'])

  const secondPlan = planCategoryImport([
    {
      _id: 'new-v4',
      ...incoming[0],
      status: 'published',
      active: true,
      visible: true
    },
    {
      _id: 'legacy-with-id',
      contentId: 'reading-day-1',
      category: 'reading',
      status: 'archived',
      active: false,
      visible: false
    }
  ], incoming)
  assert.equal(secondPlan.upserts.filter(entry => !entry.old).length, 0)
  assert.equal(secondPlan.archive.length, 0)
}

function testSubmissionSnapshotWiring() {
  const taskDetail = fs.readFileSync(path.join(ROOT_DIR, 'pages/task-detail/task-detail.js'), 'utf8')
  const localData = fs.readFileSync(path.join(ROOT_DIR, 'utils/local-data.js'), 'utf8')
  const cloudApi = fs.readFileSync(path.join(ROOT_DIR, 'cloudfunctions/cloudApi/index.js'), 'utf8')
  assert.match(taskDetail, /\.\.\.trainingSnapshot/)
  assert.match(localData, /trainingContentSnapshot:\s*normalizedDraft\.trainingContentSnapshot/)
  assert.doesNotMatch(taskDetail, /getTaskByModuleAndContentId\(moduleId, contentId\)\s*\|\|\s*getTaskByModuleAndDay/)
  assert.match(cloudApi, /trainingContentSnapshot:\s*work\.trainingContentSnapshot/)
  assert.match(cloudApi, /case 'getTrainingContentById'/)
}

testHistoricalResolution()
testImportPlan()
testSubmissionSnapshotWiring()

console.log('[check-training-history] 通过', {
  archivedExactLookup: true,
  sameDayFallbackBlocked: true,
  snapshotPriority: true,
  missingContentIdArchived: true,
  importIdempotent: true,
  submissionSnapshotWired: true
})
