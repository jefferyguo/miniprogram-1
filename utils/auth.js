let pendingAction = null

const USER_STORAGE_KEY = 'userInfo'
const LOGIN_PAGE = '/pages/login/login'

function getCurrentUser() {
  return wx.getStorageSync(USER_STORAGE_KEY) || null
}

function isLoggedIn() {
  const userInfo = getCurrentUser()

  return !!(userInfo && (userInfo.openid || userInfo.isLoggedIn === true))
}

function setUserInfo(userInfo) {
  wx.setStorageSync(USER_STORAGE_KEY, userInfo)
}

function clearUserInfo() {
  wx.removeStorageSync(USER_STORAGE_KEY)
}

function buildLoginUrl(redirect = '') {
  return redirect
    ? `${LOGIN_PAGE}?redirect=${encodeURIComponent(redirect)}`
    : LOGIN_PAGE
}

function goLogin(options = {}) {
  wx.navigateTo({
    url: buildLoginUrl(options.redirect || '')
  })
}

function requireLogin(callback, options = {}) {
  if (isLoggedIn()) {
    return typeof callback === 'function' ? callback() : undefined
  }

  // 有 redirect 的动作由登录页继续跳转；没有 redirect 的动作使用内存回调兜底。
  pendingAction = options.redirect ? null : callback
  goLogin(options)
  return undefined
}

function consumePendingAction() {
  const action = pendingAction
  pendingAction = null

  if (typeof action !== 'function') return null

  return action()
}

module.exports = {
  USER_STORAGE_KEY,
  getCurrentUser,
  isLoggedIn,
  setUserInfo,
  clearUserInfo,
  requireLogin,
  consumePendingAction,
  goLogin
}
