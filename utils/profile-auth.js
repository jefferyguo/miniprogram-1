const auth = require('./auth')
const { saveCurrentUser, getCurrentUser } = require('./access-control')
const { saveUserInfo } = require('./local-data')
const { upsertStudentUser } = require('./user-registry')

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

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: res => res.code ? resolve(res.code) : reject(new Error('微信登录未返回 code')),
      fail: reject
    })
  })
}

function getFileExtension(path) {
  const match = String(path || '').split('?')[0].match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : 'jpg'
}

async function uploadAvatar(avatarUrl) {
  const path = String(avatarUrl || '')
  if (!path || /^https?:\/\//.test(path) || path.indexOf('cloud://') === 0) return path
  if (!wx.cloud || !wx.cloud.uploadFile) return path

  const cloudPath = `profile-avatars/avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${getFileExtension(path)}`
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: path })
  return res.fileID || path
}

async function callLoginFunction(code, profile) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('当前微信版本不支持云端登录')
  }

  const res = await wx.cloud.callFunction({
    name: 'login',
    data: { code, profile }
  })
  const result = res.result || {}
  if (!result.success || !result.user) throw new Error(result.message || '云端登录失败')
  return result.user
}

function mergeUserInfo(cloudUser = {}, profile = {}) {
  const oldUser = getCurrentUser() || {}
  const incomingNickname = String(profile.nickname || cloudUser.nickname || '').trim()
  const keepManualNickname = oldUser.nicknameSource === 'manual' && profile.nicknameSource !== 'manual'
  const nickname = keepManualNickname
    ? oldUser.nickname
    : (incomingNickname || oldUser.nickname || '同学')
  const keepManualAvatar = oldUser.avatarSource === 'manual' && profile.avatarSource !== 'manual'
  const avatarUrl = keepManualAvatar
    ? oldUser.avatarUrl
    : (profile.avatarUrl || cloudUser.avatarUrl || oldUser.avatarUrl || '')
  const loginAt = Date.now()
  const phoneBound = cloudUser.phoneBound === true || oldUser.phoneBound === true
  const nextUser = {
    ...oldUser,
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
    role: cloudUser.role || oldUser.role || 'user',
    status: 'active',
    isLogin: phoneBound,
    isLoggedIn: phoneBound,
    loginAt,
    firstLoginAt: cloudUser.firstLoginAt || oldUser.firstLoginAt || loginAt,
    profileCompleted: true,
    skippedProfileAuth: false
  }

  auth.setUserInfo(nextUser)
  const saved = saveCurrentUser(nextUser)
  saveUserInfo(saved)
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
      app.globalData.profileCompleted = true
      app.globalData.skippedProfileAuth = false
    }
  }

  return saved
}

async function loginWithProfile(profile = {}) {
  const nickname = String(profile.nickname || '').trim() || '同学'
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

  const code = await wxLogin()
  const cloudUser = await callLoginFunction(code, nextProfile)
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
