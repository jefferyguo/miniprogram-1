const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')

Page({
  data: {
    // 首页暂时保留为占位页，主训练入口已移动到训练页
  },

  onLoad() {
    enableShareMenu()
  },

  goTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  },

  onShareAppMessage() {
    return getDefaultShareMessage({ imageUrl: getShareImage('home') })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({ targetPage: 'training', imageUrl: getShareImage('home') })
  }
})
