'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildPreRegistrationClaim,
  buildPreRegistrationCsv,
  buildPreRegistrationEntitlement,
  buildPreauthorizationRevocation,
  derivePreauthStatus,
  getPreauthorizationDocumentId,
  inspectPreauthorizationSave,
  mergeMaturedDeferredMembership,
  normalizePhone,
  redactPhoneNumbers,
  resolveTrustedBoundPhone
} = require('./pre-registration-entitlement-utils')
const { canAccessTrainingContent } = require('./training-access-policy')

const CLAIM_AT = '2026-09-20 10:30:00'

test('手机号规范化和预授权文档 ID 稳定', () => {
  assert.equal(normalizePhone('138 1234 5678'), '13812345678')
  assert.equal(
    getPreauthorizationDocumentId('138 1234 5678'),
    getPreauthorizationDocumentId('13812345678')
  )
  assert.equal(resolveTrustedBoundPhone({ phone: '138 1234 5678', phoneBound: true }), '13812345678')
  assert.equal(resolveTrustedBoundPhone({ phone: '13812345678', phoneBound: false }), '')
})

test('on_claim 预授权不提前消耗会员时长', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13812345678',
    membershipType: 'yearly',
    activationMode: 'on_claim',
    note: '线下学员'
  }, {
    operationAt: '2026-08-09 09:00:00',
    operatorOpenid: 'admin-1',
    phoneMasked: '138****5678'
  })
  assert.equal(record.membershipStartAt, '')
  assert.equal(record.membershipEndAt, null)
  assert.equal(record.durationDays, 365)
  assert.equal(record.preauthStatus, 'pending')

  const claim = buildPreRegistrationClaim(record, { membershipType: 'free' }, CLAIM_AT)
  assert.equal(claim.claimed, true)
  assert.equal(claim.membership.membershipStartAt, '2026-09-20')
  assert.equal(claim.membership.membershipEndAt, '2027-09-20')
})

test('季度 on_claim 使用 monthly 内部类型和 90 天', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13912345678',
    membershipType: 'monthly',
    activationMode: 'on_claim',
    durationDays: 14
  }, { operationAt: '2026-08-09 09:00:00' })
  assert.equal(record.durationDays, 90)
  const claim = buildPreRegistrationClaim(record, {}, CLAIM_AT)
  assert.equal(claim.membership.membershipType, 'monthly')
  assert.equal(claim.membership.membershipEndAt, '2026-12-19')
  assert.equal(canAccessTrainingContent({
    access: {
      ...claim.membership,
      membershipStartAt: '2026-01-01',
      membershipEndAt: '2027-01-01'
    },
    content: { policyPosition: 3, accessPolicyVersion: 1, status: 'active' }
  }).allowed, true)
})

test('历史 on_claim 自定义时长领取时按标准套餐周期收口', () => {
  const claim = buildPreRegistrationClaim({
    preauthStatus: 'pending',
    status: 'active',
    activationMode: 'on_claim',
    membershipType: 'yearly',
    durationDays: 30
  }, {}, CLAIM_AT)

  assert.equal(claim.claimed, true)
  assert.equal(claim.membership.membershipType, 'yearly')
  assert.equal(claim.membership.membershipEndAt, '2027-09-20')
})

test('fixed 领取保持管理员设置日期，不重新增加套餐时长', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13712345678',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: '2026-08-09',
    endDate: '2027-08-09'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {}, CLAIM_AT)
  assert.equal(claim.membership.membershipStartAt, '2026-08-09')
  assert.equal(claim.membership.membershipEndAt, '2027-08-09')
})

test('未来开始的 fixed 授权领取后保持待生效且不能提前访问', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13312345678',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: '2099-01-01',
    endDate: '2099-12-31'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {}, CLAIM_AT)
  assert.equal(claim.claimed, true)
  assert.equal(claim.membership.membershipStatus, 'scheduled')
  assert.equal(canAccessTrainingContent({
    access: claim.membership,
    content: { policyPosition: 3, accessPolicyVersion: 1, status: 'active' }
  }).allowed, false)
})

