/**
 * 训练内容会员权限策略（Cloud 端）
 *
 * 全局硬规则：每个模块的 active 内容按 sortOrder 稳定排序后，
 * 位置 0、1、2 免费，位置 >= 3 为会员内容。
 *
 * 单个文章的权限必须从排序后的 active 列表位置（index）确定，
 * 绝不使用 day、dayNumber、sourceIndex 或存储的 membershipLevel。
 */
const ACCESS_POLICY_VERSION = 1
const FREE_TRAINING_DAYS = 3
const ADMIN_ROLES = ['admin', 'super_admin']
const MEMBER_TYPES = ['monthly', 'yearly']
const INACTIVE_STATUSES = ['archived', 'inactive', 'disabled', 'deleted', 'draft']

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeMembershipLevel(value, fallback = '') {
  const level = normalizeText(value)
  if (level === 'free') return 'free'
  if (['member', 'vip', 'paid', 'premium'].includes(level) || MEMBER_TYPES.includes(level) || level === 'admin') return 'member'
  return fallback
}

function isAdminUser(...sources) {
  return sources.some(source => {
    if (!source || typeof source !== 'object') return false
    const role = normalizeText(source.role || source.roleType || source.accountType)
    const membershipType = normalizeText(source.membershipType || source.memberType || source.type)
    return source.isAdmin === true || ADMIN_ROLES.includes(role) || membershipType === 'admin'
  })
}

function isExpired(expireAt) {
  if (!expireAt) return false
  const raw = String(expireAt).trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const localDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/)
  const timestamp = Date.parse(
    dateOnly
      ? `${raw}T23:59:59+08:00`
      : (localDateTime ? `${localDateTime[1]}T${localDateTime[2]}+08:00` : raw)
  )
  return Number.isFinite(timestamp) && timestamp < Date.now()
}

function isNotStarted(startAt) {
  if (!startAt) return false
  const raw = String(startAt).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const pad = value => String(value).padStart(2, '0')
    const today = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    return raw > today
  }
  const localDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/)
  const timestamp = Date.parse(localDateTime ? `${localDateTime[1]}T${localDateTime[2]}+08:00` : raw)
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function hasValidMembership(access = {}) {
  if (isAdminUser(access)) return true
  const membershipType = normalizeText(access.membershipType || access.memberType || access.type)
  const status = normalizeText(access.membershipStatus || access.status || 'active')
  if (['expired', 'inactive', 'disabled', 'cancelled'].includes(status)) return false
  if (isNotStarted(access.membershipStartAt || access.startAt)) return false
  if (isExpired(access.membershipEndAt || access.expireAt)) return false
  return access.isMember === true || MEMBER_TYPES.includes(membershipType)
}

function isCurrentTrainingContent(content = {}) {
  const status = normalizeText(content.status)
  if (content.active === false || content.visible === false) return false
  return !INACTIVE_STATUSES.includes(status)
}

// ——— 稳定排序 ———

function compareTrainingPosition(a, b) {
  const aOrder = Number(a.sortOrder || 0)
  const bOrder = Number(b.sortOrder || 0)
  if (aOrder !== bOrder) return aOrder - bOrder
  return String(a.contentId || '').localeCompare(String(b.contentId || ''))
}

function toDisplayTrainingPosition(policyPosition) {
  const position = Number(policyPosition)
  return Number.isInteger(position) && position >= 0 ? position + 1 : 0
}

// ——— 模块级权限计算 ———

function computeModuleAccessPolicy(activeItems = []) {
  const active = activeItems.filter(isCurrentTrainingContent)
  const sorted = active.slice().sort(compareTrainingPosition)
  return sorted.map((item, index) => ({
    ...item,
    policyPosition: index,
    effectiveMembershipLevel: index < FREE_TRAINING_DAYS ? 'free' : 'member',
    requiresMembership: index >= FREE_TRAINING_DAYS,
    accessPolicyVersion: ACCESS_POLICY_VERSION
  }))
}

// ——— 单条降级 ———

function resolveSingleItemPolicy(item = {}) {
  if (Number.isFinite(item.policyPosition) && item.accessPolicyVersion === ACCESS_POLICY_VERSION) {
    return {
      policyPosition: item.policyPosition,
      effectiveMembershipLevel: item.policyPosition < FREE_TRAINING_DAYS ? 'free' : 'member',
      requiresMembership: item.policyPosition >= FREE_TRAINING_DAYS,
      accessPolicyVersion: item.accessPolicyVersion
    }
  }
  return {
    policyPosition: -1,
    effectiveMembershipLevel: 'member',
    requiresMembership: true,
    accessPolicyVersion: ACCESS_POLICY_VERSION
  }
}

// ——— 访问权限检查 ———

function canAccessTrainingContent(options = {}) {
  const user = options.user || {}
  const access = options.access || {}
  const content = options.content || {}

  const policy = resolveSingleItemPolicy(content)
  const membershipLevel = policy.effectiveMembershipLevel

  if (options.includeInactive !== true && !isCurrentTrainingContent(content)) {
    return {
      allowed: false,
      reason: 'content_inactive',
      requiresMembership: membershipLevel === 'member',
      isAdminBypass: false,
      membershipLevel,
      policyPosition: policy.policyPosition,
      accessPolicyVersion: policy.accessPolicyVersion
    }
  }

  if (isAdminUser(user, access)) {
    return {
      allowed: true,
      reason: 'admin_bypass',
      requiresMembership: membershipLevel === 'member',
      isAdminBypass: true,
      membershipLevel,
      policyPosition: policy.policyPosition,
      accessPolicyVersion: policy.accessPolicyVersion
    }
  }

  if (membershipLevel === 'free') {
    return {
      allowed: true,
      reason: 'free_content',
      requiresMembership: false,
      isAdminBypass: false,
      membershipLevel,
      policyPosition: policy.policyPosition,
      accessPolicyVersion: policy.accessPolicyVersion
    }
  }

  const allowed = hasValidMembership(access)
  return {
    allowed,
    reason: allowed ? 'member_content_access' : 'membership_required',
    requiresMembership: true,
    isAdminBypass: false,
    membershipLevel,
    policyPosition: policy.policyPosition,
    accessPolicyVersion: policy.accessPolicyVersion
  }
}

module.exports = {
  ACCESS_POLICY_VERSION,
  FREE_TRAINING_DAYS,
  canAccessTrainingContent,
  compareTrainingPosition,
  computeModuleAccessPolicy,
  hasValidMembership,
  isAdminUser,
  isCurrentTrainingContent,
  normalizeMembershipLevel,
  resolveSingleItemPolicy,
  toDisplayTrainingPosition
}
