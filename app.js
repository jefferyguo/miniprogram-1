// app.js
const { normalizeShareQuery, resolveShareTarget } = require('./utils/share-config')
const { getAuthLevel } = require('./utils/auth-state')
const { normalizeError } = require('./utils/error-normalizer')
const {
  initializeFontScale,
  installFontSizePageMixin
} = require('./utils/font-size')
const SINGLE_PAGE_SCENE = 1154
const CLOUD_ENV = 'cloud1-d0geb9qt9d29ee6fc'
const CLOUD_INIT_TIMEOUT_MS = 10000
const STALE_AUTH_CACHE_KEYS = [
  'userInfo',
  'memberProfile',
  'profileCompleted',
  'loginState',
  'token',
  'sessionToken',
  'openid',
  'openId'
]

function normalizeCloudInitError(error, fallbackCode) {
  const message = error && (error.message || error.errMsg)
    ? String(error.message || error.errMsg)
    : '云开发初始化失败'
  const normalized = new Error(message)
  normalized.code = (error && (error.code || error.errCode)) || fallbackCode
  return normalized
}

installFontSizePageMixin()

App({
  onError(error) {
    console.error('[app-error] runtime error', normalizeError(error, 'Mini Program runtime error'))
  },

  onUnhandledRejection(event = {}) {
    const reason = Object.prototype.hasOwnProperty.call(event, 'reason') ? event.reason : event
    console.error('[app-error] unhandled rejection', normalizeError(reason, 'Unhandled promise rejection'))
  },

  onLaunch(options = {}) {
    const isSinglePageMode = this.updateSinglePageMode(options)
    initializeFontScale()

    // 统一云开发初始化状态机。启动失败只记录脱敏错误，后续点击可重试。
    this._cloudInitState = 'idle'
    this._cloudInitOk = false
    this._cloudInitError = null
    this._cloudInitPromise = null
    const initialCloudReady = this.ensureCloudReady()
    initialCloudReady.catch(error => {
      console.warn('[app] cloud init failed:', {
        code: error && error.code,
        message: error && error.message
      })
    })

    if (!isSinglePageMode) {
      // 启动时从本地缓存恢复登录状态，避免页面重开后短暂显示游客态。
      const savedUserInfo = wx.getStorageSync('userInfo') || null
      const authLevel = getAuthLevel(savedUserInfo)
      // 两层模型：0=Guest, 2=Phone-bound
      const isLogin = authLevel >= 2

      if (savedUserInfo && authLevel === 0) {
        STALE_AUTH_CACHE_KEYS.forEach(key => wx.removeStorageSync(key))
      }
      // 只有手机号已绑定（Level 2）才恢复 userInfo；Guest（Level 0）清空
      this.globalData.userInfo = isLogin ? savedUserInfo : null
      this.globalData.isLogin = isLogin
      this.globalData.isAuthenticated = isLogin
      this.globalData.memberProfile = isLogin ? (wx.getStorageSync('memberProfile') || null) : null
      this.globalData.profileCompleted = isLogin
      this.globalData.skippedProfileAuth = wx.getStorageSync('skippedProfileAuth') === true

      // 原有本地日志逻辑
      const logs = wx.getStorageSync('logs') || []
      logs.unshift(Date.now())
      wx.setStorageSync('logs', logs)
    }

    // 登录只在用户点击功能入口后触发，不在启动时强制登录
    this.handleShareLaunch(options)
  },

  onShow(options = {}) {
    this.updateSinglePageMode(options)
    this.handleShareLaunch(options)
  },

  updateSinglePageMode(options = {}) {
    const hasScene = options.scene !== undefined && options.scene !== null
    const isSinglePageMode = hasScene
      ? Number(options.scene) === SINGLE_PAGE_SCENE
      : Boolean(this.globalData.isSinglePageMode)
    this.globalData.isSinglePageMode = isSinglePageMode
    return isSinglePageMode
  },

  handleShareLaunch(options = {}) {
    // 朋友圈单页模式禁止页面跳转，当前分享页直接根据 query 展示公开内容。
    if (this.globalData.isSinglePageMode) return
    const query = normalizeShareQuery(options.query)
    if (!query.targetPage) return

    const target = resolveShareTarget(query)
    const launchPath = String(options.path || '').replace(/^\//, '')
    const launchKey = `${launchPath}|${JSON.stringify(query)}`
    const now = Date.now()

    // 冷启动时 onLaunch/onShow 会连续触发，短时间内只处理一次。
    if (this._lastShareLaunchKey === launchKey && now - this._lastShareLaunchAt < 2000) return
    this._lastShareLaunchKey = launchKey
    this._lastShareLaunchAt = now

    if (!target.valid) {
      console.warn('[app] 无法识别分享目标，返回首页:', target.requestedTargetPage)
    }

    setTimeout(() => {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const currentRoute = pages.length ? String(pages[pages.length - 1].route || '') : ''
      // 朋友圈正常情况下会直接打开分享发起页，此时不再操作页面栈。
      if (currentRoute === target.route) return

      const method = pages.length ? (target.isTab ? 'switchTab' : 'redirectTo') : 'reLaunch'
      if (typeof wx[method] !== 'function') return
      wx[method]({
        url: target.url,
        fail(error) {
          console.warn('[app] 分享目标页恢复失败:', target.url, error && error.errMsg)
        }
      })
    }, 120)
  },

  /**
   * 确保云开发已就绪。所有云调用入口应等待此方法。
   * - 已成功初始化：立即返回
   * - 正在初始化：复用同一Promise
   * - 初始化失败或超时：清理共享Promise，允许下一次调用重试
   */
  ensureCloudReady() {
    if (this._cloudInitState === 'ready' && this._cloudInitOk) return Promise.resolve(true)
    if (this._cloudInitState === 'initializing' && this._cloudInitPromise) {
      return this._cloudInitPromise
    }

    this._cloudInitState = 'initializing'
    this._cloudInitOk = false
    const timeoutMs = Number(this._cloudInitTimeoutMs || CLOUD_INIT_TIMEOUT_MS)
    let timeoutId = null

    const initAttempt = Promise.resolve().then(() => {
      if (!wx.cloud || typeof wx.cloud.init !== 'function') {
        throw normalizeCloudInitError(null, 'CLOUD_NOT_SUPPORTED')
      }
      return wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
    })
    const timeout = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(normalizeCloudInitError(new Error(`云开发初始化超过${timeoutMs}ms`), 'CLOUD_INIT_TIMEOUT'))
      }, timeoutMs)
    })

    let sharedPromise = null
    const corePromise = Promise.race([initAttempt, timeout])
      .then(() => {
        this._cloudInitState = 'ready'
        this._cloudInitOk = true
        this._cloudInitError = null
        return true
      })
      .catch(error => {
        const fallbackCode = error && error.code === 'CLOUD_INIT_TIMEOUT'
          ? 'CLOUD_INIT_TIMEOUT'
          : 'CLOUD_INIT_FAILED'
        const normalized = normalizeCloudInitError(error, fallbackCode)
        this._cloudInitState = 'failed'
        this._cloudInitOk = false
        this._cloudInitError = normalized
        throw normalized
      })

    sharedPromise = corePromise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
      if (this._cloudInitPromise === sharedPromise) this._cloudInitPromise = null
    })
    this._cloudInitPromise = sharedPromise
    this.cloudReady = sharedPromise
    return sharedPromise
  },

  globalData: {
    userInfo: null,
    isLogin: false,
    isAuthenticated: false,
    memberProfile: null,
    profileCompleted: false,
    skippedProfileAuth: false,
    isSinglePageMode: false,
    role: 'student', // student 学员 / teacher 老师 / admin 管理员
    apiBaseUrl: ''
  }
})
