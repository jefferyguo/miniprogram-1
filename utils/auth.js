/**
 * 统一认证工具。
 *
 * 只有两种对外状态：游客（Level 0）与手机号已验证用户（Level 2）。
 * 历史上仅完善昵称但未绑定手机号的 Level 1 不再视为登录。
 */

const {
  getAuthLevel: resolveAuthLevel,
  isAuthenticatedUser,
  isPhoneBoundUser
} = require('./auth-state')

const USER_STORAGE_KEY = 'userInfo'
const JUST_LOGGED_OUT_KEY = 'justLoggedOut'

let activeSession = null
let sessionSequence = 0

function getCurrentUser() {
  return wx.getStorageSync(USER_STORAGE_KEY) || null
}

function getAuthLevel() {
  return resolveAuthLevel(getCurrentUser())
}

function isAuthenticated() {
  return isAuthenticatedUser(getCurrentUser())
}

function isPhoneBound() {
  return isPhoneBoundUser(getCurrentUser())
}

/**
 * @deprecated 历史语义是“手机号已绑定”，新代码请使用 isPhoneBound()。
 */
function isLoggedIn() {
  return isPhoneBound()
}

function isAdminUser() {
  const userInfo = getCurrentUser()
  return isAuthenticatedUser(userInfo) && userInfo.isAdmin === true
}

function syncGlobalAuthState(userInfo) {
  if (typeof getApp !== 'function') return
  const app = getApp()
  if (!app || !app.globalData) return
  const level = resolveAuthLevel(userInfo)
  const authenticated = level === 2
  app.globalData.userInfo = authenticated ? userInfo : null
  app.globalData.isAuthenticated = authenticated
  app.globalData.isLogin = authenticated
  app.globalData.profileCompleted = authenticated
}

function setUserInfo(userInfo) {
  wx.setStorageSync(USER_STORAGE_KEY, userInfo)
  syncGlobalAuthState(userInfo)
}

function clearUserInfo() {
  wx.removeStorageSync(USER_STORAGE_KEY)
  wx.setStorageSync(JUST_LOGGED_OUT_KEY, true)
  if (typeof getApp !== 'function') return
  const app = getApp()
  if (!app || !app.globalData) return
  app.globalData.userInfo = null
  app.globalData.isLogin = false
  app.globalData.isAuthenticated = false
  app.globalData.memberProfile = null
  app.globalData.profileCompleted = false
  app.globalData.skippedProfileAuth = false
}

function getTopPage() {
  if (typeof getCurrentPages !== 'function') return null
  const pages = getCurrentPages()
  return pages.length ? pages[pages.length - 1] : null
}

function getGateOnPage(page) {
  if (!page || typeof page.selectComponent !== 'function') return null
  try {
    const component = page.selectComponent('#login-gate')
    return component && component.data && component.data.visible !== undefined
      ? component
      : null
  } catch (_) {
    return null
  }
}

function isCurrentSession(sessionId) {
  return Boolean(activeSession && activeSession.id === sessionId)
}

function isSessionVisibleOnCurrentPage(session) {
  if (!session || !session.component || !session.hostPage) return false
  if (getTopPage() !== session.hostPage) return false
  return session.component.data && session.component.data.visible === true
}

function invalidateSession(reason, options = {}) {
  const session = activeSession
  if (!session) return null
  if (options.sessionId && session.id !== options.sessionId) return null
  activeSession = null
  if (options.hideComponent !== false && session.component && typeof session.component.abortSession === 'function') {
    session.component.abortSession()
  }
  console.warn('[auth] session released:', { reason, owner: session.owner, step: session.step })
  return session
}

function runSafeAction(session, user) {
  if (!session || session.resumePolicy !== 'safe_navigation') return
  const action = session.pendingAction
  session.pendingAction = null
  if (typeof action === 'function') setTimeout(() => action(user || getCurrentUser()), 100)
}

function finishSession(sessionId, result = {}) {
  if (!isCurrentSession(sessionId)) return false
  const session = activeSession
  activeSession = null

  if (result.manualRetry === true) {
    session.pendingAction = null
    wx.showToast({ title: '登录成功，请再次点击原操作', icon: 'none' })
    return true
  }

  if (result.completed === true) runSafeAction(session, result.user)
  else session.pendingAction = null
  return true
}

