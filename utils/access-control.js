const { formatDateTime } = require('./local-data')
const {
  FREE_DAILY_AI_LIMIT,
  FREE_MONTHLY_AI_LIMIT,
  MEMBER_DAILY_AI_LIMIT,
  MEMBER_MONTHLY_AI_LIMIT
} = require('./membership-config')

const USERS_KEY = 'users'
const STUDENTS_KEY = 'students'
const ENTITLEMENTS_KEY = 'entitlements'
const LEADS_KEY = 'leads'
const ORDERS_KEY = 'orders'
const CURRENT_USER_KEY = 'userInfo'
const MEMBER_PROFILE_KEY = 'memberProfile'
const MEMBER_WHITELIST_KEY = 'memberWhitelist'

const PACKAGE_OPTIONS = [
  { code: 'offline_course', name: '线下课绑定权限' },
  { code: 'mini_21_reading', name: '朗读训练基础包' },
  { code: 'mini_21_retell', name: '复述训练基础包' },
  { code: 'mini_21_topic', name: '话题训练基础包' },
  { code: 'mini_21_mandarin', name: '普通话训练基础包' },
  { code: 'mini_21_all', name: '四类21天训练包' },
  { code: 'advanced_all', name: '进阶训练包' },
  { code: 'vip_all', name: '全部内容会员' }
]

const MODULE_PACKAGE_MAP = {
  reading: 'mini_21_reading',
  retell: 'mini_21_retell',
  topic: 'mini_21_topic',
  mandarin: 'mini_21_mandarin'
}

function getStorageList(key) {
  const list = wx.getStorageSync(key) || []
  return Array.isArray(list) ? list : []
}

