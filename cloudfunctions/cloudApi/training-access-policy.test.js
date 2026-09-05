const assert = require('node:assert/strict')
const test = require('node:test')

const {
  computeModuleAccessPolicy,
  hasValidMembership: hasValidCloudMembership,
  toDisplayTrainingPosition
} = require('./training-access-policy')
const {
  hasValidMembership: hasValidClientMembership
} = require('../../utils/training-access-policy')

test('零基权限位置映射为学员端连续 Day 1..N', () => {
  const records = [100, 300, 700, 900].map((sortOrder, index) => ({
    contentId: `tc_${String(index + 1).padStart(32, '0')}`,
    sortOrder,
    status: 'active',
    active: true,
    visible: true
  }))
  const policy = computeModuleAccessPolicy(records)

  assert.deepEqual(policy.map(item => item.policyPosition), [0, 1, 2, 3])
  assert.deepEqual(policy.map(item => toDisplayTrainingPosition(item.policyPosition)), [1, 2, 3, 4])
  assert.deepEqual(policy.map(item => item.effectiveMembershipLevel), ['free', 'free', 'free', 'member'])
})

test('无效权限位置不生成虚假 Day', () => {
  assert.equal(toDisplayTrainingPosition(-1), 0)
  assert.equal(toDisplayTrainingPosition('invalid'), 0)
})

test('会员日期按上海时区的自然日边界失效', () => {
  const originalNow = Date.now
  const originalTimezone = process.env.TZ
  try {
    process.env.TZ = 'UTC'
    Date.now = () => Date.parse('2026-08-10T15:59:59Z')
    for (const hasValidMembership of [hasValidCloudMembership, hasValidClientMembership]) {
      assert.equal(hasValidMembership({
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipEndAt: '2026-08-10'
      }), true)
    }

    Date.now = () => Date.parse('2026-08-10T16:00:00Z')
    for (const hasValidMembership of [hasValidCloudMembership, hasValidClientMembership]) {
      assert.equal(hasValidMembership({
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipEndAt: '2026-08-10'
      }), false)
    }
  } finally {
    Date.now = originalNow
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  }
})
