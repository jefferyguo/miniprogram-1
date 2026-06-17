Page({
  data: {
    qrLoadError: false
  },

  onQrImageError() {
    this.setData({
      qrLoadError: true
    })
  }
})
