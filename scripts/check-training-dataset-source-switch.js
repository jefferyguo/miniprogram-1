/**
 * 训练数据集源切换验证：复现并修复 552 项 bug + 季度购买启用。
 */
const assert = require('assert')

const storage = {}
global.wx = {
  getStorageSync(k) { return storage[k] },
  setStorageSync(k, v) { storage[k] = v },
  removeStorageSync(k) { delete storage[k] }
}

const {
  clearCloudTrainingContents,
  getModuleById,
  getTrainingModules,
  setCloudTrainingContents,
  isTrainingContentComplete,
  normalizeTrainingContentId
} = require('../utils/training-data')

const { FEATURE_FLAGS } = require('../utils/feature-flags')
const productsCloud = require('../cloudfunctions/cloudApi/membership-products')
const productsUtils = require('../utils/membership-products')

let pass = 0, fail = 0
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error(`  FAIL ${name}: ${e.message}`) }
}

// ===== 问题复现：本地 + 云端旧数据 = 552 ====
console.log('\n=== 数据集重复 bug 复现与修复 ===')

// 1. 本地 topic 276 篇
check('1. 本地 topic = 276', () => {
  clearCloudTrainingContents()
  const mod = getModuleById('topic')
  assert.strictEqual(mod.days.length, 276, `local topic should be 276, got ${mod.days.length}`)
})

// 2. 模拟云端返回旧格式 ID 的 topic 数据
const oldCloudData = []
for (let i = 1; i <= 276; i++) {
  oldCloudData.push({
    contentId: `topic-day-${i}`,
    category: 'topic',
    day: i, sortOrder: i,
    title: `旧标题 Day ${i}`,
    content: `旧正文内容 Day ${i}，来自旧版 CloudBase 数据。`,
    membershipLevel: i <= 3 ? 'free' : 'member',
    status: 'published', active: true, visible: true
  })
}

check('2. 云端旧数据被整批拒绝（total=276，不是552）', () => {
  clearCloudTrainingContents()
  setCloudTrainingContents(oldCloudData, { category: 'topic' })
  const mod = getModuleById('topic')
  assert.strictEqual(mod.days.length, 276, `Should be 276 (cloud rejected), got ${mod.days.length}`)
  // 标题应为本地 canonical 标题，不是旧标题
  assert.ok(!mod.days.some(d => d.title && d.title.startsWith('旧标题')), 'Old titles must not appear')
})

// 3. 云端新旧混合被整批拒绝
check('3. 云端新旧混合被整批拒绝', () => {
  clearCloudTrainingContents()
  const mixed = [...oldCloudData.slice(0, 100), {
    contentId: 'tc_00001111222233334444555566667777',
    category: 'topic', day: 1, sortOrder: 1,
    title: '混合标题', content: '混合正文',
    membershipLevel: 'free', status: 'published', active: true, visible: true
  }]
  setCloudTrainingContents(mixed, { category: 'topic' })
  const mod = getModuleById('topic')
  assert.strictEqual(mod.days.length, 276, `Mixed dataset rejected, should be 276`)
})

// 4. 批量旧格式数据（>500 records with -day-N IDs）被整批拒绝
check('4. 批量旧格式数据被整批拒绝', () => {
  clearCloudTrainingContents()
  // Simulate CloudBase returning 500+ old-format records
  const largeOldBatch = []
  for (let i = 1; i <= 550; i++) {
    largeOldBatch.push({
      contentId: `topic-day-${i}`,
      category: 'topic', day: i, sortOrder: i,
      title: `Old ${i}`, content: `Old content ${i}`,
      membershipLevel: i <= 3 ? 'free' : 'member',
      status: 'published', active: true, visible: true
    })
  }
  setCloudTrainingContents(largeOldBatch, { category: 'topic' })
  const mod = getModuleById('topic')
  assert.strictEqual(mod.days.length, 276, `Large old-format batch rejected, should stay 276`)
})

