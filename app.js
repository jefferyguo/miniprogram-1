// app.js
const { normalizeShareQuery, resolveShareTarget } = require('./utils/share-config')
const SINGLE_PAGE_SCENE = 1154

App({
  onLaunch(options = {}) {
    const isSinglePageMode = this.updateSinglePageMode(options)

    // 初始化微信云开发，用于前端安全调用云函数
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0geb9qt9d29ee6fc',
        traceUser: true
      })
    } else {
      console.error('请使用支持云开发的微信开发者工具')
    }

    if (!isSinglePageMode) {
      // 启动时从本地缓存恢复登录状态，避免页面重开后短暂显示游客态。
      const savedUserInfo = wx.getStorageSync('userInfo') || null
      const savedPhone = String((savedUserInfo && savedUserInfo.phone) || '').replace(/\D/g, '')
      const isLogin = Boolean(savedUserInfo && savedUserInfo.phoneBound === true && /^1\d{10}$/.test(savedPhone))
      this.globalData.userInfo = isLogin ? savedUserInfo : null
      this.globalData.isLogin = isLogin
      this.globalData.memberProfile = isLogin ? (wx.getStorageSync('memberProfile') || null) : null
      this.globalData.profileCompleted = isLogin && wx.getStorageSync('profileCompleted') === true
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

  globalData: {
    userInfo: null,
    isLogin: false,
    memberProfile: null,
    profileCompleted: false,
    skippedProfileAuth: false,
    isSinglePageMode: false,
    role: 'student', // student 学员 / teacher 老师 / admin 管理员
    apiBaseUrl: ''
  }
})
