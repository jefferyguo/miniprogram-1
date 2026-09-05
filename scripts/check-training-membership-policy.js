/**
 * 训练会员权限最终审计
 *
 * 验证：
 * 1. 权限仅由 active 列表排序位置（index）决定
 * 2. Day/dayNumber/sourceIndex/存储的membershipLevel 永不参与权限计算
 * 3. 排序稳定（sortOrder + contentId tie-breaker）
 * 4. 单条详情无列表上下文时 fail-closed 为 member
 * 5. 前后端 computeModuleAccessPolicy 结果一致
 * 6. sortOrder 间隙/重复/缺失时仍恰好前三篇免费
 */
const assert = require('assert')

const frontendPolicy = require('../utils/training-access-policy')
const cloudPolicy = require('../cloudfunctions/cloudApi/training-access-policy')

const { computeModuleAccessPolicy, resolveSingleItemPolicy, compareTrainingPosition } = frontendPolicy
const cloudCompute = cloudPolicy.computeModuleAccessPolicy
const cloudResolve = cloudPolicy.resolveSingleItemPolicy

// ——— 1. sortOrder 为 10/20/30/40 时前三篇免费 ———
console.log('1. sortOrder 为 10/20/30/40 时前三篇免费')
const gapped = [
  { contentId: 'a', sortOrder: 10, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 20, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 30, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 40, status: 'active', active: true, visible: true }
]
const gappedResult = computeModuleAccessPolicy(gapped)
assert.strictEqual(gappedResult[0].effectiveMembershipLevel, 'free', 'sortOrder=10 → 位置0 → free')
assert.strictEqual(gappedResult[1].effectiveMembershipLevel, 'free', 'sortOrder=20 → 位置1 → free')
assert.strictEqual(gappedResult[2].effectiveMembershipLevel, 'free', 'sortOrder=30 → 位置2 → free')
assert.strictEqual(gappedResult[3].effectiveMembershipLevel, 'member', 'sortOrder=40 → 位置3 → member')
assert.strictEqual(gappedResult[0].policyPosition, 0)
assert.strictEqual(gappedResult[3].policyPosition, 3)
console.log('   PASS')

// ——— 2. sortOrder 为 1/2/4/5 时前三篇免费 ———
console.log('2. sortOrder 为 1/2/4/5 时前三篇免费（间隙不影响位置）')
const withGap = [
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 4, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 5, status: 'active', active: true, visible: true }
]
const gapResult = computeModuleAccessPolicy(withGap)
assert.strictEqual(gapResult[0].effectiveMembershipLevel, 'free', 'sortOrder=1 → 位置0 → free')
assert.strictEqual(gapResult[1].effectiveMembershipLevel, 'free', 'sortOrder=2 → 位置1 → free')
assert.strictEqual(gapResult[2].effectiveMembershipLevel, 'free', 'sortOrder=4 → 位置2 → free（非 ≤3 判断!）')
assert.strictEqual(gapResult[3].effectiveMembershipLevel, 'member', 'sortOrder=5 → 位置3 → member')
console.log('   PASS')

// ——— 3. sortOrder 重复时仍恰好前三篇免费 ———
console.log('3. sortOrder 重复时仍恰好前三篇免费（稳定 tie-breaker）')
const dupes = [
  { contentId: 'c', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 1, status: 'active', active: true, visible: true }
]
const dupeResult = computeModuleAccessPolicy(dupes)
// 稳定排序：sortOrder相同 → 按 contentId 字母序
assert.strictEqual(dupeResult[0].contentId, 'a')
assert.strictEqual(dupeResult[1].contentId, 'b')
assert.strictEqual(dupeResult[2].contentId, 'c')
assert.strictEqual(dupeResult[3].contentId, 'd')
// 前三篇 free
assert.strictEqual(dupeResult[0].effectiveMembershipLevel, 'free')
assert.strictEqual(dupeResult[1].effectiveMembershipLevel, 'free')
assert.strictEqual(dupeResult[2].effectiveMembershipLevel, 'free')
assert.strictEqual(dupeResult[3].effectiveMembershipLevel, 'member')
// 免费数量恰好为 3
assert.strictEqual(dupeResult.filter(i => i.effectiveMembershipLevel === 'free').length, 3)
console.log('   PASS')

