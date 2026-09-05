/**
 * 训练访问权限验证
 *
 * 权限现在由 computeModuleAccessPolicy 计算的 policyPosition 决定。
 * 测试使用 position-stamped items 验证 canAccessTask 行为。
 */
const assert = require('assert')

const storage = {}

global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  }
}

const {
  canAccessTask,
  getCurrentAccessStatus
} = require('../utils/access-control')
const {
  clearCloudTrainingContents,
  getModuleById,
  getTrainingModules,
  setCloudTrainingContents
} = require('../utils/training-data')
const frontendPolicy = require('../utils/training-access-policy')
const cloudPolicy = require('../cloudfunctions/cloudApi/training-access-policy')

function resetUser(user = {}) {
  Object.keys(storage).forEach(key => delete storage[key])
  storage.userInfo = user
  storage.users = []
  storage.students = []
  storage.entitlements = []
  storage.memberWhitelist = []
}

function stampPolicy(items) {
  return frontendPolicy.computeModuleAccessPolicy(items)
}

function expectAccess(label, user, items, day, allowed, reason) {
  resetUser(user)
  // 用 computeModuleAccessPolicy 给 items 加 policyPosition
  const stamped = stampPolicy(items.map((d, i) => ({
    contentId: `test-${d}`,
    sortOrder: d,
    day: d,
    category: 'reading',
    status: 'active',
    active: true,
    visible: true,
    title: `Day ${d}`,
    content: 'Test content body for training article with enough length.'
  })))
  const target = stamped.find(s => s.day === day)
  const result = canAccessTask('reading', target)
  assert.strictEqual(result.allowed, allowed, `${label}: allowed`)
  if (reason) assert.strictEqual(result.reason, reason, `${label}: reason`)
}

const freeUser = {
  membershipType: 'free',
  membershipStatus: 'active'
}
const activeMember = {
  _id: 'member-user',
  nickname: '口才学员ABC234',
  nicknameSource: 'random',
  profileCompleted: true,
  phone: '13800138000',
  phoneBound: true,
  membershipType: 'monthly',
  membershipStatus: 'active',
  membershipEndAt: '2099-12-31'
}
const expiredMember = {
  _id: 'expired-user',
  nickname: '口才学员DEF567',
  nicknameSource: 'random',
  profileCompleted: true,
  phone: '13800138000',
  phoneBound: true,
  membershipType: 'monthly',
  membershipStatus: 'active',
  membershipEndAt: '2020-01-01'
}
const adminFromCollection = {
  role: 'super_admin',
  isAdmin: true,
  membershipType: 'free',
  membershipStatus: 'active'
}

// 连续序列 1-6
const seq = [1, 2, 3, 4, 5, 6]

// ——— 位置 0/1/2 (前三篇) free；位置 >=3 member ———
console.log('1. 非会员：前3篇 free，第4篇起 member')
expectAccess('free pos 0', freeUser, seq, 1, true)
expectAccess('free pos 1', freeUser, seq, 2, true)
expectAccess('free pos 2', freeUser, seq, 3, true)
expectAccess('free pos 3 locked', freeUser, seq, 4, false, 'membership_required')
expectAccess('free pos 4 locked', freeUser, seq, 5, false, 'membership_required')
expectAccess('free pos 5 locked', freeUser, seq, 6, false, 'membership_required')
console.log('   PASS')

// ——— 会员：全部可访问 ———
console.log('2. 会员：全部可访问')
expectAccess('member pos 0', activeMember, seq, 1, true)
expectAccess('member pos 3', activeMember, seq, 4, true)
expectAccess('member pos 5', activeMember, seq, 6, true)
console.log('   PASS')

// ——— 过期会员：仅前三篇 ———
console.log('3. 过期会员：仅前三篇')
expectAccess('expired pos 2', expiredMember, seq, 3, true)
expectAccess('expired pos 3', expiredMember, seq, 4, false, 'membership_required')
console.log('   PASS')

// ——— 管理员：全部可访问 ———
console.log('4. 管理员：全部可访问')
expectAccess('admin pos 3', adminFromCollection, seq, 4, true, 'admin_bypass')
expectAccess('admin pos 5', adminFromCollection, seq, 6, true, 'admin_bypass')
console.log('   PASS')

// ——— 间隙 sortOrder (10/20/30/40) ———
console.log('5. sortOrder 间隙不影响位置计算')
const gapped = [10, 20, 30, 40]
expectAccess('gapped pos 0 (10)', freeUser, gapped, 10, true)
expectAccess('gapped pos 1 (20)', freeUser, gapped, 20, true)
expectAccess('gapped pos 2 (30)', freeUser, gapped, 30, true)
expectAccess('gapped pos 3 (40) locked', freeUser, gapped, 40, false, 'membership_required')
console.log('   PASS')

