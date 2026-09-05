const { disableShareMenu } = require('../../utils/share-config')

function formatSeconds(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minute = Math.floor(safeSeconds / 60)
  const second = safeSeconds % 60
  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

Page({
  data: {
    src: '',
    title: '视频预览',
    rotate: 0,
    objectFit: 'contain',
    fitText: '铺满画面',
    currentText: '00:00',
    durationText: '00:00',
    isReady: false,
    hasError: false
  },

  onLoad(options = {}) {
    disableShareMenu()
    const previewKey = options.previewKey ? decodeURIComponent(options.previewKey) : ''
    let preview = null
    try {
      preview = previewKey ? wx.getStorageSync(previewKey) : null
      if (previewKey) wx.removeStorageSync(previewKey)
    } catch (error) {
      preview = null
    }
    const createdAt = Number(preview && preview.createdAt || 0)
    const valid = Boolean(
      preview && preview.src && createdAt > 0 && Date.now() - createdAt <= 10 * 60 * 1000
    )
    const src = valid ? String(preview.src) : ''
    const title = valid ? String(preview.title || '视频预览') : '视频预览'

    this.setData({
      src,
      title
    })

    if (!src) {
      this.setData({
        hasError: true
      })
      wx.showToast({
        title: '视频文件暂时无法查看',
        icon: 'none'
      })
    }
  },

  onShow() {
    disableShareMenu()
  },

  onVideoLoaded(e) {
    const duration = Number(e.detail && e.detail.duration)

    this.setData({
      isReady: true,
      hasError: false,
      durationText: formatSeconds(duration)
    })
  },

  onTimeUpdate(e) {
    const currentTime = Number(e.detail && e.detail.currentTime)
    const duration = Number(e.detail && e.detail.duration)

    this.setData({
      currentText: formatSeconds(currentTime),
      durationText: formatSeconds(duration)
    })
  },

  onVideoError(error) {
    console.error('video preview error', error)
    this.setData({
      hasError: true
    })
    wx.showToast({
      title: '视频文件暂时无法查看',
      icon: 'none'
    })
  },

  rotateVideo() {
    const next = (this.data.rotate + 90) % 360

    this.setData({
      rotate: next
    })
  },

  toggleFit() {
    const isContain = this.data.objectFit === 'contain'

    this.setData({
      objectFit: isContain ? 'cover' : 'contain',
      fitText: isContain ? '完整显示' : '铺满画面'
    })
  }
})
