const assert = require('assert')
const {
  findLegacyCurrentTrainingRecord,
  isCurrentTrainingRecord,
  isRequestedVersionedTrainingContent,
  selectPreferredCurrentTrainingRecords
} = require('../cloudfunctions/cloudApi/training-content-compat')

const legacy = {
  contentId: 'reading-day-1',
  category: 'reading',
  day: 1,
  content: '旧版完整正文'
}

assert.strictEqual(isCurrentTrainingRecord(legacy), true, '旧记录缺少状态字段时应视为当前内容')
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, active: false }), false)
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, visible: false }), false)
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, status: 'archived' }), false)
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, status: 'inactive' }), false)
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, status: 'deleted' }), false)
assert.strictEqual(isCurrentTrainingRecord({ ...legacy, status: 'disabled' }), false)

assert.strictEqual(
  isRequestedVersionedTrainingContent('reading-v4-day-1', 'reading', 1),
  true
)
assert.strictEqual(
  isRequestedVersionedTrainingContent('reading-v4-day-1', 'retelling', 1),
  false,
  '分类不一致时禁止迁移兜底'
)

const fallback = findLegacyCurrentTrainingRecord([legacy], {
  requestedContentId: 'reading-v4-day-1',
  category: 'reading',
  day: 1
})
assert.strictEqual(fallback.contentId, 'reading-day-1')

const noHistoryFallback = findLegacyCurrentTrainingRecord([legacy], {
  requestedContentId: 'reading-day-404',
  category: 'reading',
  day: 1
})
assert.strictEqual(noHistoryFallback, null, '非 v4 当前请求不得按同 Day 回退')

const v4 = {
  ...legacy,
  contentId: 'reading-v4-day-1',
  content: 'v4 正文',
  status: 'published',
  active: true,
  visible: true
}
const selected = selectPreferredCurrentTrainingRecords([
  legacy,
  v4,
  { ...legacy, contentId: 'reading-day-2', day: 2, active: false },
  { ...legacy, contentId: 'reading-day-3', day: 3, status: 'archived' },
  { ...legacy, contentId: 'topic-day-1', category: 'topic', day: 1 }
])
assert.strictEqual(selected.filter(item => item.category === 'reading').length, 1)
assert.strictEqual(selected.find(item => item.category === 'reading').contentId, 'reading-v4-day-1')
assert.strictEqual(selected.find(item => item.category === 'topic').contentId, 'topic-day-1')

console.log('[check-training-content-legacy-compat] PASS')
