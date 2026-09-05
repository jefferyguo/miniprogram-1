const assert = require('assert')
const {
  clearCloudTrainingContents,
  getTaskByModuleAndContentId,
  isTrainingContentComplete,
  normalizeTrainingContentId,
  setCloudTrainingContents,
  upsertCloudTrainingContent
} = require('../utils/training-data')

try {
  clearCloudTrainingContents('reading')

  // Permanent IDs are stable — normalizeTrainingContentId should pass them through
  // 永久 ID 直通：不再转换旧格式
  const pid = 'tc_12341234123412341234123412341234'
  assert.equal(normalizeTrainingContentId(pid), pid)

  // Find first article in reading module by its permanent ID
  const modules = require('../utils/training-data').getTrainingModules()
  const readingMod = modules.find(m => m.id === 'reading')
  assert.ok(readingMod && readingMod.days.length === 216, 'reading module has 216 articles')
  const firstArticle = readingMod.days[0]
  const firstId = firstArticle.contentId

  // Verify the permanent ID is stable and unique
  assert.ok(/^tc_[0-9a-f]{32}$/.test(firstId), `permanent ID format tc_<32hex>: ${firstId}`)

  // getTaskByModuleAndContentId works with permanent IDs
  const canonical = getTaskByModuleAndContentId('reading', firstId)
  assert.ok(canonical, `canonical ID ${firstId} must resolve`)
  assert.equal(canonical.contentId, firstId)

  // Local index must not include full content body
  assert.equal(isTrainingContentComplete(canonical), false, 'local index must not include full body')

  // Permanent ID lookup works with local data (no cloud needed for basic resolution)
  clearCloudTrainingContents('reading')
  const localResolved = getTaskByModuleAndContentId('reading', firstId)
  assert.equal(localResolved.contentId, firstId, 'permanent ID must resolve from local index')
  assert.equal(isTrainingContentComplete(localResolved), false, 'local index has no full body')

  // Legacy ID does not resolve to permanent ID content (migration needed)
  clearCloudTrainingContents('reading')
  const oldFormatResult = getTaskByModuleAndContentId('reading', 'reading-day-1')
  // Old format IDs should not resolve — permanent IDs are the only valid lookup
  assert.strictEqual(oldFormatResult, null, 'old format IDs must not resolve without migration')

  // Different contentId must not be confused
  clearCloudTrainingContents('reading')
  setCloudTrainingContents([{
    contentId: firstId,
    category: 'reading',
    sourceIndex: 2,
    sortOrder: 2,
    title: 'Different article',
    content: 'Different content body.',
    membershipLevel: 'free'
  }], { category: 'reading' })
  // Query by a DIFFERENT permanent ID should not return this
  const otherArticle = readingMod.days[1]
  if (otherArticle && otherArticle.contentId !== firstId) {
    const other = getTaskByModuleAndContentId('reading', otherArticle.contentId)
    assert.equal(isTrainingContentComplete(other), false,
      'Different contentId should not resolve cloud body incorrectly')
  }

  clearCloudTrainingContents('reading')
  console.log('[check-training-content-id-consistency] PASS')
} catch (error) {
  console.error('[check-training-content-id-consistency] FAIL:', error.message)
  process.exitCode = 1
}