test('未来 fixed 与既有会员存在空档时不会提前填平会员权限', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13212345678',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: '2027-01-01',
    endDate: '2027-12-31'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'monthly',
    membershipStatus: 'active',
    membershipStartAt: '2026-08-01',
    membershipEndAt: '2026-10-01'
  }, CLAIM_AT)

  assert.equal(claim.claimed, true)
  assert.equal(claim.membershipApplied, false)
  assert.equal(claim.deferredActivation, true)
  assert.equal(claim.membership.membershipType, 'monthly')
  assert.equal(claim.membership.membershipEndAt, '2026-10-01')
  assert.equal(claim.entitlementPatch.membershipStatus, 'scheduled')
  assert.equal(claim.entitlementPatch.membershipStartAt, '2027-01-01')
  assert.equal(claim.entitlementPatch.membershipEndAt, '2027-12-31')
  assert.equal(claim.entitlementPatch.authorizedMembershipStartAt, '2027-01-01')
  assert.equal(claim.entitlementPatch.authorizedMembershipEndAt, '2027-12-31')
})

test('未来 fixed 遇到已有待生效会员时也保留现有排期', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13200005678',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: '2027-01-01',
    endDate: '2027-12-31'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'monthly',
    membershipStatus: 'scheduled',
    membershipStartAt: '2026-11-01',
    membershipEndAt: '2027-02-01'
  }, CLAIM_AT)

  assert.equal(claim.claimed, true)
  assert.equal(claim.membershipApplied, false)
  assert.equal(claim.deferredActivation, true)
  assert.equal(claim.membership.membershipType, 'monthly')
  assert.equal(claim.membership.membershipStartAt, '2026-11-01')
  assert.equal(claim.membership.membershipEndAt, '2027-02-01')
  assert.equal(claim.entitlementPatch.membershipType, 'yearly')
  assert.equal(claim.entitlementPatch.membershipStartAt, '2027-01-01')
})

test('deferred fixed 成熟时不会把另一个未来套餐提前生效或填平空档', () => {
  const membership = mergeMaturedDeferredMembership({
    membershipType: 'yearly',
    membershipStatus: 'scheduled',
    membershipStartAt: '2027-01-01',
    membershipEndAt: '2027-12-31'
  }, [{
    membershipType: 'monthly',
    membershipStatus: 'scheduled',
    membershipStartAt: '2026-09-01',
    membershipEndAt: '2026-11-30'
  }], '2026-09-20 10:30:00')

  assert.equal(membership.membershipType, 'monthly')
  assert.equal(membership.membershipStatus, 'active')
  assert.equal(membership.membershipStartAt, '2026-09-01')
  assert.equal(membership.membershipEndAt, '2026-11-30')
})

test('历史 Date 类型 fixed 日期会归一为上海日期键', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13200007890',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: new Date('2026-10-01T00:00:00+08:00'),
    endDate: new Date('2027-10-01T23:59:59+08:00')
  }, { operationAt: '2026-08-09 09:00:00' })

  assert.equal(record.membershipStartAt, '2026-10-01')
  assert.equal(record.membershipEndAt, '2027-10-01')
})

test('领取时已过期的 fixed 预授权不生成有效会员', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13612345678',
    membershipType: 'monthly',
    activationMode: 'fixed',
    startDate: '2026-08-01',
    endDate: '2026-08-31'
  }, { operationAt: '2026-08-01 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {}, CLAIM_AT)
  assert.equal(derivePreauthStatus(record, CLAIM_AT), 'expired')
  assert.equal(claim.claimed, false)
  assert.equal(claim.status, 'expired')
  assert.equal(claim.entitlementPatch.membershipStatus, 'expired')
})

test('重复领取 claimed 记录保持幂等', () => {
  const claim = buildPreRegistrationClaim({
    preauthStatus: 'claimed',
    activationMode: 'on_claim',
    membershipType: 'yearly',
    durationDays: 365
  }, {}, CLAIM_AT)
  assert.deepEqual(claim, { claimed: false, status: 'claimed', entitlementPatch: null })
})

test('已有有效会员领取不会缩短权益，on_claim 从当前到期日继续延长', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13512345678',
    membershipType: 'yearly',
    activationMode: 'on_claim'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'monthly',
    membershipStatus: 'active',
    membershipStartAt: '2026-08-01',
    membershipEndAt: '2026-12-31'
  }, CLAIM_AT)
  assert.equal(claim.membership.membershipType, 'yearly')
  assert.equal(claim.membership.membershipStartAt, '2026-08-01')
  assert.equal(claim.membership.membershipEndAt, '2027-12-31')
})

test('历史 Date 类型到期日领取 on_claim 后继续延长', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13112345678',
    membershipType: 'yearly',
    activationMode: 'on_claim'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'monthly',
    membershipStatus: 'active',
    membershipStartAt: new Date('2026-08-01T00:00:00+08:00'),
    membershipEndAt: new Date('2026-12-31T23:59:59+08:00')
  }, CLAIM_AT)
  assert.equal(claim.membership.membershipType, 'yearly')
  assert.equal(claim.membership.membershipEndAt, '2027-12-31')
})

