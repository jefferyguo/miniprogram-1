Page({
  data: {
    // 首页暂时保留为占位页，主训练入口已移动到训练页
  },

  goTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  }
})