// ——— 4. sortOrder 缺失时使用稳定排序且不使用 Day ———
console.log('4. sortOrder 缺失时使用稳定排序（fallback 0 + contentId tie-breaker）')
const missing = [
  { contentId: 'c', status: 'active', active: true, visible: true },
  { contentId: 'a', sortOrder: 0, status: 'active', active: true, visible: true },
  { contentId: 'b', status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 0, status: 'active', active: true, visible: true }
]
const missResult = computeModuleAccessPolicy(missing)
// 全部 sortOrder=0，按 contentId 字母序
assert.strictEqual(missResult[0].contentId, 'a')
assert.strictEqual(missResult[1].contentId, 'b')
assert.strictEqual(missResult[2].contentId, 'c')
assert.strictEqual(missResult[3].contentId, 'd')
// 前三 free
assert.strictEqual(missResult[0].effectiveMembershipLevel, 'free')
assert.strictEqual(missResult[1].effectiveMembershipLevel, 'free')
assert.strictEqual(missResult[2].effectiveMembershipLevel, 'free')
assert.strictEqual(missResult[3].effectiveMembershipLevel, 'member')
console.log('   PASS')

// ——— 5. day=1 但实际排第4时必须 member ———
console.log('5. day=1 但实际排第4时必须 member')
const dayTrap = [
  { contentId: 'a', sortOrder: 1, day: 10, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, day: 20, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, day: 30, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, day: 1, status: 'active', active: true, visible: true } // day=1!
]
const dayTrapResult = computeModuleAccessPolicy(dayTrap)
assert.strictEqual(dayTrapResult[3].contentId, 'd')
assert.strictEqual(dayTrapResult[3].day, 1)
assert.strictEqual(dayTrapResult[3].effectiveMembershipLevel, 'member',
  'day=1 但在第4位 → 必须是 member')
console.log('   PASS')

// ——— 6. day=100 但实际排第1时必须 free ———
console.log('6. day=100 但实际排第1时必须 free')
const dayFree = [
  { contentId: 'a', sortOrder: 1, day: 100, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, day: 2, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, day: 3, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, day: 4, status: 'active', active: true, visible: true }
]
const dayFreeResult = computeModuleAccessPolicy(dayFree)
assert.strictEqual(dayFreeResult[0].day, 100)
assert.strictEqual(dayFreeResult[0].effectiveMembershipLevel, 'free',
  'day=100 但在第1位 → 必须是 free')
console.log('   PASS')

// ——— 7. 单条详情无 policyPosition 时默认 member ———
console.log('7. 单条详情无 policyPosition 时默认 member')
const noPolicy = resolveSingleItemPolicy({ sortOrder: 1, day: 1 })
assert.strictEqual(noPolicy.policyPosition, -1, '无上下文 → policyPosition=-1')
assert.strictEqual(noPolicy.effectiveMembershipLevel, 'member', '无上下文 → fail-closed member')
assert.strictEqual(noPolicy.requiresMembership, true)
// Cloud 端同样
const cloudNoPolicy = cloudResolve({ sortOrder: 1, day: 1 })
assert.strictEqual(cloudNoPolicy.effectiveMembershipLevel, 'member')
console.log('   PASS')

// ——— 8. 有 policyPosition 时正确解析 ———
console.log('8. 有 policyPosition 时正确解析')
const withPolicy = resolveSingleItemPolicy({
  sortOrder: 1, day: 100,
  policyPosition: 0, accessPolicyVersion: 1
})
assert.strictEqual(withPolicy.policyPosition, 0)
assert.strictEqual(withPolicy.effectiveMembershipLevel, 'free')
assert.strictEqual(withPolicy.requiresMembership, false)

const withPolicyMember = resolveSingleItemPolicy({
  sortOrder: 4, day: 1,
  policyPosition: 3, accessPolicyVersion: 1
})
assert.strictEqual(withPolicyMember.effectiveMembershipLevel, 'member')
assert.strictEqual(withPolicyMember.requiresMembership, true)
console.log('   PASS')

