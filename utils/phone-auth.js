const { bindPhoneByCode, getMe } = require('./cloud-api')
const {
  getCurrentUser,
  isPhoneBound,
  maskPhone,
  saveCurrentUser
} = require('./access-control')

const PHONE_REQUIRED_MESSAGES = {
  '保存训练记录': '保存训练记录需要先绑定手机号',
  '提交训练作品': '提交训练作品需要先绑定手机号',
  '生成 AI 点评': '生成 AI 点评需要先绑定手机号',
  '发布广场': '发布广场需要先绑定手机号',
  '查看训练记录': '查看训练记录需要先绑定手机号',
  '使用会员训练内容': '使用会员训练内容需要先绑定手机号',
  '表达力测评': '生成表达力测评报告需要先绑定手机号',
  '开通会员': '请先登录并绑定手机号，便于自动匹配会员权益。'
}

function getPhoneRequiredMessage(actionName) {
  return PHONE_REQUIRED_MESSAGES[actionName] || `${actionName || '当前操作'}需要先绑定手机号`
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

  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.userInfo = nextUser
      app.globalData.isLogin = true
      app.globalData.memberProfile = memberProfile
    }
  }

  return nextUser
}

async function bindPhoneWithCode(code) {
  const user = getCurrentUser()
  try {
    const result = await bindPhoneByCode(code, user.nickname || user.nickName || '同学')
    return {
      result,
      user: applyPhoneBindingResult(result)
    }
  } catch (error) {
    const result = error.result || {}
    const debugCode = result.debugCode || result.code || error.code || 'PHONE_BIND_FAILED'
    console.warn('[phone-auth] bindPhoneByCode failed:', { debugCode })
    const friendlyError = new Error(result.message || '当前暂无法完成手机号登录，请稍后重试或联系周老师')
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

function getCurrentPage() {
  if (typeof getCurrentPages !== 'function') return null
  const pages = getCurrentPages()
  return pages[pages.length - 1] || null
}

function showPhoneLoginPrompt(actionName, options = {}) {
  const page = options.page || getCurrentPage()
  const route = String((page && page.route) || '')
  wx.showModal({
    title: '请先登录',
    content: options.message || '绑定手机号后可保存训练记录、生成 AI 点评，并自动匹配会员权益。',
    confirmText: '去登录',
    cancelText: '暂不登录',
    success: result => {
      if (!result.confirm) return
      if (route === 'pages/mine/mine') {
        wx.pageScrollTo({ scrollTop: 0, duration: 200 })
        wx.showToast({ title: '请点击顶部登录', icon: 'none' })
        return
      }
      wx.switchTab({
        url: '/pages/mine/mine',
        fail: () => wx.showToast({ title: '请到“我的”页登录', icon: 'none' })
      })
    }
  })
  return true
}

function requirePhoneBound(actionName, options = {}) {
  if (isPhoneBound()) return true
  showPhoneLoginPrompt(actionName, options)
  return false
}

module.exports = {
  applyPhoneBindingResult,
  bindPhoneWithCode,
  getPhoneRequiredMessage,
  isPhoneBound,
  refreshPhoneMembership,
  requirePhoneBound,
  showPhoneLoginPrompt
}