// 5. 同 Day 不重复
check('5. 同 Day 不出现两条', () => {
  clearCloudTrainingContents()
  const mod = getModuleById('topic')
  const days = mod.days.map(d => d.day)
  assert.strictEqual(new Set(days).size, days.length, 'No duplicate days')
})

// 6. 进度统计使用唯一数据集
check('6. 进度总数为模块真实数量', () => {
  clearCloudTrainingContents()
  const modules = getTrainingModules()
  const expected = { topic: 276, reading: 216, leaderSpeech: 24, retell: 257, speech: 116, mandarin: 77 }
  modules.forEach(m => {
    assert.strictEqual(m.totalDays, expected[m.id], `${m.id}: progress total=${m.totalDays}, expected=${expected[m.id]}`)
  })
})

// 7. 清空后恢复
check('7. clearCloudTrainingContents 恢复本地', () => {
  clearCloudTrainingContents('topic')
  const mod = getModuleById('topic')
  assert.strictEqual(mod.days.length, 276)
})

// ===== 季度购买启用 =====
console.log('\n=== 季度购买验证 ===')

check('8. quarterlyPurchaseEnabled = true', () => {
  assert.strictEqual(FEATURE_FLAGS.quarterlyPurchaseEnabled, true)
})

check('9. 前端产品 quarterly_membership 存在', () => {
  const p = productsUtils.MEMBERSHIP_PRODUCTS.find(p => p.productId === 'quarterly_membership')
  assert.ok(p, 'quarterly_membership must exist in frontend products')
  assert.strictEqual(p.priceFen, 3990)
  assert.strictEqual(p.durationDays, 90)
})

check('10. 云函数产品 quarterly_membership 存在', () => {
  const p = productsCloud.MEMBERSHIP_PRODUCTS.find(p => p.productId === 'quarterly_membership')
  assert.ok(p, 'quarterly_membership must exist in cloud products')
  assert.strictEqual(p.priceFen, 3990)
  assert.strictEqual(p.durationDays, 90)
})

check('11. 年度会员 5990 未变', () => {
  const yc = productsCloud.MEMBERSHIP_PRODUCTS.find(p => p.productId === 'yearly_membership')
  const yu = productsUtils.MEMBERSHIP_PRODUCTS.find(p => p.productId === 'yearly_membership')
  assert.strictEqual(yc.priceFen, 5990)
  assert.strictEqual(yu.priceFen, 5990)
})

check('12. 无 QUARTERLY_PURCHASE_DISABLED 硬编码', () => {
  const fs = require('fs')
  const cloudApi = fs.readFileSync('cloudfunctions/cloudApi/index.js', 'utf8')
  assert.ok(!cloudApi.includes('QUARTERLY_PURCHASE_DISABLED'), 'Cloud hard-block must be removed')
})

// ===== 所有模块数量验证 =====
console.log('\n=== 全模块数量 ===')
check('13. 全部 6 个模块数量正确', () => {
  clearCloudTrainingContents()
  const modules = getTrainingModules()
  const expected = { topic: 276, reading: 216, leaderSpeech: 24, retell: 257, speech: 116, mandarin: 77 }
  modules.forEach(m => {
    assert.strictEqual(m.totalDays, expected[m.id], `${m.id}: ${m.totalDays} !== ${expected[m.id]}`)
  })
  const total = modules.reduce((s, m) => s + m.totalDays, 0)
  assert.strictEqual(total, 966)
})

// ===== 最终 =====
console.log(`\n=== 最终 ===`)
console.log(`PASS: ${pass}, FAIL: ${fail}`)
if (fail > 0) process.exit(1)
else console.log('TRAINING_DATASET_FLASHBACK_FIXED\nTRAINING_VISIBLE_COUNTS_CORRECT\nQUARTERLY_PURCHASE_CODE_ENABLED')
