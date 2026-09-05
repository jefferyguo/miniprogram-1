/**
 * 手机号绑定工具
 *
 * 保留：
 *   - bindPhoneWithCode    手机号绑定
 *   - applyPhoneBindingResult  绑定结果写入本地状态
 *   - refreshPhoneMembership   刷新会员权益
 *   - isPhoneBound            手机号绑定状态
 *   - getPhoneRequiredMessage 操作提示文案
 *
 * 门控已统一到 utils/auth.js：
 *   requirePhoneBound → auth.requirePhoneBound
 *
 * 为兼容已有页面调用，保留 requirePhoneBound 导出，
 * 但内部委托给 auth.js 统一实现。
 */

const { bindPhoneByCode, getMe } = require('./cloud-api')
const {
  getCurrentUser,
  maskPhone,
  saveCurrentUser
} = require('./access-control')
const auth = require('./auth')

const PHONE_LOGIN_TIMEOUT_MS = 15000

const PHONE_REQUIRED_MESSAGES = {
  '保存训练记录': '保存训练记录需要先绑定手机号',
  '提交训练作品': '提交训练作品需要先绑定手机号',
  '生成 AI 点评': '生成 AI 点评需要先绑定手机号',
  '发布广场': '发布广场需要先绑定手机号',
  '查看训练记录': '查看训练记录需要先绑定手机号',
  '使用会员训练内容': '使用会员训练内容需要先绑定手机号',
  '表达力测评': '生成表达力测评报告需要先绑定手机号',
  '开通会员': '请先登录并绑定手机号，便于自动匹配会员权益。',
  '点赞作品': '点赞作品需要先绑定手机号',
  '发表评论': '发表评论需要先绑定手机号'
}

function getPhoneRequiredMessage(actionName) {
  return PHONE_REQUIRED_MESSAGES[actionName] || `${actionName || '当前操作'}需要先绑定手机号`
}

function isPhoneBound() {
  return auth.isPhoneBound()
}

function applyPhoneBindingResult(result = {}) {
  const oldUser = getCurrentUser()
  const cloudUser = result.userProfile || {}
  const membership = result.membershipProfile || {}
  const phone = cloudUser.phone || result.phone || oldUser.phone || ''
  const nickname = cloudUser.nickname || oldUser.nickname || oldUser.nickName || '同学'
  const nextUser = saveCurrentUser({
    ...oldUser,
    ...cloudUser,
    nickname,
    avatarUrl: cloudUser.avatarUrl || oldUser.avatarUrl || '',
    avatarText: cloudUser.avatarText || oldUser.avatarText || nickname.slice(0, 1) || '同',
    phone,
    phoneMasked: cloudUser.phoneMasked || result.phoneMasked || maskPhone(phone),
    phoneBound: true,
    phoneBoundAt: cloudUser.phoneBoundAt || oldUser.phoneBoundAt || new Date().toISOString(),
    phoneAuthorizedAt: cloudUser.phoneAuthorizedAt || oldUser.phoneAuthorizedAt || new Date().toISOString(),
    profileCompleted: cloudUser.profileCompleted === true,
    nicknameSource: cloudUser.nicknameSource || oldUser.nicknameSource || 'server_random',
    membershipType: membership.membershipType || cloudUser.membershipType || 'free',
    membershipStatus: membership.membershipStatus || cloudUser.membershipStatus || 'active',
    membershipStartAt: membership.membershipStartAt || cloudUser.membershipStartAt || '',
    membershipEndAt: membership.membershipEndAt == null
      ? (cloudUser.membershipEndAt || null)
      : membership.membershipEndAt,
    role: membership.role || cloudUser.role || 'user',
    isAdmin: membership.isAdmin === true || cloudUser.isAdmin === true,
    aiDailyLimit: membership.aiDailyLimit == null ? cloudUser.aiDailyLimit : membership.aiDailyLimit,
    aiMonthlyLimit: membership.aiMonthlyLimit == null ? cloudUser.aiMonthlyLimit : membership.aiMonthlyLimit,
    hasAdvancedAccess: result.hasAdvancedAccess === true,
    accessPackages: Array.isArray(result.packages) ? result.packages : (oldUser.accessPackages || []),
    isLogin: true,
    isLoggedIn: true
  })
  const memberProfile = {
    isMember: ['monthly', 'yearly', 'admin'].includes(nextUser.membershipType),
    membershipType: nextUser.membershipType,
    memberType: nextUser.membershipType,
    membershipStatus: nextUser.membershipStatus,
    membershipStartAt: nextUser.membershipStartAt,
    membershipEndAt: nextUser.membershipEndAt,
    expireAt: nextUser.membershipEndAt,
    isAdmin: nextUser.isAdmin === true,
    aiDailyLimit: nextUser.aiDailyLimit,
    aiMonthlyLimit: nextUser.aiMonthlyLimit
  }

  wx.setStorageSync('memberProfile', memberProfile)
  wx.setStorageSync('loginState', {
    isLogin: true,
    phoneBound: true,
    loginAt: Date.now()
  })
  wx.removeStorageSync('justLoggedOut')

  // 同步 app.globalData
  auth.setUserInfo(nextUser)
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.memberProfile = memberProfile
    }
  }

  return nextUser
}

