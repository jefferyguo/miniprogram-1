Component({
  data: {
    visible: false
  },

  lifetimes: {
    detached() {
      this.finishConsent(false)
    }
  },

  methods: {
    requestConsent() {
      if (this._consentPromise) return this._consentPromise

      this.setData({ visible: true })
      this.triggerEvent('visibilitychange', { visible: true })
      this._consentPromise = new Promise(resolve => {
        this._resolveConsent = resolve
      })
      return this._consentPromise
    },

    finishConsent(accepted) {
      const resolve = this._resolveConsent
      this._resolveConsent = null
      this._consentPromise = null
      if (this.data.visible) this.setData({ visible: false })
      this.triggerEvent('visibilitychange', { visible: false })
      if (typeof resolve === 'function') resolve(accepted === true)
    },

    accept() {
      this.finishConsent(true)
    },

    decline() {
      this.finishConsent(false)
    },

    viewAgreement() {
      wx.navigateTo({ url: '/pages/voiceprint-agreement/voiceprint-agreement' })
    },

    noop() {}
  }
})
