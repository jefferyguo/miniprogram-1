const assert = require('assert')
const {
  clearCloudTrainingContents,
  getTaskByModuleAndContentId,
  isTrainingContentComplete,
  setCloudTrainingContents
} = require('../utils/training-data')

function checkLegacyBodyKeepsVersionedIdentity() {
  clearCloudTrainingContents('reading')
  const local = getTaskByModuleAndContentId('reading', 'reading-v4-day-1')
  assert(local, '本地轻量索引必须包含 reading-v4-day-1')
  assert.strictEqual(isTrainingContentComplete(local), false)
  const localTitle = local.title

  setCloudTrainingContents([{
    contentId: 'reading-day-1',
    category: 'reading',
    day: 1,
    title: '旧版本 Day 1',
    content: '迁移期间允许旧记录提供完整正文，但不能改变 v4 内容索引。',
    membershipLevel: 'free'
  }], { category: 'reading' })

  const versioned = getTaskByModuleAndContentId('reading', 'reading-v4-day-1')
  assert(versioned, '旧云数据不能移除本地 versioned contentId')
  assert.strictEqual(versioned.contentId, 'reading-v4-day-1')
  assert.strictEqual(versioned.sourceContentId, 'reading-day-1')
  assert.strictEqual(versioned.legacyFallback, true)
  assert.strictEqual(versioned.title, localTitle, '迁移正文不能覆盖本地 v4 标题')
  assert.strictEqual(isTrainingContentComplete(versioned), true)

  setCloudTrainingContents([{
    contentId: 'reading-day-1',
    category: 'reading',
    day: 1,
    title: '旧版本 Day 1',
    content: '旧版本正文。'
  }, {
    contentId: 'reading-v4-day-1',
    category: 'reading',
    day: 1,
    title: localTitle,
    content: 'v4 精确正文优先。',
    status: 'published',
    active: true,
    visible: true
  }], { category: 'reading' })

  const exact = getTaskByModuleAndContentId('reading', 'reading-v4-day-1')
  assert.strictEqual(exact.material, 'v4 精确正文优先。')
  assert.notStrictEqual(exact.legacyFallback, true)
  clearCloudTrainingContents('reading')
}

try {
  checkLegacyBodyKeepsVersionedIdentity()
  console.log('[check-training-content-id-consistency] PASS')
} catch (error) {
  console.error('[check-training-content-id-consistency] FAIL:', error.message)
  process.exitCode = 1
}
