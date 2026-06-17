Page({
  data: {
    qrLoadError: false
  },

  onQrImageError() {
    this.setData({
      qrLoadError: true
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