// ——— 9. Cloud 旧 membershipLevel='free' 不能覆盖第4篇 ———
console.log('9. Cloud 旧 membershipLevel=\'free\' 不能覆盖第4篇')
const oldData = [
  { contentId: 'a', sortOrder: 1, membershipLevel: 'free', status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, membershipLevel: 'free', status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, membershipLevel: 'free', status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, membershipLevel: 'free', status: 'active', active: true, visible: true }, // 旧值为 free!
  { contentId: 'e', sortOrder: 5, membershipLevel: 'free', status: 'active', active: true, visible: true }
]
const oldDataResult = computeModuleAccessPolicy(oldData)
assert.strictEqual(oldDataResult[3].effectiveMembershipLevel, 'member',
  'Cloud旧值free被位置覆盖为member')
assert.strictEqual(oldDataResult[4].effectiveMembershipLevel, 'member',
  'Cloud旧值free被位置覆盖为member')
// 前三的 membershipLevel 字段仍为 'free'（来自原始数据），但 effectiveMembershipLevel 为 'free'
assert.strictEqual(oldDataResult[0].membershipLevel, 'free')
assert.strictEqual(oldDataResult[0].effectiveMembershipLevel, 'free')
// 第4篇原始 membershipLevel='free'，但 effectiveMembershipLevel='member'
assert.strictEqual(oldDataResult[3].membershipLevel, 'free')
assert.strictEqual(oldDataResult[3].effectiveMembershipLevel, 'member')
console.log('   PASS')

// ——— 10. 每个模块免费数量 = min(3, activeCount) ———
console.log('10. 每个模块免费数量 = min(3, activeCount)')
// 0 篇 active
assert.strictEqual(computeModuleAccessPolicy([]).length, 0)
// 1 篇
const one = computeModuleAccessPolicy([{ contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true }])
assert.strictEqual(one.filter(i => i.effectiveMembershipLevel === 'free').length, 1)
assert.strictEqual(one.filter(i => i.effectiveMembershipLevel === 'member').length, 0)
// 2 篇
const two = computeModuleAccessPolicy([
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, status: 'active', active: true, visible: true }
])
assert.strictEqual(two.filter(i => i.effectiveMembershipLevel === 'free').length, 2)
// 3 篇
const three = computeModuleAccessPolicy([
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, status: 'active', active: true, visible: true }
])
assert.strictEqual(three.filter(i => i.effectiveMembershipLevel === 'free').length, 3)
// 6 篇
const six = computeModuleAccessPolicy([
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, status: 'active', active: true, visible: true },
  { contentId: 'e', sortOrder: 5, status: 'active', active: true, visible: true },
  { contentId: 'f', sortOrder: 6, status: 'active', active: true, visible: true }
])
assert.strictEqual(six.filter(i => i.effectiveMembershipLevel === 'free').length, 3)
assert.strictEqual(six.filter(i => i.effectiveMembershipLevel === 'member').length, 3)
console.log('   PASS')

// ——— 11. 前后端 computeModuleAccessPolicy 结果一致 ———
console.log('11. 前后端 computeModuleAccessPolicy 结果一致')
const testSet = [
  { contentId: 'x1', sortOrder: 5, day: 100, membershipLevel: 'free', status: 'active', active: true, visible: true },
  { contentId: 'x2', sortOrder: 3, day: 200, membershipLevel: 'member', status: 'active', active: true, visible: true },
  { contentId: 'x3', sortOrder: 10, day: 1, membershipLevel: 'free', status: 'active', active: true, visible: true },
  { contentId: 'x4', sortOrder: 1, day: 50, membershipLevel: 'free', status: 'active', active: true, visible: true }
]
const frontResult = computeModuleAccessPolicy(testSet)
const cloudResult = cloudCompute(testSet)
assert.strictEqual(frontResult.length, cloudResult.length, '前后端结果数量一致')
for (let i = 0; i < frontResult.length; i++) {
  assert.strictEqual(frontResult[i].policyPosition, cloudResult[i].policyPosition,
    `位置${i} policyPosition不一致`)
  assert.strictEqual(frontResult[i].effectiveMembershipLevel, cloudResult[i].effectiveMembershipLevel,
    `位置${i} effectiveMembershipLevel不一致`)
  assert.strictEqual(frontResult[i].requiresMembership, cloudResult[i].requiresMembership,
    `位置${i} requiresMembership不一致`)
}
console.log('   PASS')

