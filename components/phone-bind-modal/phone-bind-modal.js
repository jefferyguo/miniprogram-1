const { bindPhoneWithCode } = require('../../utils/phone-auth')
const auth = require('../../utils/auth')

Component({
  data: {
    visible: false,
    binding: false,
    actionName: '',
    message: '绑定手机号后可保存训练记录、生成 AI 点评，并自动匹配会员权益。'
  },

  methods: {
    open(options = {}) {
      this.successCallback = typeof options.onSuccess === 'function' ? options.onSuccess : null
      this.setData({
        visible: true,
        binding: false,
        actionName: options.actionName || '',
        message: options.message || '绑定手机号后可保存训练记录、生成 AI 点评，并自动匹配会员权益。'
      })
    },

    close() {
      if (this.data.binding) return
      this.successCallback = null
      this.setData({ visible: false })
    },

    noop() {},

    openLoginGate() {
      auth.requirePhoneBound(null, {
        actionName: '登录',
        source: 'phone_bind_modal',
        resumePolicy: 'manual_retry'
      })
    },

    async onGetPhoneNumberLogin(e) {
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
      let callback = null
      let user = null

      try {
        const bindingResult = await bindPhoneWithCode(detail.code)
        user = bindingResult.user
        const result = bindingResult.result
        callback = this.successCallback
        this.successCallback = null
        this.setData({ visible: false })
        this.triggerEvent('success', { user, result })
        bindingSucceeded = true
      } catch (error) {
        errorMessage = error.message || '当前暂无法获取手机号，请联系周老师绑定手机号'
      } finally {
        wx.hideLoading()
        this.setData({ binding: false })
      }

      wx.showToast({
        title: bindingSucceeded ? '登录成功' : errorMessage,
        icon: bindingSucceeded ? 'success' : 'none'
      })
      if (bindingSucceeded && typeof callback === 'function') setTimeout(() => callback(user), 200)
    },

    skip() {
      if (this.data.binding) return
      this.successCallback = null
      this.setData({ visible: false })
    }
  }
})
