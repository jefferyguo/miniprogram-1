Page({
  data: {
    classCode: '',
    sceneText: ''
  },

  onLoad(options = {}) {
    const scene = options.scene ? decodeURIComponent(options.scene) : ''
    const classCode = options.classCode || scene.replace(/^c_/, '')

    this.setData({
      classCode,
      sceneText: scene
    })
  },

  backToPrevious() {
    wx.navigateBack({
      delta: 1
    })
  }
})