test('未来 fixed 与既有会员重叠时也不会提前升级会员类型', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13012345678',
    membershipType: 'yearly',
    activationMode: 'fixed',
    startDate: '2026-10-01',
    endDate: '2027-10-01'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'monthly',
    membershipStatus: 'active',
    membershipStartAt: '2026-08-01',
    membershipEndAt: '2026-12-31'
  }, CLAIM_AT)
  assert.equal(claim.membershipApplied, false)
  assert.equal(claim.membership.membershipType, 'monthly')
  assert.equal(claim.entitlementPatch.membershipType, 'yearly')
  assert.equal(claim.entitlementPatch.membershipStatus, 'scheduled')
  assert.equal(claim.entitlementPatch.membershipStartAt, '2026-10-01')
})

test('审计文本会脱敏连续、空格和连字符手机号', () => {
  const text = redactPhoneNumbers(
    '连续13812345678 空格138 1234 5678 连字符138-1234-5678',
    phone => `${phone.slice(0, 3)}****${phone.slice(-4)}`
  )
  assert.equal(text, '连续138****5678 空格138****5678 连字符138****5678')
})

test('fixed 预授权早于既有到期日时保留既有权益', () => {
  const record = buildPreRegistrationEntitlement({
    phone: '13412345678',
    membershipType: 'monthly',
    activationMode: 'fixed',
    startDate: '2026-09-01',
    endDate: '2026-10-01'
  }, { operationAt: '2026-08-09 09:00:00' })
  const claim = buildPreRegistrationClaim(record, {
    membershipType: 'yearly',
    membershipStatus: 'active',
    membershipStartAt: '2026-01-01',
    membershipEndAt: '2027-01-01'
  }, CLAIM_AT)
  assert.equal(claim.membership.membershipType, 'yearly')
  assert.equal(claim.membership.membershipEndAt, '2027-01-01')
})

test('待注册授权 CSV 有 BOM、完整手机号且防公式注入', () => {
  const csv = buildPreRegistrationCsv([{
    phone: '13812345678',
    membershipLabel: '季度会员',
    activationMode: 'on_claim',
    activationModeLabel: '注册后激活',
    createdAt: '2026-08-09 09:00:00',
    membershipStartAt: '',
    membershipEndAt: '',
    durationDays: 90,
    statusLabel: '待注册',
    claimedAt: '',
    note: '=危险备注'
  }])
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.match(csv, /13812345678/)
  assert.match(csv, /'=危险备注/)
  assert.doesNotMatch(csv, /班级/)
})

test('已注册手机号不会创建 pending，而是返回现有用户', () => {
  assert.deepEqual(inspectPreauthorizationSave({
    registeredUser: { _id: 'user-existing' },
    samePhoneRecords: []
  }), {
    conflict: 'PHONE_ALREADY_REGISTERED',
    registeredUserId: 'user-existing'
  })
})

test('同手机号只能存在一个 active pending', () => {
  const result = inspectPreauthorizationSave({
    samePhoneRecords: [{
      _id: 'preauth-existing',
      entitlementKind: 'pre_registration',
      preauthStatus: 'pending',
      activationMode: 'on_claim'
    }],
    nowValue: CLAIM_AT
  })
  assert.equal(result.conflict, 'PREAUTH_ALREADY_EXISTS')
  assert.equal(result.entitlementId, 'preauth-existing')
})

test('已领取的预授权不能被新 pending 静默覆盖', () => {
  const result = inspectPreauthorizationSave({
    samePhoneRecords: [{
      _id: 'preauth-claimed',
      entitlementKind: 'pre_registration',
      preauthStatus: 'claimed'
    }],
    nowValue: CLAIM_AT
  })
  assert.equal(result.conflict, 'PREAUTH_ALREADY_CLAIMED')
})

test('撤销会显式终止领取资格，已领取记录不能撤销', () => {
  const patch = buildPreauthorizationRevocation({
    preauthStatus: 'pending',
    activationMode: 'on_claim'
  }, {
    operationAt: '2026-08-09 12:00:00',
    operatorOpenid: 'admin-1',
    reason: '录入错误'
  })
  assert.equal(patch.preauthStatus, 'revoked')
  assert.equal(patch.membershipStatus, 'revoked')
  assert.equal(patch.status, 'disabled')
  assert.throws(() => buildPreauthorizationRevocation({
    preauthStatus: 'claimed'
  }, {
    operationAt: '2026-08-09 12:00:00',
    reason: '不应撤销'
  }), error => error.code === 'PREAUTH_ALREADY_CLAIMED')
})