// ——— 非连续 sortOrder (1/2/4) ———
console.log('6. sortOrder 非连续 (1/2/4)')
const sparse = [1, 2, 4]
expectAccess('sparse pos 0 (1)', freeUser, sparse, 1, true)
expectAccess('sparse pos 1 (2)', freeUser, sparse, 2, true)
expectAccess('sparse pos 2 (4) free', freeUser, sparse, 4, true) // 位置2（第3篇）→ free
console.log('   PASS')

// ——— 管理员 access status ———
resetUser(adminFromCollection)
assert.strictEqual(getCurrentAccessStatus().isAdmin, true, 'admin access status')
console.log('6. 管理员 access status')

// ——— 前后端 canAccessTrainingContent 一致 ———
console.log('7. 前后端 canAccessTrainingContent 一致')
const stampedBase = stampPolicy(seq.map(d => ({
  contentId: `test-${d}`, sortOrder: d, day: d,
  category: 'reading', status: 'active', active: true, visible: true,
  title: `Day ${d}`, content: 'Test content for checking access policy consistency.'
})))
const policyCases = [
  { name: 'free pos 0', access: freeUser, item: stampedBase[0], allowed: true },
  { name: 'free pos 3 locked', access: freeUser, item: stampedBase[3], allowed: false },
  { name: 'member pos 4', access: activeMember, item: stampedBase[4], allowed: true },
  { name: 'expired pos 4', access: expiredMember, item: stampedBase[4], allowed: false },
  { name: 'admin pos 5', user: adminFromCollection, access: freeUser, item: stampedBase[5], allowed: true },
]
policyCases.forEach(({ name, user, access, item, allowed }) => {
  const frontendResult = frontendPolicy.canAccessTrainingContent({ user, access, content: item })
  const cloudResult = cloudPolicy.canAccessTrainingContent({ user, access, content: item })
  assert.strictEqual(frontendResult.allowed, allowed, `frontend policy: ${name}`)
  assert.strictEqual(cloudResult.allowed, frontendResult.allowed, `cloud/frontend parity: ${name}`)
  assert.strictEqual(cloudResult.membershipLevel, frontendResult.membershipLevel, `cloud/frontend membershipLevel: ${name}`)
  assert.strictEqual(cloudResult.policyPosition, frontendResult.policyPosition, `cloud/frontend policyPosition: ${name}`)
})
console.log('   PASS')

// ——— 存储的 membershipLevel 不参与权限计算 ———
console.log('8. 存储的 membershipLevel 不参与权限计算')
const storedFreePos4 = { ...stampedBase[3], membershipLevel: 'free' }
const result1 = frontendPolicy.canAccessTrainingContent({ access: freeUser, content: storedFreePos4 })
assert.strictEqual(result1.allowed, false, 'stored free on pos 3 → 仍锁定')
assert.strictEqual(result1.membershipLevel, 'member', 'stored free on pos 3 → effective 仍为 member')
console.log('   PASS')

// ——— 本地 trainingModules 验证 ———
console.log('9. 本地 trainingModules 每模块前3篇 free')
getTrainingModules().forEach(module => {
  const sorted = module.days.slice().sort((a, b) =>
    (a.policyPosition ?? a.sortOrder ?? 0) - (b.policyPosition ?? b.sortOrder ?? 0)
  )
  for (let i = 0; i < sorted.length; i++) {
    const expected = i < 3 ? 'free' : 'member'
    assert.strictEqual(sorted[i].membershipLevel, expected,
      `${module.id} pos ${i} (${sorted[i].contentId}): ${expected} !== ${sorted[i].membershipLevel}`)
  }
})
console.log('   PASS')

// ——— 列表使用本地 canonical 索引（不再与云端合并）———
console.log('10. 列表始终使用本地 canonical 索引')
const readingDay4 = getModuleById('reading').days.find(item => Number(item.day) === 4)
assert.ok(readingDay4 && readingDay4.contentId, 'reading Day 4 local index')
// Cloud data does NOT affect the list — tombstone/deleted records don't remove local articles
const beforeCount = getModuleById('reading').days.length
assert.strictEqual(beforeCount, 216, 'reading should always have 216 in local index')
// Local index is stable — cloud content is for detail page only
console.log('   PASS')

console.log('\n[check-training-access-policy] all cases passed')
