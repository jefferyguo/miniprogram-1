#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  assertSubmissionReferenceUnchanged,
  buildCloudVerification,
  buildMigrationPlan,
  buildSubmissionReferencePlan,
  createCanonicalIndexes,
  submissionPlanSignature,
  validateCanonical
} = require('./migrate-training-contents-0728')

const ROOT = path.resolve(__dirname, '..')
const canonical = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'data', 'import', '0728-final', 'canonical-training-contents.json'),
  'utf8'
))

function asCloudRecord(item, overrides = {}) {
  return {
    _id: overrides._id || item.contentId,
    ...item,
    category: item.moduleId,
    version: item.contentVersion,
    ...overrides
  }
}

function run() {
  const summary = validateCanonical(canonical)
  assert.strictEqual(summary.total, 966)
  assert.strictEqual(summary.permanentIds, 966)

  const initialPlan = buildMigrationPlan(canonical, [], {
    strategy: 'initial-import',
    migrationId: 'fixture-initial'
  })
  assert.strictEqual(initialPlan.summary.create, 966)
  assert.strictEqual(initialPlan.summary.update, 0)
  assert.strictEqual(initialPlan.summary.conflicts, 0)

  const imported = initialPlan.upserts.map(action => asCloudRecord(action.after, { _id: action.contentId }))
  const verification = buildCloudVerification(canonical, imported)
  assert.strictEqual(verification.verified, true, verification.errors.join('\n'))

  const secondPlan = buildMigrationPlan(canonical, imported, {
    strategy: 'sync',
    migrationId: 'fixture-second'
  })
  assert.strictEqual(secondPlan.summary.changeCount, 0)
  assert.strictEqual(secondPlan.summary.conflicts, 0)

  const readingDay5 = canonical.find(item => item.moduleId === 'reading' && item.day === 5)
  assert.ok(readingDay5)
  const withoutDay5 = imported.filter(item => item.contentId !== readingDay5.contentId)
  const legacyDay5 = asCloudRecord(readingDay5, {
    _id: 'legacy-reading-day-5',
    contentId: 'reading-v4-day-5'
  })
  const legacyPlan = buildMigrationPlan(canonical, withoutDay5.concat(legacyDay5), {
    strategy: 'sync',
    migrationId: 'fixture-legacy'
  })
  assert.ok(legacyPlan.upserts.some(item => item.contentId === readingDay5.contentId && item.action === 'create'))
  assert.ok(legacyPlan.deletions.some(item => item.recordId === legacyDay5._id && item.action === 'delete_legacy'))
  assert.strictEqual(legacyPlan.conflicts.length, 0)

  const adminLegacyDuplicate = asCloudRecord(readingDay5, {
    _id: 'admin-legacy-reading-day-5',
    contentId: 'reading-custom-legacy-day-5',
    title: '旧管理端标题',
    updateSource: 'admin',
    isCustom: true
  })
  const inactiveAdminTombstone = {
    _id: 'admin-deleted-test-record',
    contentId: 'reading-custom-deleted-test',
    category: 'reading',
    day: 999,
    sortOrder: 999,
    title: 'a',
    content: '测试内容',
    status: 'deleted',
    visible: false,
    updateSource: 'admin',
    isCustom: true
  }
  const guardedAdminCleanupPlan = buildMigrationPlan(
    canonical,
    imported.concat(adminLegacyDuplicate, inactiveAdminTombstone),
    { strategy: 'sync', migrationId: 'fixture-guarded-admin-cleanup' }
  )
  assert.ok(guardedAdminCleanupPlan.conflicts.some(item => item.recordId === adminLegacyDuplicate._id))
  assert.ok(guardedAdminCleanupPlan.deletions.some(item => item.recordId === inactiveAdminTombstone._id && item.preservedInAudit))

  const exactDashboardEdit = imported.map(item => item.contentId === readingDay5.contentId
    ? { ...item, content: `${item.content}\n网页管理端补充`, updateSource: 'dashboard_web', contentVersion: 4, version: 4 }
    : item)
  const dashboardConflictPlan = buildMigrationPlan(canonical, exactDashboardEdit, {
    strategy: 'sync',
    migrationId: 'fixture-dashboard-conflict'
  })
  assert.ok(dashboardConflictPlan.conflicts.some(item => item.code === 'NEWER_ADMIN_EDIT'))

  const newerCloudRecord = imported.map(item => item.contentId === readingDay5.contentId
    ? { ...item, content: `${item.content}\n云端较新修订`, updateSource: 'api_sync', contentVersion: 8, version: 8 }
    : item)
  const newerCloudConflictPlan = buildMigrationPlan(canonical, newerCloudRecord, {
    strategy: 'sync',
    migrationId: 'fixture-newer-cloud-conflict'
  })
  assert.ok(newerCloudConflictPlan.conflicts.some(item => item.code === 'NEWER_CLOUD_VERSION'))

  const unmatchedActiveAdmin = {
    ...inactiveAdminTombstone,
    _id: 'admin-active-unmatched-record',
    contentId: 'reading-custom-active-unmatched',
    status: 'published',
    visible: true
  }
  const unmatchedAdminPlan = buildMigrationPlan(canonical, imported.concat(unmatchedActiveAdmin), {
    strategy: 'sync',
    migrationId: 'fixture-unmatched-admin'
  })
  assert.ok(unmatchedAdminPlan.conflicts.some(item => item.code === 'UNRESOLVED_ADMIN_RECORD'))

  const adminEdited = imported.map(item => item.contentId === readingDay5.contentId
    ? { ...item, title: `${item.title}（管理端修订）`, updateSource: 'admin', contentVersion: 9, version: 9 }
    : item)
  const conflictPlan = buildMigrationPlan(canonical, adminEdited, {
    strategy: 'sync',
    migrationId: 'fixture-conflict'
  })
  assert.ok(conflictPlan.conflicts.some(item => item.code === 'NEWER_ADMIN_EDIT'))

  const forcedPlan = buildMigrationPlan(canonical, adminEdited, {
    strategy: 'force',
    migrationId: 'fixture-force'
  })
  assert.strictEqual(forcedPlan.conflicts.length, 0)
  assert.ok(forcedPlan.upserts.some(item => item.contentId === readingDay5.contentId))

  const indexes = createCanonicalIndexes(canonical)
  const submissionPlan = buildSubmissionReferencePlan([
    {
      _id: 'submission-mapped',
      sourceType: 'main',
      moduleId: 'reading',
      day: 5,
      contentId: 'reading-day-5',
      taskId: 'reading-day-5',
      taskTitle: readingDay5.title
    },
    {
      _id: 'submission-snapshot-only',
      sourceType: 'main',
      moduleId: 'reading',
      contentId: 'reading-v4-day-999',
      taskId: 'reading-v4-day-999',
      taskTitle: '无法唯一匹配的历史文章',
      trainingContentSnapshot: '历史正文快照'
    }
  ], indexes)
  const mapped = submissionPlan.actions.find(item => item.recordId === 'submission-mapped')
  const snapshotOnly = submissionPlan.actions.find(item => item.recordId === 'submission-snapshot-only')
  assert.strictEqual(mapped.contentId, readingDay5.contentId)
  assert.strictEqual(snapshotOnly.contentId, '')
  assert.strictEqual(snapshotOnly.data.trainingReferenceStatus, 'historical_snapshot_only')
  assert.doesNotThrow(() => assertSubmissionReferenceUnchanged(mapped.before, { ...mapped.before }, mapped.recordId))
  assert.throws(
    () => assertSubmissionReferenceUnchanged(mapped.before, { ...mapped.before, contentId: 'reading-day-6' }, mapped.recordId),
    error => error && error.code === 'MIGRATION_CONCURRENT_MODIFICATION'
  )
  assert.throws(
    () => assertSubmissionReferenceUnchanged(mapped.before, null, mapped.recordId),
    error => error && error.code === 'MIGRATION_CONCURRENT_MODIFICATION'
  )
  const changedSubmissionPlan = buildSubmissionReferencePlan([
    { ...mapped.before, contentId: 'reading-day-6', taskId: 'reading-day-6' },
    snapshotOnly.before
  ], indexes)
  assert.notStrictEqual(
    submissionPlanSignature(submissionPlan),
    submissionPlanSignature(changedSubmissionPlan),
    '作品引用在 dry-run 后变化时必须使迁移计划签名失效'
  )

  console.log('TRAINING_MIGRATION_FIXTURES_PASS')
  console.log(JSON.stringify({
    canonicalTotal: summary.total,
    initialCreate: initialPlan.summary.create,
    secondApplyChangeCount: secondPlan.summary.changeCount,
    legacyDeleteCount: legacyPlan.summary.deleteLegacy,
    guardedAdminConflictCount: guardedAdminCleanupPlan.conflicts.length,
    dashboardConflictCount: dashboardConflictPlan.conflicts.length,
    adminConflictCount: conflictPlan.summary.conflicts,
    submissionReferenceUpdates: submissionPlan.actions.length,
    submissionConcurrencyGuard: true
  }, null, 2))
}

run()