function openSession(options = {}) {
  if (activeSession) {
    if (isSessionVisibleOnCurrentPage(activeSession)) {
      return {
        opened: false,
        code: 'ALREADY_OPEN',
        sessionId: activeSession.id
      }
    }
    // 页面已经切换或组件销毁。旧回调通过 sessionId 自动失效，不会消费新流程。
    invalidateSession('stale_or_hidden_session')
  }

  const hostPage = getTopPage()
  const component = getGateOnPage(hostPage)
  if (!component) {
    wx.showToast({ title: '登录组件加载中，请稍后重试', icon: 'none' })
    return { opened: false, code: 'LOGIN_GATE_UNAVAILABLE' }
  }

  const resumePolicy = options.resumePolicy === 'safe_navigation'
    ? 'safe_navigation'
    : 'manual_retry'
  const sessionId = `auth_${Date.now()}_${++sessionSequence}`
  const session = {
    id: sessionId,
    owner: String(options.source || hostPage.route || 'unknown'),
    step: 'phone',
    visible: true,
    startedAt: Date.now(),
    waitingNativePhoneAuth: false,
    targetLevel: 2,
    resumePolicy,
    pendingAction: resumePolicy === 'safe_navigation' && typeof options.onComplete === 'function'
      ? options.onComplete
      : null,
    hostPage,
    component
  }
  activeSession = session

  try {
    component.open({
      sessionId,
      targetLevel: 2,
      requirePhone: true,
      onNativePhoneStateChange: waiting => {
        if (!isCurrentSession(sessionId)) return
        activeSession.waitingNativePhoneAuth = waiting === true
        activeSession.step = waiting ? 'native_phone' : 'phone'
      },
      onPhoneBound: user => {
        if (!isCurrentSession(sessionId)) return
        finishSession(sessionId, {
          completed: true,
          manualRetry: resumePolicy === 'manual_retry',
          user
        })
      },
      onSkip: () => {
        if (!isCurrentSession(sessionId)) return
        finishSession(sessionId, { completed: false })
      },
      onClose: result => {
        if (!isCurrentSession(sessionId)) return
        const state = result || {}
        finishSession(sessionId, {
          completed: state.phoneBound === true && state.cancelled !== true,
          user: getCurrentUser()
        })
      }
    })
  } catch (error) {
    invalidateSession('component_open_failed', { sessionId, hideComponent: false })
    console.error('[auth] login-gate open failed:', error && error.message)
    return { opened: false, code: 'LOGIN_GATE_OPEN_FAILED', error }
  }

  return { opened: true, code: 'OPENED', sessionId }
}

function startUnifiedAuthFlow(options = {}) {
  const level = getAuthLevel()
  if (level === 2) {
    if (typeof options.onComplete === 'function') options.onComplete(getCurrentUser())
    return { opened: false, completed: true, code: 'ALREADY_AUTHENTICATED', level }
  }

  return openSession({
    ...options,
    targetLevel: 2,
    requirePhone: true,
    allowDeferPhone: false
  })
}

function openLoginGate(options = {}) {
  return startUnifiedAuthFlow({
    ...options,
    targetLevel: 2,
    onComplete: options.onComplete
  })
}

function requireLogin(callback, options = {}) {
  if (isAuthenticated()) {
    if (typeof callback === 'function') callback(getCurrentUser())
    return true
  }

  startUnifiedAuthFlow({
    targetLevel: 2,
    source: options.source || options.actionName || 'require_login',
    resumePolicy: 'safe_navigation',
    onComplete: callback
  })
  return false
}

function requirePhoneBound(callback, options = {}) {
  if (isPhoneBound()) {
    if (typeof callback === 'function') callback(getCurrentUser())
    return true
  }

  const resumePolicy = options.resumePolicy === 'safe_navigation'
    ? 'safe_navigation'
    : 'manual_retry'
  startUnifiedAuthFlow({
    targetLevel: 2,
    source: options.source || options.actionName || 'require_phone',
    resumePolicy,
    // 高风险 manual_retry 不保留 callback，从数据结构上避免重放。
    onComplete: resumePolicy === 'safe_navigation' ? callback : null
  })
  return false
}

function resetLoginGate(options = {}) {
  if (!activeSession) return false
  if (options.sessionId && activeSession.id !== options.sessionId) return false
  if (options.owner && activeSession.owner !== options.owner) return false
  invalidateSession(options.reason || 'explicit_reset', {
    sessionId: options.sessionId,
    hideComponent: options.hideComponent
  })
  return true
}

function consumePendingAction() {
  if (!activeSession || activeSession.resumePolicy !== 'safe_navigation') return null
  const action = activeSession.pendingAction
  activeSession.pendingAction = null
  return typeof action === 'function' ? action(getCurrentUser()) : null
}

module.exports = {
  USER_STORAGE_KEY,
  clearUserInfo,
  consumePendingAction,
  getAuthLevel,
  getCurrentUser,
  isAdminUser,
  isAuthenticated,
  isLoggedIn,
  isPhoneBound,
  openLoginGate,
  requireLogin,
  requirePhoneBound,
  resetLoginGate,
  setUserInfo,
  startUnifiedAuthFlow
}
