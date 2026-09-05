const { bindPhoneWithCode } = require('../../utils/phone-auth')
const { getCurrentUser } = require('../../utils/access-control')

function getPhoneAuthorizationFeedback(detail = {}) {
  const errMsg = String(detail.errMsg || '').toLowerCase()
  if (errMsg.includes('deny') || errMsg.includes('cancel')) {
    return '已取消手机号授权，请重试'
  }
  return '手机号授权失败，请重试'
}

function getPhoneLoginFeedback(error = {}) {
  const code = String(error.code || error.debugCode || '')
  if (code === 'PHONE_ALREADY_BOUND') return '该手机号已绑定其他账号'
  if (code === 'PHONE_REBIND_NOT_ALLOWED') return '当前账号已绑定其他手机号'
  if (code === 'PHONE_LOGIN_TIMEOUT') return '登录超时，请检查网络后重试'
  if (code === 'CLOUD_NOT_SUPPORTED') return '当前微信版本暂不支持登录，请升级后重试'
  return '登录失败，请重试'
}

Component({
  data: {
    visible: false,
    phoneBinding: false,
    waitingNativePhoneAuth: false,
    privacyAgreed: false
  },

  methods: {
    open(options = {}) {
      this._callbacks = {
        onClose: options.onClose || null,
        onPhoneBound: options.onPhoneBound || null,
        onSkip: options.onSkip || null,
        onNativePhoneStateChange: options.onNativePhoneStateChange || null
      }
      this.setData({
        visible: true,
        phoneBinding: false,
        waitingNativePhoneAuth: false,
        privacyAgreed: false
      })
    },

    abortSession() {
      this._callbacks = null
      this.setData({
        visible: false,
        phoneBinding: false,
        waitingNativePhoneAuth: false,
        privacyAgreed: false
      })
    },

    close() {
      if (this.data.phoneBinding || this.data.waitingNativePhoneAuth) return
      this.setData({ visible: false })
      const callbacks = this._callbacks || {}
      if (typeof callbacks.onClose === 'function') {
        callbacks.onClose({ phoneBound: false, cancelled: true })
      }
      this._callbacks = null
    },

    skip() {
      if (this.data.phoneBinding) return
      const callbacks = this._callbacks || {}
      if (typeof callbacks.onSkip === 'function') callbacks.onSkip()
      this.close()
    },

    noop() {},

    onToggleAgreement() {
      this.setData({ privacyAgreed: !this.data.privacyAgreed })
    },

    onPrivacyRequired() {
      wx.showToast({ title: '请先阅读并同意用户服务协议和隐私政策', icon: 'none' })
    },

    onOpenPrivacy(e) {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      wx.navigateTo({ url: '/pages/privacy/privacy?type=privacy' })
    },

    onOpenUserAgreement(e) {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      wx.navigateTo({ url: '/pages/privacy/privacy?type=agreement' })
    },

    setNativePhoneWaiting(waiting) {
      this.setData({ waitingNativePhoneAuth: waiting === true })
      const callbacks = this._callbacks || {}
      if (typeof callbacks.onNativePhoneStateChange === 'function') {
        callbacks.onNativePhoneStateChange(waiting === true)
      }
    },

    async onGetPhoneNumber(event) {
      this.setNativePhoneWaiting(false)
      if (!this.data.privacyAgreed) {
        wx.showToast({ title: '请先阅读并同意用户服务协议和隐私政策', icon: 'none' })
        return
      }
      if (this.data.phoneBinding) return
      const detail = event && event.detail || {}
      const code = String(detail.code || '').trim()
      if (!code) {
        wx.showToast({ title: getPhoneAuthorizationFeedback(detail), icon: 'none' })
        return
      }

      this.setData({ phoneBinding: true })
      wx.showLoading({ title: '正在登录', mask: true })
      let loginError = null
      let user = null
      try {
        await bindPhoneWithCode(code)
        user = getCurrentUser() || {}
      } catch (error) {
        loginError = error || new Error('PHONE_LOGIN_FAILED')
        console.warn('[login-gate] 手机号登录失败:', {
          code: error && (error.code || error.debugCode),
          message: error && error.message
        })
      } finally {
        wx.hideLoading()
        this.setData({ phoneBinding: false })
      }

      if (loginError) {
        wx.showToast({ title: getPhoneLoginFeedback(loginError), icon: 'none' })
        return
      }

      const callbacks = this._callbacks || {}
      this.setData({ visible: false })
      this._callbacks = null
      try {
        if (typeof callbacks.onPhoneBound === 'function') callbacks.onPhoneBound(user)
        if (typeof callbacks.onClose === 'function') {
          callbacks.onClose({ phoneBound: true, cancelled: false })
        }
      } catch (callbackError) {
        console.warn('[login-gate] 登录完成回调失败:', callbackError && callbackError.message)
      }
      wx.showToast({ title: '登录成功', icon: 'success' })
    },

    viewPrivacy() {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
    }
  }
})
