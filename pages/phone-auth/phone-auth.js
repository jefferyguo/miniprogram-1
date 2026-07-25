const { getCurrentUser, isPhoneBound } = require('../../utils/access-control')
const { bindPhoneWithCode } = require('../../utils/phone-auth')

Page({
  data: {
    redirect: '',
    binding: false,
    phoneBound: false,
    phoneStatusText: '未绑定手机号',
    qrImage: '/images/customer-service-qr.png',
    qrLoadError: false
  },

  onLoad(options) {
    this.setData({
      redirect: options.redirect ? decodeURIComponent(options.redirect) : ''
    })
    this.loadStatus()
  },

  onShow() {
    this.loadStatus()
  },

  loadStatus() {
    const user = getCurrentUser()
    const phoneBound = isPhoneBound(user)
    this.setData({
      phoneBound,
      phoneStatusText: phoneBound
        ? `已绑定：${user.phoneMasked || '手机号已脱敏'}`
        : '未绑定手机号'
    })
  },

  async onGetPhoneNumber(e) {
    if (this.data.binding) return
    const detail = e.detail || {}

    if (!detail.code) {
      wx.showToast({
        title: '需要绑定手机号后才能保存训练记录和使用 AI 点评',
        icon: 'none'
      })
      return
    }

    this.setData({ binding: true })
    wx.showLoading({ title: '正在绑定', mask: true })
    let bindingSucceeded = false
    let errorMessage = ''

    try {
      await bindPhoneWithCode(detail.code)
      this.loadStatus()
      bindingSucceeded = true
    } catch (error) {
      errorMessage = error.message || '当前暂无法获取手机号，请联系周老师绑定手机号'
    } finally {
      wx.hideLoading()
      this.setData({ binding: false })
    }

    wx.showToast({
      title: bindingSucceeded ? '手机号绑定成功' : errorMessage,
      icon: bindingSucceeded ? 'success' : 'none'
    })
    if (bindingSucceeded) setTimeout(() => this.goRedirect(), 300)
  },

  skip() {
    this.goRedirect()
  },

  goRedirect() {
    const redirect = this.data.redirect
    if (!redirect) {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/training/training' })
      })
      return
    }

    const tabPages = [
      '/pages/training/training',
      '/pages/review/review',
      '/pages/square/square',
      '/pages/mine/mine'
    ]
    if (tabPages.includes(redirect)) {
      wx.switchTab({ url: redirect })
      return
    }
    wx.redirectTo({
      url: redirect,
      fail: () => wx.navigateTo({ url: redirect })
    })
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' })
  },

  onQrImageError() {
    this.setData({ qrLoadError: true })
  }
})
