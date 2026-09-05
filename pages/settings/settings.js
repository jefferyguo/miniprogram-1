const {
  hasValidVoiceConsent,
  withdrawVoiceConsent
} = require('../../utils/voice-consent')
const {
  DEFAULT_FONT_SCALE_PERCENT,
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  FONT_SCALE_STEP_PERCENT,
  createFontSizePageData,
  setFontScalePercent,
  snapFontScalePercent
} = require('../../utils/font-size')

Page({
  data: {
    versionText: '杨勤口才训练KEEP v1.0.2',
    voiceConsentAccepted: false,
    voiceConsentStatusText: '未授权，开始录制时将单独询问',
    fontScaleMinPercent: FONT_SCALE_MIN_PERCENT,
    fontScaleMaxPercent: FONT_SCALE_MAX_PERCENT,
    fontScaleStepPercent: FONT_SCALE_STEP_PERCENT,
    fontScaleStandardPercent: DEFAULT_FONT_SCALE_PERCENT,
    fontScaleStandardOffset: (
      (DEFAULT_FONT_SCALE_PERCENT - FONT_SCALE_MIN_PERCENT) /
      (FONT_SCALE_MAX_PERCENT - FONT_SCALE_MIN_PERCENT)
    ) * 100
  },

  onShow() {
    this.loadVoiceConsentStatus()
  },

  onFontScaleChanging(event) {
    const percent = snapFontScalePercent(event.detail.value)
    if (percent === this.data.fontScalePercent) return
    this.setData(createFontSizePageData(percent))
  },

  onFontScaleChange(event) {
    setFontScalePercent(snapFontScalePercent(event.detail.value))
  },

  loadVoiceConsentStatus() {
    const accepted = hasValidVoiceConsent()
    this.setData({
      voiceConsentAccepted: accepted,
      voiceConsentStatusText: accepted ? '已同意，可随时撤回' : '未授权，开始录制时将单独询问'
    })
  },

  viewVoiceprintAgreement() {
    wx.navigateTo({ url: '/pages/voiceprint-agreement/voiceprint-agreement' })
  },

  withdrawVoiceAuthorization() {
    if (!this.data.voiceConsentAccepted) return

    wx.showModal({
      title: '撤回声音信息授权？',
      content: '撤回后，下次录音或录像前需重新同意《声纹授权协议》。系统麦克风权限状态不会被修改。',
      cancelText: '取消',
      confirmText: '确认撤回',
      confirmColor: '#d85b5b',
      success: result => {
        if (!result.confirm) return
        withdrawVoiceConsent()
        this.loadVoiceConsentStatus()
        wx.showToast({ title: '声音授权已撤回', icon: 'success' })
      }
    })
  },

  clearLocalCache() {
    wx.showModal({
      title: '清除本地缓存',
      content: '将清除本机训练草稿、临时记录和缓存数据，不会清除已提交作品、测评结果和登录信息。是否继续？',
      cancelText: '取消',
      confirmText: '确认清除',
      confirmColor: '#ff4d4f',
      success: res => {
        if (!res.confirm) return

        // 仅清除草稿和临时缓存，保留提交作品、测评结果和 userInfo。
        wx.removeStorageSync('trainingDrafts')
        wx.removeStorageSync('extraTrainingDrafts')
        wx.removeStorageSync('tempRecordings')

        wx.showToast({
          title: '缓存已清除',
          icon: 'success'
        })
      }
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后，本机将不再显示当前登录状态。是否确认退出？',
      cancelText: '取消',
      confirmText: '退出登录',
      confirmColor: '#ff4d4f',
      success: res => {
        if (!res.confirm) return

        // 只清除登录态，不清除训练作品和测评记录。
        wx.removeStorageSync('userInfo')

        wx.showToast({
          title: '已退出登录',
          icon: 'success'
        })

        setTimeout(() => {
          wx.switchTab({
            url: '/pages/mine/mine'
          })
        }, 500)
      }
    })
  }
})