function setStorageList(key, list) {
  wx.setStorageSync(key, Array.isArray(list) ? list : [])
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function maskPhone(phone) {
  const value = normalizePhone(phone)
  return /^1\d{10}$/.test(value) ? `${value.slice(0, 3)}****${value.slice(-4)}` : ''
}

function isPhoneBound(user = getCurrentUser()) {
  return user.phoneBound === true && /^1\d{10}$/.test(normalizePhone(user.phone))
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`
}

function isExpired(expireAt) {
  if (!expireAt) return false
  const raw = String(expireAt)
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw} 23:59:59` : raw
  const date = new Date(normalized.replace(/-/g, '/'))
  if (!date.getTime()) return false
  return date.getTime() < Date.now()
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'
  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function getCurrentUser() {
  return wx.getStorageSync(CURRENT_USER_KEY) || {}
}

function getUsers() {
  return getStorageList(USERS_KEY)
}

function setUsers(list) {
  setStorageList(USERS_KEY, list)
}

function saveCurrentUser(userInfo = {}) {
  const current = getCurrentUser()
  const nextPhone = normalizePhone(userInfo.phone || current.phone || '')
  const phoneBound = (userInfo.phoneBound === true || current.phoneBound === true) && /^1\d{10}$/.test(nextPhone)
  const nextUser = {
    ...current,
    ...userInfo,
    nickname: userInfo.nickname || userInfo.nickName || current.nickname || '同学',
    nicknameSource: userInfo.nicknameSource || current.nicknameSource || 'default',
    avatarUrl: userInfo.avatarUrl || current.avatarUrl || '',
    avatarText: userInfo.avatarText || getAvatarText(userInfo.nickname || userInfo.nickName || current.nickname || '同学'),
    role: userInfo.role || current.role || 'user',
    phone: nextPhone,
    phoneBound,
    isLogin: phoneBound,
    isLoggedIn: phoneBound
  }

  wx.setStorageSync(CURRENT_USER_KEY, nextUser)

  if (!nextUser.openid) return nextUser

  const now = formatDateTime()
  const users = getUsers()
  const existed = users.find(item => item.openid === nextUser.openid)
  const nextUsers = existed
    ? users.map(item => item.openid === nextUser.openid
      ? {
        ...item,
        phone: nextUser.phone || item.phone || '',
        nickname: nextUser.nickname || item.nickname || '同学',
        avatarText: getAvatarText(nextUser.nickname || item.nickname || '同学'),
        avatarUrl: nextUser.avatarUrl || item.avatarUrl || '',
        nicknameSource: nextUser.nicknameSource || item.nicknameSource || 'default',
        phoneMasked: nextUser.phoneMasked || maskPhone(nextUser.phone || item.phone),
        phoneBound: nextUser.phoneBound === true || item.phoneBound === true,
        role: nextUser.role || item.role || 'user',
        membershipType: nextUser.membershipType || item.membershipType || 'free',
        membershipStatus: nextUser.membershipStatus || item.membershipStatus || 'active',
        membershipStartAt: nextUser.membershipStartAt || item.membershipStartAt || '',
        membershipEndAt: nextUser.membershipEndAt == null ? (item.membershipEndAt || null) : nextUser.membershipEndAt,
        isAdmin: nextUser.isAdmin === true,
        aiDailyLimit: nextUser.aiDailyLimit == null ? (item.aiDailyLimit || FREE_DAILY_AI_LIMIT) : nextUser.aiDailyLimit,
        aiMonthlyLimit: nextUser.aiMonthlyLimit == null ? (item.aiMonthlyLimit || FREE_MONTHLY_AI_LIMIT) : nextUser.aiMonthlyLimit,
        lastLoginAt: now,
        status: item.status || 'active'
      }
      : item)
    : [{
      openid: nextUser.openid,
      phone: nextUser.phone || '',
      nickname: nextUser.nickname || '同学',
      avatarText: getAvatarText(nextUser.nickname || '同学'),
      avatarUrl: nextUser.avatarUrl || '',
      nicknameSource: nextUser.nicknameSource || 'default',
      phoneMasked: nextUser.phoneMasked || maskPhone(nextUser.phone),
      phoneBound: nextUser.phoneBound === true,
      role: nextUser.role || 'user',
      membershipType: nextUser.membershipType || 'free',
      membershipStatus: nextUser.membershipStatus || 'active',
      membershipStartAt: nextUser.membershipStartAt || '',
      membershipEndAt: nextUser.membershipEndAt || null,
      isAdmin: nextUser.isAdmin === true,
      aiDailyLimit: nextUser.aiDailyLimit == null ? FREE_DAILY_AI_LIMIT : nextUser.aiDailyLimit,
      aiMonthlyLimit: nextUser.aiMonthlyLimit == null ? FREE_MONTHLY_AI_LIMIT : nextUser.aiMonthlyLimit,
      firstLoginAt: now,
      lastLoginAt: now,
      status: 'active'
    }].concat(users)

  setUsers(nextUsers)
  return nextUser
}

function getStudents() {
  return getStorageList(STUDENTS_KEY)
}

function setStudents(list) {
  setStorageList(STUDENTS_KEY, list)
}

function getEntitlements() {
  return getStorageList(ENTITLEMENTS_KEY)
}

function setEntitlements(list) {
  setStorageList(ENTITLEMENTS_KEY, list)
}

function getLeads() {
  return getStorageList(LEADS_KEY)
}

function setLeads(list) {
  setStorageList(LEADS_KEY, list)
}

function getOrders() {
  return getStorageList(ORDERS_KEY)
}

function setOrders(list) {
  setStorageList(ORDERS_KEY, list)
}

function bindPhoneToUser(phone, openid = '') {
  const normalizedPhone = normalizePhone(phone)
  const current = getCurrentUser()
  const nextUser = saveCurrentUser({
    ...current,
    openid: openid || current.openid || '',
    phone: normalizedPhone,
    phoneMasked: maskPhone(normalizedPhone),
    phoneBound: true,
    phoneBoundAt: current.phoneBoundAt || formatDateTime(),
    nickname: current.nickname || '同学',
    role: current.role || 'user',
    isLoggedIn: true
  })

  return nextUser
}

function bindOpenidToMatchedRecords(phone, openid) {
  if (!phone || !openid) return

  setStudents(getStudents().map(item => (
    normalizePhone(item.phone) === phone
      ? {
        ...item,
        openid
      }
      : item
  )))
  setEntitlements(getEntitlements().map(item => (
    normalizePhone(item.phone) === phone
      ? {
        ...item,
        openid: item.openid || openid
      }
      : item
  )))
}

function getUserPackages(phone = '', openid = '') {
  const user = getCurrentUser()
  const targetPhone = normalizePhone(phone || user.phone)
  const targetOpenid = openid || user.openid || ''

  return getEntitlements().filter(item => {
    const samePhone = targetPhone && normalizePhone(item.phone) === targetPhone
    const sameOpenid = targetOpenid && item.openid === targetOpenid
    return item.status === 'active' && !isExpired(item.expireAt) && (samePhone || sameOpenid)
  })
}

function recordLead(phone, openid = '', lastAction = 'clicked_paid_content') {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) return null

  const user = getCurrentUser()
  const leads = getLeads()
  const existed = leads.find(item => normalizePhone(item.phone) === normalizedPhone)
  const nextLead = {
    ...(existed || {}),
    id: existed ? existed.id : createId('lead'),
    phone: normalizedPhone,
    openid: openid || user.openid || existed?.openid || '',
    nickname: user.nickname || user.nickName || existed?.nickname || '同学',
    source: existed?.source || 'online_visitor',
    status: existed?.status || 'new',
    createdAt: existed?.createdAt || formatDateTime(),
    lastAction
  }

  setLeads(existed
    ? leads.map(item => item.id === existed.id ? nextLead : item)
    : [nextLead].concat(leads))

  return nextLead
}

function matchStudentAndEntitlements(phone, openid = '') {
  const normalizedPhone = normalizePhone(phone)
  const student = getStudents().find(item => (
    normalizePhone(item.phone) === normalizedPhone && item.status !== 'inactive'
  )) || null

  bindOpenidToMatchedRecords(normalizedPhone, openid)

  const packages = getUserPackages(normalizedPhone, openid)

  if (packages.length === 0) {
    recordLead(normalizedPhone, openid, 'phone_verified_no_package')
  }

  return {
    phone: normalizedPhone,
    student,
    packages,
    hasStudent: !!student,
    hasAccess: packages.length > 0
  }
}

function hasPackage(packageCode) {
  return getUserPackages().some(item => item.packageCode === packageCode)
}

function hasAnyPackage(codes, packages) {
  return packages.some(item => codes.includes(item.packageCode))
}

function getCurrentOpenid() {
  const user = getCurrentUser()
  return user.openid || user.openId || ''
}

function getMemberProfile() {
  return wx.getStorageSync(MEMBER_PROFILE_KEY) || {}
}

function getMemberWhitelist() {
  const list = wx.getStorageSync(MEMBER_WHITELIST_KEY) || []
  return Array.isArray(list) ? list : []
}

function normalizeMembershipType(value, fallback = 'free') {
  const type = String(value || '').toLowerCase()
  if (type === 'admin') return 'admin'
  if (type === 'yearly' || type === 'year' || type === 'annual') return 'yearly'
  if (type === 'monthly' || type === 'month') return 'monthly'
  if (type === 'free') return 'free'
  return fallback
}

function normalizeContentMembershipLevel(value, fallback = '') {
  const level = String(value || '').toLowerCase()
  if (level === 'member') return 'member'
  if (level === 'monthly' || level === 'yearly' || level === 'admin') return 'member'
  if (level === 'free') return 'free'
  return fallback
}

function getActiveMemberAccess() {
  const user = getCurrentUser()
  const phoneBound = isPhoneBound(user)
  const openid = getCurrentOpenid()
  const packages = getUserPackages(user.phone, openid)
  const cloudPackageCodes = Array.isArray(user.accessPackages) ? user.accessPackages : []
  const cloudPackages = cloudPackageCodes.map(code => ({
    packageCode: code,
    source: 'cloud'
  }))
  const mergedPackages = packages.concat(cloudPackages)
  const packageMembershipType = mergedPackages
    .map(item => item.membershipType || item.memberType)
    .find(Boolean)
  const userMembershipType = phoneBound && user.membershipStatus === 'active' && !isExpired(user.membershipEndAt)
    ? user.membershipType
    : ''
  const membershipType = normalizeMembershipType(userMembershipType || packageMembershipType, 'monthly')

  if (phoneBound && userMembershipType === 'admin' && user.isAdmin === true) {
    return {
      isMember: true,
      isAdmin: true,
      type: 'admin',
      membershipType: 'admin',
      membershipStatus: 'active',
      membershipEndAt: null,
      label: '管理员',
      source: 'phone',
      aiDailyLimit: -1,
      aiMonthlyLimit: -1,
      packages: mergedPackages
    }
  }

  if (phoneBound && ['monthly', 'yearly'].includes(userMembershipType)) {
    return {
      isMember: true,
      isAdmin: false,
      type: userMembershipType,
      membershipType: userMembershipType,
      membershipStatus: 'active',
      membershipEndAt: user.membershipEndAt || null,
      label: userMembershipType === 'yearly' ? '年度会员' : '季度会员',
      source: 'phone',
      aiDailyLimit: Number(user.aiDailyLimit || MEMBER_DAILY_AI_LIMIT),
      aiMonthlyLimit: Number(user.aiMonthlyLimit || MEMBER_MONTHLY_AI_LIMIT),
      packages: mergedPackages
    }
  }

  if (phoneBound && hasAnyPackage(['vip_all'], mergedPackages)) {
    return {
      isMember: true,
      type: membershipType,
      membershipType,
      label: membershipType === 'yearly' ? '年度会员' : '季度会员',
      source: cloudPackageCodes.includes('vip_all') ? 'cloud' : 'entitlement',
      packages: mergedPackages
    }
  }

  if (phoneBound && (hasAnyPackage(['advanced_all'], mergedPackages) || user.hasAdvancedAccess === true)) {
    return {
      isMember: true,
      type: membershipType,
      membershipType,
      label: membershipType === 'yearly' ? '年度会员' : '季度会员',
      source: user.hasAdvancedAccess === true ? 'cloud' : 'entitlement',
      packages: mergedPackages
    }
  }

  const whitelistItem = getMemberWhitelist().find(item => (
    item.openid === openid && !isExpired(item.expireAt)
  ))

  if (phoneBound && whitelistItem) {
    return {
      isMember: true,
      type: 'whitelist',
      membershipType: normalizeMembershipType(whitelistItem.membershipType, 'yearly'),
      label: '白名单会员',
      source: 'whitelist',
      packages: mergedPackages
    }
  }

  const profile = getMemberProfile()
  if (phoneBound && profile.isMember === true && !isExpired(profile.expireAt)) {
    const profileMembershipType = normalizeMembershipType(profile.membershipType || profile.memberType, 'monthly')
    return {
      isMember: true,
      type: profileMembershipType,
      membershipType: profileMembershipType,
      label: profileMembershipType === 'yearly' ? '年度会员' : '季度会员',
      source: 'memberProfile',
      packages: mergedPackages
    }
  }

  return {
    isMember: false,
    isAdmin: false,
    type: 'free',
    membershipType: 'free',
    label: '普通用户',
    source: phoneBound ? 'phone' : 'unbound',
    membershipStatus: 'active',
    membershipEndAt: null,
    aiDailyLimit: FREE_DAILY_AI_LIMIT,
    aiMonthlyLimit: FREE_MONTHLY_AI_LIMIT,
    phoneBound,
    packages: mergedPackages
  }
}

function getCurrentAccessStatus() {
  const memberAccess = getActiveMemberAccess()

  if (memberAccess.membershipType === 'admin') {
    return {
      roleType: 'admin',
      membershipType: 'admin',
      label: '管理员',
      desc: '已解锁全部训练内容与 AI 权限',
      packages: memberAccess.packages,
      canAccessBasic: true,
      canAccessAdvanced: true,
      aiDailyLimit: -1,
      aiMonthlyLimit: -1,
      membershipEndAt: null,
      isAdmin: true
    }
  }

  if (memberAccess.type === 'whitelist') {
    return {
      roleType: 'monthly',
      membershipType: 'monthly',
      label: '季度会员',
      desc: '每天 5 次 AI 点评/测评',
      packages: memberAccess.packages,
      canAccessBasic: true,
      canAccessAdvanced: true,
      aiDailyLimit: MEMBER_DAILY_AI_LIMIT,
      aiMonthlyLimit: MEMBER_MONTHLY_AI_LIMIT,
      membershipEndAt: memberAccess.membershipEndAt || null,
      isAdmin: false
    }
  }

  if (memberAccess.isMember) {
    const membershipType = memberAccess.membershipType || memberAccess.type || 'monthly'
    const isYearly = membershipType === 'yearly'
    return {
      roleType: membershipType,
      membershipType,
      label: isYearly ? '年度会员' : '季度会员',
      desc: isYearly
        ? '每天 5 次 AI 点评/测评'
        : '每天 5 次 AI 点评/测评',
      packages: memberAccess.packages,
      canAccessBasic: true,
      canAccessAdvanced: true,
      aiDailyLimit: MEMBER_DAILY_AI_LIMIT,
      aiMonthlyLimit: MEMBER_MONTHLY_AI_LIMIT,
      membershipEndAt: memberAccess.membershipEndAt || null,
      isAdmin: false
    }
  }

  return {
    roleType: 'free',
    membershipType: 'free',
    label: '普通用户',
    desc: '可使用前 21 天训练，每天 1 次 AI 点评/测评',
    packages: memberAccess.packages,
    canAccessBasic: true,
    canAccessAdvanced: false,
    aiDailyLimit: FREE_DAILY_AI_LIMIT,
    aiMonthlyLimit: FREE_MONTHLY_AI_LIMIT,
    membershipEndAt: null,
    isAdmin: false,
    phoneBound: memberAccess.phoneBound === true
  }
}

function canAccessModule(moduleId) {
  return {
    allowed: true,
    reason: 'module_preview',
    isFreeAccess: true,
    packages: getActiveMemberAccess().packages
  }
}

function canAccessAnyContent() {
  return {
    allowed: true,
    reason: 'free_basic_access',
    isFreeAccess: true,
    packages: getActiveMemberAccess().packages
  }
}

function canAccessTask(moduleId, task = {}) {
  const requiredMembership = normalizeContentMembershipLevel(task.membershipLevel)
  if (requiredMembership === 'free') {
    return {
      allowed: true,
      reason: 'cloud_free_access',
      isFreeAccess: true,
      packages: getActiveMemberAccess().packages
    }
  }

  if (requiredMembership === 'member') {
    const memberAccess = getActiveMemberAccess()
    const currentUser = getCurrentUser()
    const currentMembership = normalizeMembershipType(memberAccess.membershipType, 'free')
    const allowed = currentUser.isAdmin === true ||
      memberAccess.isAdmin === true ||
      memberAccess.isMember === true ||
      ['monthly', 'yearly', 'admin'].includes(currentMembership)
    return {
      allowed,
      reason: allowed ? 'member_content_access' : 'need_member',
      isMemberAccess: allowed,
      packages: memberAccess.packages
    }
  }

  const day = Number(task.day || (task.isPaid === true ? 22 : 1))
  if (!requiredMembership && day <= 21) {
    return {
      allowed: true,
      reason: 'free_basic_day',
      isFreeAccess: true,
      packages: getActiveMemberAccess().packages
    }
  }

  const memberAccess = getActiveMemberAccess()

  if (!memberAccess.phoneBound && !isPhoneBound()) {
    return {
      allowed: false,
      reason: 'need_phone',
      isPhoneRequired: true,
      packages: memberAccess.packages
    }
  }

  const ranks = { free: 0, monthly: 1, yearly: 2, admin: 3 }
  const currentMembership = normalizeMembershipType(memberAccess.membershipType, 'free')
  const allowed = requiredMembership
    ? ranks[currentMembership] >= ranks[requiredMembership]
    : memberAccess.isMember
  return {
    allowed,
    reason: allowed ? 'member_advanced_access' : 'need_member',
    isMemberAccess: allowed,
    packages: memberAccess.packages
  }
}

module.exports = {
  USERS_KEY,
  STUDENTS_KEY,
  ENTITLEMENTS_KEY,
  LEADS_KEY,
  ORDERS_KEY,
  PACKAGE_OPTIONS,
  MODULE_PACKAGE_MAP,
  getCurrentUser,
  saveCurrentUser,
  getUsers,
  setUsers,
  getStudents,
  setStudents,
  getEntitlements,
  setEntitlements,
  getLeads,
  setLeads,
  getOrders,
  setOrders,
  bindPhoneToUser,
  matchStudentAndEntitlements,
  getUserPackages,
  hasPackage,
  getActiveMemberAccess,
  canAccessModule,
  canAccessTask,
  canAccessAnyContent,
  getCurrentAccessStatus,
  recordLead,
  normalizePhone,
  maskPhone,
  isPhoneBound
}
