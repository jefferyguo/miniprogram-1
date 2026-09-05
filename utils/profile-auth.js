const auth = require('./auth')
const { saveCurrentUser, getCurrentUser, maskPhone } = require('./access-control')
const { saveUserInfo } = require('./local-data')
const { upsertStudentUser } = require('./user-registry')
const { isValidNickname, normalizeNickname } = require('./auth-state')
const { updateMyProfile } = require('./cloud-api')

const PROFILE_PROMPTED_KEY = 'profileLoginPrompted'
const PROFILE_SKIPPED_KEY = 'profileAuthSkipped'
const PROFILE_SKIPPED_AT_KEY = 'profileAuthSkippedAt'
const JUST_LOGGED_OUT_KEY = 'justLoggedOut'

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'
  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function isSameLocalDay(timestamp) {
  const value = Number(timestamp || 0)
  if (!value) return false

  const target = new Date(value)
  const today = new Date()
  return target.getFullYear() === today.getFullYear() &&
    target.getMonth() === today.getMonth() &&
    target.getDate() === today.getDate()
}

function shouldShowProfileLoginModal() {
  const user = getCurrentUser()
  if (user && (user.profileCompleted === true || user.nicknameSource === 'manual')) return false
  if (wx.getStorageSync(JUST_LOGGED_OUT_KEY) === true) return false
  if (isSameLocalDay(wx.getStorageSync(PROFILE_SKIPPED_AT_KEY))) return false
  return wx.getStorageSync(PROFILE_PROMPTED_KEY) !== true
}

const shouldShowProfilePrompt = shouldShowProfileLoginModal

function markProfilePrompted() {
  wx.setStorageSync(PROFILE_PROMPTED_KEY, true)
}

function markProfileSkipped() {
  const skippedAt = Date.now()
  markProfilePrompted()
  wx.setStorageSync(PROFILE_SKIPPED_KEY, true)
  wx.setStorageSync('skippedProfileAuth', true)
  wx.setStorageSync(PROFILE_SKIPPED_AT_KEY, skippedAt)

  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) app.globalData.skippedProfileAuth = true
  }

  const user = getCurrentUser()
  if (user && (user.openid || user.isLoggedIn)) {
    const next = saveCurrentUser({
      ...user,
      skippedProfileAuth: true,
      profileCompleted: Boolean(user.profileCompleted)
    })
    saveUserInfo(next)
  }
}

function getFileExtension(path) {
  const match = String(path || '').split('?')[0].match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : 'jpg'
}

async function uploadAvatar(avatarUrl) {
  const path = String(avatarUrl || '')
  if (!path || /^https?:\/\//.test(path) || path.indexOf('cloud://') === 0) return path

  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && typeof app.ensureCloudReady === 'function') await app.ensureCloudReady()
  }
  if (!wx.cloud || !wx.cloud.uploadFile) return path

  const cloudPath = `profile-avatars/avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${getFileExtension(path)}`
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: path })
  return res.fileID || path
}