function waitForPhoneBinding(code, timeoutMs) {
  let timeoutId = null
  const binding = Promise.resolve().then(() => bindPhoneByCode(code))
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('手机号登录请求超时')
      error.code = 'PHONE_LOGIN_TIMEOUT'
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([binding, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

async function bindPhoneWithCode(code, options = {}) {
  try {
    const requestedTimeout = Number(options.timeoutMs)
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : PHONE_LOGIN_TIMEOUT_MS
    const result = await waitForPhoneBinding(code, timeoutMs)
    return {
      result,
      user: applyPhoneBindingResult(result)
    }
  } catch (error) {
    const result = error.result || {}
    const debugCode = result.debugCode || result.code || error.code || 'PHONE_BIND_FAILED'
    console.warn('[phone-auth] bindPhoneByCode failed:', { debugCode })
    const friendlyError = new Error(
      error && error.code === 'PHONE_LOGIN_TIMEOUT'
        ? '登录超时，请检查网络后重试'
        : (result.message || '当前暂无法完成手机号登录，请稍后重试')
    )
    friendlyError.code = result.code || error.code || 'phone_bind_failed'
    friendlyError.debugCode = debugCode
    throw friendlyError
  }
}

async function refreshPhoneMembership() {
  if (!isPhoneBound()) return getCurrentUser()
  const result = await getMe()
  return applyPhoneBindingResult({
    userProfile: result.user || {},
    membershipProfile: result.access || {},
    phone: result.user && result.user.phone,
    phoneMasked: result.user && result.user.phoneMasked,
    packages: result.access && result.access.packages,
    hasAdvancedAccess: result.access && result.access.hasAdvancedAccess
  })
}

/**
 * requirePhoneBound — 统一委托给 auth.js。
 * 保持与旧接口兼容：返回 boolean，不传 callback。
 *
 * @param {string} actionName
 * @param {Object} options
 * @returns {boolean} 已绑定手机号返回 true，否则 false
 */
function requirePhoneBound(actionName, options = {}) {
  // 已绑定 → 直接返回 true
  if (isPhoneBound()) return true

  // 未登录 → 打开唯一的手机号授权入口。
  auth.requirePhoneBound(null, {
    actionName: actionName || '',
    page: options.page || null,
    source: options.source || '',
    resumePolicy: options.resumePolicy || 'manual_retry'
  })
  return false
}

module.exports = {
  applyPhoneBindingResult,
  bindPhoneWithCode,
  getPhoneRequiredMessage,
  isPhoneBound,
  refreshPhoneMembership,
  requirePhoneBound
}