// ——— 12. inactive 内容不参与排序 ———
console.log('12. inactive 内容不参与排序')
const mixedActive = [
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, status: 'archived', active: false, visible: false },
  { contentId: 'c', sortOrder: 3, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, status: 'deleted', active: false, visible: false },
  { contentId: 'e', sortOrder: 5, status: 'active', active: true, visible: true }
]
const mixedResult = computeModuleAccessPolicy(mixedActive)
assert.strictEqual(mixedResult.length, 3, '仅3篇active')
assert.strictEqual(mixedResult[0].contentId, 'a', '第1篇active=a')
assert.strictEqual(mixedResult[1].contentId, 'c', '第2篇active=c')
assert.strictEqual(mixedResult[2].contentId, 'e', '第3篇active=e')
assert.strictEqual(mixedResult[0].effectiveMembershipLevel, 'free')
assert.strictEqual(mixedResult[1].effectiveMembershipLevel, 'free')
assert.strictEqual(mixedResult[2].effectiveMembershipLevel, 'free')
console.log('   PASS')

// ——— 13. 排序稳定性验证 ———
console.log('13. 排序稳定性验证（相同 sortOrder → contentId 字母序）')
const stability = [
  { contentId: 'z', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'a', sortOrder: 1, status: 'active', active: true, visible: true },
  { contentId: 'm', sortOrder: 1, status: 'active', active: true, visible: true }
]
const stableResult = computeModuleAccessPolicy(stability)
assert.strictEqual(stableResult[0].contentId, 'a')
assert.strictEqual(stableResult[1].contentId, 'm')
assert.strictEqual(stableResult[2].contentId, 'z')
console.log('   PASS')

// ——— 14. resolveSingleItemPolicy 拒绝旧版本 policyPosition ———
console.log('14. resolveSingleItemPolicy 拒绝旧版本 policyPosition')
const oldVersion = resolveSingleItemPolicy({
  sortOrder: 1, policyPosition: 0, accessPolicyVersion: 0 // 旧版本
})
assert.strictEqual(oldVersion.effectiveMembershipLevel, 'member',
  '旧accessPolicyVersion → fail-closed member')
console.log('   PASS')

// ——— 15. 本地 training-data 模块权限正确 ———
console.log('15. 本地 training-data 模块权限正确（每个模块前3篇free）')
const { getTrainingModules } = require('../utils/training-data')
getTrainingModules().forEach(mod => {
  // 按 policyPosition 排序
  const sorted = mod.days.slice().sort((a, b) =>
    (a.policyPosition ?? a.sortOrder ?? 0) - (b.policyPosition ?? b.sortOrder ?? 0)
  )
  for (let i = 0; i < sorted.length; i++) {
    const expected = i < 3 ? 'free' : 'member'
    assert.strictEqual(sorted[i].membershipLevel, expected,
      `${mod.id} 位置${i} (${sorted[i].contentId}): 应为${expected}，实为${sorted[i].membershipLevel}`)
  }
})
console.log('   PASS')

// ——— 16. day/sourceIndex 不在权限函数路径中 ———
console.log('16. day=/sourceIndex= 均不影响权限')
// 验证：即使 item 有 day=1 和 sourceIndex=1，sortOrder 大的仍为 member
const dayOnly = { sortOrder: 10, day: 1, sourceIndex: 1, status: 'active', active: true, visible: true }
const dayOnlyResult = computeModuleAccessPolicy([dayOnly])
assert.strictEqual(dayOnlyResult[0].effectiveMembershipLevel, 'free',
  '仅有1篇 active → 位置0 → free')
// 但如果有其他文章排在前面...
const dayBehind = [
  { contentId: 'a', sortOrder: 1, day: 100, status: 'active', active: true, visible: true },
  { contentId: 'b', sortOrder: 2, day: 99, status: 'active', active: true, visible: true },
  { contentId: 'c', sortOrder: 3, day: 98, status: 'active', active: true, visible: true },
  { contentId: 'd', sortOrder: 4, day: 1, sourceIndex: 1, status: 'active', active: true, visible: true }
]
const behindResult = computeModuleAccessPolicy(dayBehind)
assert.strictEqual(behindResult[3].day, 1)
assert.strictEqual(behindResult[3].sourceIndex, 1)
assert.strictEqual(behindResult[3].effectiveMembershipLevel, 'member',
  'day=1且sourceIndex=1 但在位置3 → member')
console.log('   PASS')

console.log('\n[check-training-membership-policy] all cases passed')
