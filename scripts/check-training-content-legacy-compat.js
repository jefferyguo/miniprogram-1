const assert = require('assert')
const {
  getTrainingDay,
  isCurrentTrainingRecord,
  isPermanentTrainingContentId,
  normalizeCategory,
  requirePermanentTrainingContentId,
  selectPreferredCurrentTrainingRecords
} = require('../cloudfunctions/cloudApi/training-content-compat')

const CONTENT_ID = 'tc_4c646238524a9c643cc1a25cd2b06e96'
const OTHER_CONTENT_ID = 'tc_8c799ff0226a82073ababbedd5d71ad1'
const canonical = {
  contentId: CONTENT_ID,
  moduleId: 'reading',
  day: 1,
  sortOrder: 1,
  title: '永久 ID 正文',
  content: 'canonical 完整正文',
  status: 'active',
  active: true,
  visible: true,
  contentVersion: 2,
  updatedAt: '2026-08-01T12:00:00.000Z'
}

assert.equal(isPermanentTrainingContentId(CONTENT_ID), true)
assert.equal(isPermanentTrainingContentId('reading-day-1'), false)
assert.equal(isPermanentTrainingContentId('reading-v4-day-1'), false)
assert.equal(requirePermanentTrainingContentId(CONTENT_ID), CONTENT_ID)
assert.throws(
  () => requirePermanentTrainingContentId('reading-day-1'),
  error => error && error.code === 'INVALID_PERMANENT_CONTENT_ID'
)
assert.equal(normalizeCategory('retelling'), 'retell')
assert.equal(getTrainingDay({ day: 9, sortOrder: 3 }), 3)
assert.equal(isCurrentTrainingRecord(canonical), true)
assert.equal(isCurrentTrainingRecord({ ...canonical, status: 'inactive' }), false)

const oldRuntimeRecord = {
  ...canonical,
  contentId: 'reading-v4-day-1',
  contentVersion: 99
}
const newerExactRecord = {
  ...canonical,
  title: '同一永久 ID 的新版本',
  content: '同一永久 ID 的新正文',
  contentVersion: 3,
  updatedAt: '2026-08-01T13:00:00.000Z'
}
const anotherArticleAtSameDay = {
  ...canonical,
  contentId: OTHER_CONTENT_ID,
  title: '同 Day 的另一篇文章',
  content: '必须保持独立身份。',
  contentVersion: 1
}

const selected = selectPreferredCurrentTrainingRecords([
  oldRuntimeRecord,
  canonical,
  newerExactRecord,
  anotherArticleAtSameDay
])
assert.equal(selected.length, 2, '旧 ID 必须过滤，同 Day 的不同永久 ID 必须分别保留')
assert.equal(selected.find(item => item.contentId === CONTENT_ID).contentVersion, 3)
assert.equal(selected.find(item => item.contentId === OTHER_CONTENT_ID).title, '同 Day 的另一篇文章')
assert.equal(selected.some(item => item.contentId === 'reading-v4-day-1'), false)

console.log('[check-training-content-legacy-compat] PASS', {
  runtimeOldIdRejected: true,
  exactPermanentIdVersionSelected: true,
  sameDayDistinctContentPreserved: true,
  legacyMappingScope: 'migration_only'
})
