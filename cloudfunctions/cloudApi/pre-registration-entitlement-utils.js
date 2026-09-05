'use strict'

const crypto = require('crypto')

const {
  addShanghaiDays,
  classifyMembership,
  formatShanghaiDate,
  getMembershipLabel,
  normalizeMembershipType,
  parseTimestamp,
  safeCsvCell
} = require('./user-membership-admin-utils')

const PREAUTH_KIND = 'pre_registration'
const PHONE_BINDING_LOCK_KIND = 'phone_binding_lock'
const PREAUTH_SOURCE = 'admin_preauthorization'
const PREAUTH_CLAIMED_SOURCE = 'admin_preauthorization_claimed'
const PREAUTH_STATES = new Set(['pending', 'claimed', 'revoked', 'expired'])
const ACTIVATION_MODES = new Set(['on_claim', 'fixed'])
const MEMBER_TYPES = new Set(['monthly', 'yearly'])
const DEFAULT_DURATION_DAYS = {
  monthly: 90,
  yearly: 365
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function redactPhoneNumbers(value, maskPhone) {
  const masker = typeof maskPhone === 'function'
    ? maskPhone
    : phone => `${phone.slice(0, 3)}****${phone.slice(-4)}`
  return String(value || '').replace(
    /(^|[^\d])(1(?:[\s-]?\d){10})(?!\d)/g,
    (match, prefix, phoneText) => `${prefix}${masker(normalizePhone(phoneText))}`
  )
}

function resolveTrustedBoundPhone(user = {}) {
  const phone = normalizePhone(user.phone || user.phoneNormalized)
  return user.phoneBound === true && /^1\d{10}$/.test(phone) ? phone : ''
}

function getPreauthorizationDocumentId(phoneValue) {
  const phone = normalizePhone(phoneValue)
  if (!phone) return ''
  return `preauth_${crypto.createHash('sha256').update(phone).digest('hex').slice(0, 32)}`
}

function normalizePreauthMembershipType(value) {
  const membershipType = normalizeMembershipType(value)
  if (!MEMBER_TYPES.has(membershipType)) {
    throw Object.assign(new Error('预授权会员类型只能是季度会员或年度会员。'), {
      code: 'INVALID_PREAUTH_MEMBERSHIP_TYPE'
    })
  }
  return membershipType
}

function getPreauthorizationDurationDays(membershipType) {
  return DEFAULT_DURATION_DAYS[membershipType]
}

function normalizeActivationMode(value) {
  const activationMode = String(value || 'on_claim')
  if (!ACTIVATION_MODES.has(activationMode)) {
    throw Object.assign(new Error('预授权激活方式无效。'), {
      code: 'INVALID_PREAUTH_ACTIVATION_MODE'
    })
  }
  return activationMode
}

function normalizeFixedDates(input = {}) {
  const rawStartDate = String(
    input.startDate || input.authorizedMembershipStartAt || input.membershipStartAt || ''
  ).trim()
  const rawEndDate = String(
    input.endDate || input.authorizedMembershipEndAt || input.membershipEndAt || ''
  ).trim()
  const startTimestamp = parseTimestamp(rawStartDate)
  const endTimestamp = parseTimestamp(rawEndDate, { endOfDay: true })
  if (!Number.isFinite(startTimestamp)) {
    throw Object.assign(new Error('固定授权生效日期无效。'), { code: 'INVALID_PREAUTH_START_DATE' })
  }
  if (!Number.isFinite(endTimestamp)) {
    throw Object.assign(new Error('固定授权到期日期无效。'), { code: 'INVALID_PREAUTH_END_DATE' })
  }
  if (endTimestamp <= startTimestamp) {
    throw Object.assign(new Error('固定授权到期日期必须晚于生效日期。'), {
      code: 'INVALID_PREAUTH_DATE_RANGE'
    })
  }
  const startDate = formatShanghaiDate(startTimestamp)
  const endDate = formatShanghaiDate(endTimestamp)
  return { startDate, endDate }
}

function buildPreRegistrationEntitlement(input = {}, context = {}) {
  const phone = normalizePhone(input.phone)
  if (!/^1\d{10}$/.test(phone)) {
    throw Object.assign(new Error('请输入有效的 11 位大陆手机号。'), {
      code: 'INVALID_PREAUTH_PHONE'
    })
  }
  const membershipType = normalizePreauthMembershipType(input.membershipType)
  const activationMode = normalizeActivationMode(input.activationMode)
  // 注册后激活只允许标准套餐周期，不能由客户端自定义会员天数。
  const durationDays = getPreauthorizationDurationDays(membershipType)
  const operationAt = String(context.operationAt || context.now || '')
  const existing = context.existing && typeof context.existing === 'object' ? context.existing : {}
  const fixedDates = activationMode === 'fixed' ? normalizeFixedDates(input) : null
  const note = String(input.note || input.remark || '').trim().slice(0, 300)

  return {
    entitlementKind: PREAUTH_KIND,
    preauthStatus: 'pending',
    activationMode,
    membershipType,
    authorizedMembershipType: membershipType,
    membershipLabel: getMembershipLabel(membershipType),
    durationDays,
    membershipStartAt: fixedDates ? fixedDates.startDate : '',
    membershipEndAt: fixedDates ? fixedDates.endDate : null,
    authorizedMembershipStartAt: fixedDates ? fixedDates.startDate : '',
    authorizedMembershipEndAt: fixedDates ? fixedDates.endDate : null,
    membershipStatus: 'pending',
    status: 'active',
    source: PREAUTH_SOURCE,
    phone,
    phoneNormalized: phone,
    phoneMasked: context.phoneMasked || '',
    note,
    remark: note,
    claimedAt: '',
    claimedUserId: '',
    claimedOpenid: '',
    revokedAt: '',
    revokedBy: '',
    createdAt: existing.createdAt || operationAt,
    createdBy: existing.createdBy || context.operatorOpenid || '',
    createdByName: existing.createdByName || context.operatorName || '管理员',
    createdByRole: existing.createdByRole || context.operatorRole || '',
    updatedAt: operationAt,
    updatedBy: context.operatorOpenid || '',
    updatedByName: context.operatorName || '管理员'
  }
}

function derivePreauthStatus(record = {}, nowValue = Date.now()) {
  const explicit = String(record.preauthStatus || '')
  if (explicit === 'claimed' || explicit === 'revoked' || explicit === 'expired') return explicit
  if (String(record.status || 'active') === 'disabled') return 'revoked'
  if (explicit && !PREAUTH_STATES.has(explicit)) return 'pending'
  if (String(record.activationMode || '') === 'fixed') {
    const endTimestamp = parseTimestamp(record.membershipEndAt, { endOfDay: true })
    const nowTimestamp = parseTimestamp(nowValue)
    if (Number.isFinite(endTimestamp) && Number.isFinite(nowTimestamp) && endTimestamp < nowTimestamp) {
      return 'expired'
    }
  }
  return 'pending'
}

function compareMembershipType(left, right) {
  const rank = { free: 0, monthly: 1, yearly: 2, admin: 3 }
  return (rank[normalizeMembershipType(left)] || 0) >= (rank[normalizeMembershipType(right)] || 0)
    ? normalizeMembershipType(left)
    : normalizeMembershipType(right)
}

function mergeClaimedMembership(current = {}, candidate = {}, claimAt = Date.now()) {
  const currentState = classifyMembership(current, claimAt)
  const currentType = normalizeMembershipType(current.membershipType)
  if (currentType === 'admin') {
    return {
      membershipType: 'admin',
      membershipStatus: current.membershipStatus || 'active',
      membershipStartAt: current.membershipStartAt || candidate.membershipStartAt,
      membershipEndAt: null,
      role: current.role || 'admin',
      isAdmin: true
    }
  }
  if (!currentState.isActiveMember) return candidate

  const currentEndTimestamp = parseTimestamp(current.membershipEndAt, { endOfDay: true })
  const candidateEndTimestamp = parseTimestamp(candidate.membershipEndAt, { endOfDay: true })
  return {
    membershipType: compareMembershipType(current.membershipType, candidate.membershipType),
    membershipStatus: 'active',
    membershipStartAt: current.membershipStartAt || candidate.membershipStartAt,
    membershipEndAt: currentEndTimestamp >= candidateEndTimestamp
      ? current.membershipEndAt
      : candidate.membershipEndAt,
    role: current.role || 'user',
    isAdmin: current.isAdmin === true
  }
}

function mergeMaturedDeferredMembership(current = {}, candidates = [], activationAt = Date.now()) {
  return candidates.reduce((membership, entitlement) => {
    const candidate = { ...entitlement, membershipStatus: 'active' }
    const currentState = classifyMembership(membership, activationAt)

    // 当前排期尚未开始时，不能把未来套餐提前合并到今天。
    // 排期记录仍保留在 phoneEntitlements，开始后会按真实区间生效。
    if (currentState.isScheduledMember) {
      return mergeClaimedMembership({}, candidate, activationAt)
    }
    return mergeClaimedMembership(membership, candidate, activationAt)
  }, current)
}

function buildPreRegistrationClaim(record = {}, currentMembership = {}, claimAtValue = Date.now()) {
  const status = derivePreauthStatus(record, claimAtValue)
  const claimAt = String(claimAtValue || '')
  if (status === 'expired') {
    return {
      claimed: false,
      status: 'expired',
      entitlementPatch: {
        preauthStatus: 'expired',
        membershipStatus: 'expired',
        status: 'active',
        expiredAt: claimAt,
        updatedAt: claimAt
      }
    }
  }
  if (status !== 'pending') return { claimed: false, status, entitlementPatch: null }

  const configuredType = normalizePreauthMembershipType(
    record.authorizedMembershipType || record.membershipType
  )
  // 历史记录即使残留自定义 durationDays，领取时也按当前标准套餐周期执行。
  const durationDays = getPreauthorizationDurationDays(configuredType)
  const activationMode = normalizeActivationMode(record.activationMode)
  const claimDate = formatShanghaiDate(claimAtValue)
  let candidate

  if (activationMode === 'fixed') {
    const fixedDates = normalizeFixedDates(record)
    const startsInFuture = parseTimestamp(fixedDates.startDate) > parseTimestamp(claimAtValue)
    candidate = {
      membershipType: configuredType,
      membershipStatus: startsInFuture ? 'scheduled' : 'active',
      membershipStartAt: fixedDates.startDate,
      membershipEndAt: fixedDates.endDate,
      role: 'user',
      isAdmin: false
    }
  } else {
    const currentState = classifyMembership(currentMembership, claimAtValue)
    const currentEndDate = formatShanghaiDate(currentMembership.membershipEndAt)
    const baseDate = currentState.isActiveMember && currentEndDate
      ? currentEndDate
      : claimDate
    candidate = {
      membershipType: configuredType,
      membershipStatus: 'active',
      membershipStartAt: claimDate,
      membershipEndAt: addShanghaiDays(baseDate, durationDays),
      role: 'user',
      isAdmin: false
    }
  }

  const currentState = classifyMembership(currentMembership, claimAtValue)
  const deferredActivation = activationMode === 'fixed' &&
    candidate.membershipStatus === 'scheduled' &&
    (currentState.isActiveMember || currentState.isScheduledMember)
  const membership = deferredActivation
    ? {
        membershipType: normalizeMembershipType(currentMembership.membershipType),
        membershipStatus: currentMembership.membershipStatus || 'active',
        membershipStartAt: currentMembership.membershipStartAt || '',
        membershipEndAt: currentMembership.membershipEndAt || null,
        role: currentMembership.role || 'user',
        isAdmin: currentMembership.isAdmin === true
      }
    : mergeClaimedMembership(currentMembership, candidate, claimAtValue)
  const entitlementMembership = deferredActivation ? candidate : membership
  return {
    claimed: true,
    status: 'claimed',
    membership,
    membershipApplied: !deferredActivation,
    deferredActivation,
    entitlementPatch: {
      preauthStatus: 'claimed',
      membershipStatus: entitlementMembership.membershipStatus,
      status: 'active',
      membershipType: entitlementMembership.membershipType,
      membershipLabel: getMembershipLabel(entitlementMembership.membershipType),
      membershipStartAt: entitlementMembership.membershipStartAt,
      membershipEndAt: entitlementMembership.membershipEndAt,
      authorizedMembershipStartAt: activationMode === 'fixed' ? candidate.membershipStartAt : '',
      authorizedMembershipEndAt: activationMode === 'fixed' ? candidate.membershipEndAt : null,
      deferredActivation,
      source: PREAUTH_CLAIMED_SOURCE,
      claimedAt: claimAt,
      updatedAt: claimAt
    }
  }
}

function buildPreRegistrationCsv(rows = []) {
  const headers = [
    '手机号', '套餐', '激活方式', '预授权时间', '固定开始', '固定到期',
    '持续时长（天）', '状态', '领取时间', '备注'
  ]
  const lines = [headers.map(safeCsvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.phone,
      row.membershipLabel,
      row.activationModeLabel,
      row.createdAt,
      row.activationMode === 'fixed' ? row.membershipStartAt : '',
      row.activationMode === 'fixed' ? row.membershipEndAt : '',
      row.durationDays,
      row.statusLabel,
      row.claimedAt,
      row.note
    ].map(safeCsvCell).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

function inspectPreauthorizationSave(options = {}) {
  const registeredUser = options.registeredUser || null
  const target = options.target || null
  const targetId = String(target && target._id || '')
  const records = Array.isArray(options.samePhoneRecords) ? options.samePhoneRecords : []
  const nowValue = options.nowValue || Date.now()
  if (registeredUser) {
    return {
      conflict: 'PHONE_ALREADY_REGISTERED',
      registeredUserId: String(registeredUser._id || '')
    }
  }
  if (options.requestedId && !target) return { conflict: 'PREAUTH_NOT_FOUND' }
  if (target && derivePreauthStatus(target, nowValue) !== 'pending') {
    return { conflict: 'PREAUTH_NOT_EDITABLE' }
  }
  const duplicate = records.find(item =>
    String(item.entitlementKind || '') === PREAUTH_KIND &&
    String(item._id || '') !== targetId &&
    derivePreauthStatus(item, nowValue) === 'pending'
  )
  if (duplicate) return { conflict: 'PREAUTH_ALREADY_EXISTS', entitlementId: duplicate._id }
  const claimed = records.find(item =>
    String(item.entitlementKind || '') === PREAUTH_KIND &&
    derivePreauthStatus(item, nowValue) === 'claimed'
  )
  if (!target && claimed) return { conflict: 'PREAUTH_ALREADY_CLAIMED', entitlementId: claimed._id }
  const activeNonPreauth = records.find(item =>
    String(item.entitlementKind || '') !== PREAUTH_KIND &&
    String(item.status || 'active') === 'active' &&
    String(item.membershipStatus || '') === 'active'
  )
  if (!target && activeNonPreauth) return { conflict: 'PHONE_ENTITLEMENT_ALREADY_ACTIVE' }
  return {
    conflict: '',
    reusable: target || null
  }
}

function buildPreauthorizationRevocation(record = {}, context = {}) {
  const status = derivePreauthStatus(record, context.operationAt || Date.now())
  if (status === 'claimed') {
    throw Object.assign(new Error('该授权已领取，请在现有会员管理中调整。'), {
      code: 'PREAUTH_ALREADY_CLAIMED'
    })
  }
  if (status !== 'pending') {
    throw Object.assign(new Error('该授权当前状态不能撤销。'), {
      code: 'PREAUTH_NOT_REVOCABLE'
    })
  }
  const reason = String(context.reason || '').trim().slice(0, 300)
  if (!reason) {
    throw Object.assign(new Error('请填写撤销原因。'), {
      code: 'PREAUTH_REVOKE_REASON_REQUIRED'
    })
  }
  const operationAt = String(context.operationAt || '')
  return {
    preauthStatus: 'revoked',
    membershipStatus: 'revoked',
    status: 'disabled',
    revokedAt: operationAt,
    revokedBy: String(context.operatorOpenid || ''),
    revokeReason: reason,
    updatedAt: operationAt,
    updatedBy: String(context.operatorOpenid || '')
  }
}

module.exports = {
  ACTIVATION_MODES,
  DEFAULT_DURATION_DAYS,
  PHONE_BINDING_LOCK_KIND,
  PREAUTH_CLAIMED_SOURCE,
  PREAUTH_KIND,
  PREAUTH_SOURCE,
  PREAUTH_STATES,
  buildPreRegistrationClaim,
  buildPreRegistrationCsv,
  buildPreRegistrationEntitlement,
  buildPreauthorizationRevocation,
  derivePreauthStatus,
  getPreauthorizationDocumentId,
  inspectPreauthorizationSave,
  mergeClaimedMembership,
  mergeMaturedDeferredMembership,
  normalizePhone,
  redactPhoneNumbers,
  resolveTrustedBoundPhone
}
