/**
 * 训练内容会员权限策略
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
// 主键 sortOrder，副键 contentId（保证确定性）。
// day / dayNumber / sourceIndex 不参与排序或权限判断。

function compareTrainingPosition(a, b) {
  const aOrder = Number(a.sortOrder || 0)
  const bOrder = Number(b.sortOrder || 0)
  if (aOrder !== bOrder) return aOrder - bOrder
  return String(a.contentId || '').localeCompare(String(b.contentId || ''))
}

// ——— 模块级权限计算 ———
// 输入模块的全部 active 内容，输出每条的 policyPosition / effectiveMembershipLevel / requiresMembership。

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

// ——— 单条降级（无模块列表上下文） ———
// 返回 fail-closed：一律视为 member。
// 只有已携带 policyPosition 的记录才能信任其 effectiveMembershipLevel。

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
// effectiveMembershipLevel 必须已经过 computeModuleAccessPolicy 或服务端计算。
// 不自行计算；不参考 day/sourceIndex/存储的 membershipLevel。

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

// ——— 统一标题决策 ———
// 根据可用证据判断应使用 Cloud 标题还是 local canonical 标题。
// 不在 training-data.js 和 remote-training.js 各复制一套判断。

const TITLE_SOURCES = {
  CLOUD_ADMIN: 'cloud_admin',
  CLOUD_MIGRATION_NEWER: 'cloud_migration_newer',
  CLOUD_ADMIN_CREATED: 'cloud_admin_created',
  LOCAL_LEGACY_RECOVERY: 'local_legacy_recovery',
  TITLE_SOURCE_CONFLICT: 'title_source_conflict'
}

// 已知旧标题清洗：将 canonical 完整标题通过旧转换得到去前缀结果。
// 只要 cloudTitle 精确等于该结果，即可确认是旧导入损坏。
const LEGACY_TITLE_PREFIXES = [
  '即兴话题：', '每日复述练嘴：', '每日练嘴：',
  '领导发言：', '演讲：', '祝酒词：', '主持开场：',
  '朗诵：', '背诵：'
]

function applyLegacyTitleCleaning(canonicalTitle = '') {
  const t = String(canonicalTitle || '').trim()
  // 旧 splitTitleAndAuthor 会按"："拆分，取冒号后部分
  for (const prefix of LEGACY_TITLE_PREFIXES) {
    if (t.startsWith(prefix)) return t.slice(prefix.length).trim()
  }
  // 无已知前缀 → 旧清洗器不做更改
  return t
}

// 精确匹配旧导入损坏：cloudTitle 必须等于 canonicalTitle 经旧清洗后的结果，
// sourceRevision 必须为旧版，且无管理员编辑证据。
function isTitleLegacyDamaged(cloudTitle = '', localCanonicalTitle = '', sourceRevision = '') {
  if (!cloudTitle || !localCanonicalTitle) return false
  if (!sourceRevision) return false
  // 0728-final 版本是当前 canonical，其中的标题不是损坏的
  if (sourceRevision.includes('0728-final')) return false
  // 精确匹配：cloudTitle 必须等于 canonicalTitle 经旧清洗后的结果
  const cleanedFromCanonical = applyLegacyTitleCleaning(localCanonicalTitle)
  return cleanedFromCanonical === cloudTitle.trim() && cleanedFromCanonical !== localCanonicalTitle.trim()
}

// 检查 Cloud 记录是否有管理员编辑证据。
// 仅信任明确的来源字段；不依赖 updatedBy（系统导入/迁移也会写入 updatedBy）。
function hasAdminEditEvidence(cloudTask = {}) {
  if (cloudTask.isCustom === true) return true
  const updateSource = String(cloudTask.updateSource || '').trim().toLowerCase()
  // 明确的管理员操作
  if (updateSource === 'admin') return true
  // 旧网页后台操作
  if (updateSource === 'admin_web' || updateSource === 'dashboard_web') return true
  return false
}

function resolveEffectiveTrainingTitle({ localItem = {}, cloudItem = {} } = {}) {
  const cloudTitle = String(cloudItem.title || '').trim()
  const localTitle = String(localItem.title || '').trim()
  const cloudVersion = Number(cloudItem.contentVersion || cloudItem.version || 0)
  const localVersion = Number(localItem.contentVersion || localItem.version || 0)
  const cloudRevision = String(cloudItem.sourceRevision || '').trim()
  const cloudUpdateSource = String(cloudItem.updateSource || '').trim().toLowerCase()
  const cloudUpdatedBy = String(cloudItem.updatedBy || '').trim()
  const contentId = String(cloudItem.contentId || localItem.contentId || '')

  // 双方均无标题 → 极端边界（合法训练内容不应出现）
  if (!cloudTitle && !localTitle) {
    return { title: '', titleSource: TITLE_SOURCES.TITLE_SOURCE_CONFLICT, reason: 'both_titles_empty' }
  }
  // 无 cloud 标题 → 使用 local
  if (!cloudTitle) {
    return { title: localTitle, titleSource: TITLE_SOURCES.LOCAL_LEGACY_RECOVERY, reason: 'cloud_title_empty' }
  }

  // admin_created 文章（origin 字段标记）— 在 empty-local 检查之前，因为可能有新文章
  const origin = String(cloudItem.origin || '').trim().toLowerCase()
  if (origin === 'admin_created') {
    return { title: cloudTitle, titleSource: TITLE_SOURCES.CLOUD_ADMIN_CREATED, reason: 'admin_created_origin' }
  }

  // 无 local 标题 → 使用 cloud（新文章等）
  if (!localTitle) {
    return { title: cloudTitle, titleSource: cloudUpdateSource === 'admin' ? TITLE_SOURCES.CLOUD_ADMIN : TITLE_SOURCES.CLOUD_MIGRATION_NEWER, reason: 'local_title_empty' }
  }
  // 相同 → 无冲突
  if (cloudTitle === localTitle) {
    return { title: cloudTitle, titleSource: 'exact_match', reason: 'titles_identical' }
  }

  // 1. 明确管理员修改 → Cloud 优先
  if (hasAdminEditEvidence(cloudItem)) {
    return { title: cloudTitle, titleSource: TITLE_SOURCES.CLOUD_ADMIN, reason: 'admin_edit_evidence' }
  }

  // 3. Cloud 版本更高 → Cloud 优先（迁移或系统更新）
  if (cloudVersion > localVersion && cloudVersion > 0 && localVersion > 0) {
    return { title: cloudTitle, titleSource: TITLE_SOURCES.CLOUD_MIGRATION_NEWER, reason: `cloud_v${cloudVersion}_gt_local_v${localVersion}` }
  }

  // 4. Cloud 是旧导入损坏（精确匹配：cloudTitle == canonical 经旧清洗后的结果）
  if (isTitleLegacyDamaged(cloudTitle, localTitle, cloudRevision)) {
    return { title: localTitle, titleSource: TITLE_SOURCES.LOCAL_LEGACY_RECOVERY, reason: 'legacy_damaged_title_precise_match' }
  }

  // 5. 无法判断 → 标记冲突，保留本地（不静默覆盖）。
  // 冲突结果不使用 Cloud 标题，保证异步返回顺序不影响最终显示。
  // 冲突不应写入 last-known-good 缓存（由调用方根据 titleSource 判断）。
  // 开发日志仅记录 contentId 和版本元数据，不记录正文或敏感用户信息。
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[training-access-policy] TITLE_SOURCE_CONFLICT:', {
      contentId,
      cloudVersion,
      localVersion,
      cloudUpdateSource: cloudUpdateSource || 'unknown',
      cloudRevision: cloudRevision || 'unknown'
    })
  }
  return {
    title: localTitle,  // 稳定 fallback：始终使用 local canonical
    titleSource: TITLE_SOURCES.TITLE_SOURCE_CONFLICT,
    reason: 'ambiguous_source_default_local',
    conflictDetails: {
      contentId,
      cloudVersion,
      localVersion,
      cloudUpdateSource: cloudUpdateSource || 'unknown',
      cloudRevision: cloudRevision || 'unknown'
    }
  }
}

module.exports = {
  ACCESS_POLICY_VERSION,
  FREE_TRAINING_DAYS,
  TITLE_SOURCES,
  canAccessTrainingContent,
  compareTrainingPosition,
  computeModuleAccessPolicy,
  hasAdminEditEvidence,
  hasValidMembership,
  isAdminUser,
  isCurrentTrainingContent,
  isTitleLegacyDamaged,
  applyLegacyTitleCleaning,
  normalizeMembershipLevel,
  resolveEffectiveTrainingTitle,
  resolveSingleItemPolicy
}
