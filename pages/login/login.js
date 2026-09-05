const auth = require('../../utils/auth')
const { bindPhoneWithCode } = require('../../utils/phone-auth')

const TAB_PAGES = [
  '/pages/training/training',
  '/pages/review/review',
  '/pages/square/square',
  '/pages/mine/mine'
]

Page({
  data: {
    redirect: '',
    bindingLogin: false
  },

  onLoad(options) {
    this.setData({ redirect: options.redirect || '' })
  },

  openLoginGate() {
    auth.requirePhoneBound(null, {
      actionName: '登录',
      source: 'login_page',
      resumePolicy: 'manual_retry'
    })
  },

  async onGetPhoneNumberLogin(e) {
    if (this.data.bindingLogin) return
    const code = e.detail && e.detail.code
    if (!code) {
      wx.showToast({
        title: '需要绑定手机号后才能保存训练记录和使用 AI 点评',
        icon: 'none'
      })
      return
    }

    this.setData({ bindingLogin: true })
    wx.showLoading({ title: '正在登录', mask: true })
    let loginSucceeded = false
    let errorMessage = ''
    try {
      await bindPhoneWithCode(code)
      loginSucceeded = true
    } catch (error) {
      errorMessage = error.message || '当前暂无法获取手机号，请联系周老师绑定手机号'
    } finally {
      wx.hideLoading()
      this.setData({ bindingLogin: false })
    }

    wx.showToast({
      title: loginSucceeded ? '登录成功' : errorMessage,
      icon: loginSucceeded ? 'success' : 'none'
    })
    if (loginSucceeded) setTimeout(() => this.goBackOrContinue(), 300)
  },

  skipLogin() {
    this.navigateBackSafely()
  },

  goBackOrContinue() {
    const pendingResult = auth.consumePendingAction()
    if (pendingResult !== null) {
      if (pendingResult === false || pendingResult === undefined) this.navigateBackSafely()
      return
    }

    const redirect = this.data.redirect ? decodeURIComponent(this.data.redirect) : ''
    if (redirect) {
      this.navigateAfterLogin(redirect)
      return
    }
    this.navigateBackSafely()
  },

  navigateAfterLogin(url) {
    if (TAB_PAGES.includes(url)) {
      wx.switchTab({ url })
      return
    }
    wx.redirectTo({ url, fail: () => this.navigateBackSafely() })
  },

  navigateBackSafely() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/training/training' })
    })
  }
})