function mergeUserInfo(cloudUser = {}, profile = {}) {
  const oldUser = getCurrentUser() || {}
  const oldServerUserId = String(oldUser._id || oldUser.userId || oldUser.serverUserId || '')
  const cloudServerUserId = String(cloudUser._id || cloudUser.userId || cloudUser.serverUserId || '')
  const sameServerIdentity = Boolean(
    oldServerUserId && cloudServerUserId && oldServerUserId === cloudServerUserId
  )
  // 只有同一服务端用户才能保留本地展示偏好；认证、手机号、会员和管理员字段始终以云端为准。
  const trustedOldUser = sameServerIdentity ? oldUser : {}
  const incomingNickname = String(profile.nickname || cloudUser.nickname || '').trim()
  const keepManualNickname = trustedOldUser.nicknameSource === 'manual' && profile.nicknameSource !== 'manual'
  const nickname = keepManualNickname
    ? trustedOldUser.nickname
    : (incomingNickname || trustedOldUser.nickname || '同学')
  const keepManualAvatar = trustedOldUser.avatarSource === 'manual' && profile.avatarSource !== 'manual'
  const avatarUrl = keepManualAvatar
    ? trustedOldUser.avatarUrl
    : (profile.avatarUrl || cloudUser.avatarUrl || trustedOldUser.avatarUrl || '')
  const loginAt = Date.now()
  const cloudPhone = String(cloudUser.phone || '').replace(/\D/g, '')
  const phoneBound = cloudUser.phoneBound === true && /^1\d{10}$/.test(cloudPhone)
  const nextUser = {
    ...trustedOldUser,
    ...cloudUser,
    nickname,
    nicknameSource: keepManualNickname
      ? 'manual'
      : (profile.nicknameSource || cloudUser.nicknameSource || (nickname === '同学' ? 'default' : 'wechat')),
    avatarUrl,
    avatarSource: keepManualAvatar
      ? 'manual'
      : (profile.avatarSource || cloudUser.avatarSource || (avatarUrl ? 'wechat' : 'default')),
    avatarText: getAvatarText(nickname),
    phone: phoneBound ? cloudPhone : '',
    phoneMasked: phoneBound ? (cloudUser.phoneMasked || maskPhone(cloudPhone)) : '',
    phoneBound,
    phoneBoundAt: phoneBound ? (cloudUser.phoneBoundAt || '') : '',
    phoneAuthorizedAt: phoneBound ? (cloudUser.phoneAuthorizedAt || '') : '',
    membershipType: cloudUser.membershipType || 'free',
    membershipStatus: cloudUser.membershipStatus || 'active',
    membershipStartAt: cloudUser.membershipStartAt || '',
    membershipEndAt: cloudUser.membershipEndAt == null ? null : cloudUser.membershipEndAt,
    role: cloudUser.role || 'user',
    isAdmin: cloudUser.isAdmin === true,
    hasAdvancedAccess: cloudUser.hasAdvancedAccess === true,
    accessPackages: Array.isArray(cloudUser.accessPackages) ? cloudUser.accessPackages : [],
    aiDailyLimit: cloudUser.aiDailyLimit,
    aiMonthlyLimit: cloudUser.aiMonthlyLimit,
    status: 'active',
    isLogin: phoneBound,
    isLoggedIn: phoneBound,
    loginAt,
    firstLoginAt: cloudUser.firstLoginAt || trustedOldUser.firstLoginAt || loginAt,
    profileCompleted: true,
    skippedProfileAuth: false
  }

  auth.setUserInfo(nextUser)
  const saved = saveCurrentUser(nextUser)
  saveUserInfo(saved)
  const hasActivePaidMembership = saved.membershipStatus === 'active' &&
    ['monthly', 'yearly', 'admin'].includes(saved.membershipType)
  const memberProfile = {
    isMember: saved.isAdmin === true || (
      phoneBound && (
        hasActivePaidMembership ||
        saved.hasAdvancedAccess === true
      )
    ),
    isAdmin: saved.isAdmin === true,
    membershipType: saved.isAdmin === true ? 'admin' : (saved.membershipType || 'free'),
    memberType: saved.isAdmin === true ? 'admin' : (saved.membershipType || 'free'),
    membershipStatus: saved.membershipStatus || 'active',
    membershipStartAt: saved.membershipStartAt || '',
    membershipEndAt: saved.membershipEndAt == null ? null : saved.membershipEndAt,
    expireAt: saved.membershipEndAt == null ? null : saved.membershipEndAt,
    aiDailyLimit: saved.aiDailyLimit,
    aiMonthlyLimit: saved.aiMonthlyLimit
  }
  wx.setStorageSync('memberProfile', memberProfile)
  upsertStudentUser(saved, {
    isMember: Boolean(saved.hasAdvancedAccess),
    memberType: saved.hasAdvancedAccess ? 'vip' : 'free',
    expireAt: ''
  })
  markProfilePrompted()
  wx.setStorageSync('profileCompleted', true)
  wx.setStorageSync('skippedProfileAuth', false)
  wx.setStorageSync('loginState', {
    isLogin: phoneBound,
    phoneBound,
    loginAt
  })
  wx.removeStorageSync(PROFILE_SKIPPED_KEY)
  wx.removeStorageSync(PROFILE_SKIPPED_AT_KEY)
  wx.removeStorageSync(JUST_LOGGED_OUT_KEY)

  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.userInfo = saved
      app.globalData.isLogin = phoneBound
      app.globalData.isAuthenticated = phoneBound
      app.globalData.memberProfile = memberProfile
      app.globalData.profileCompleted = true
      app.globalData.skippedProfileAuth = false
    }
  }

  return saved
}

async function loginWithProfile(profile = {}) {
  if (!auth.isPhoneBound()) {
    const error = new Error('请先完成手机号快捷登录')
    error.code = 'PHONE_LOGIN_REQUIRED'
    throw error
  }
  const nickname = normalizeNickname(profile.nickname)
  if (!isValidNickname(nickname)) {
    const error = new Error('请设置有效昵称后再登录')
    error.code = 'INVALID_NICKNAME'
    throw error
  }
  let avatarUrl = profile.avatarUrl || ''

  try {
    avatarUrl = await uploadAvatar(avatarUrl)
  } catch (error) {
    console.warn('[profile-auth] 头像上传失败，保留本地头像:', error)
  }

  const nextProfile = {
    nickname,
    nickName: nickname,
    nicknameSource: profile.nicknameSource || (nickname === '同学' ? 'default' : 'wechat'),
    avatarUrl,
    avatarSource: profile.avatarSource || (avatarUrl ? 'wechat' : 'default'),
    profileCompleted: true,
    skippedProfileAuth: false
  }

  const result = await updateMyProfile(nextProfile)
  const cloudUser = result.user || result.userProfile || {}
  return mergeUserInfo(cloudUser, nextProfile)
}

module.exports = {
  PROFILE_PROMPTED_KEY,
  PROFILE_SKIPPED_KEY,
  PROFILE_SKIPPED_AT_KEY,
  JUST_LOGGED_OUT_KEY,
  getAvatarText,
  shouldShowProfileLoginModal,
  shouldShowProfilePrompt,
  markProfilePrompted,
  markProfileSkipped,
  loginWithProfile
}
