const {
  getSquareWorkDetail,
  toggleSquareLike
} = require('../../utils/cloud-api')
const { requirePhoneBound } = require('../../utils/phone-auth')
const {
  createAudioPlayer,
  getInitialAudioPlayer,
  resolveWorkMedia
} = require('../../utils/work-media')
const {
  disableShareMenu,
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')
const { buildWorkShareConfig, getWorkShareImage, getWorkTrainingType } = require('../../utils/work-share')
const {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isWorkShareAllowed
} = require('../../utils/work-share-policy')
const { generateWorkShareImage } = require('../../utils/work-share-canvas')
const { formatShanghaiDateTime: formatShanghaiTime } = require('../../utils/shanghai-time')
const {
  HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
  getTrainingLocator,
  getTrainingSnapshot
} = require('../../utils/training-original')

const HISTORY_SNAPSHOT_STORAGE_PREFIX = 'historyTrainingSnapshot:'

function getCloudErrorCode(error) {
  return String(error && (error.code || error.result && error.result.code) || '')
}

function getCloudErrorMessage(error, fallback) {
  return String(error && (error.result && error.result.message || error.message) || fallback)
}

function getDetailShareCandidate(work = {}) {
  const candidates = [work.coverUrl, work.poster, work.thumbTempFilePath]
  return String(candidates.find(value => {
    const path = String(value || '').trim()
    if (!path || /^(cloud|file|blob):/i.test(path)) return false
    if (/[?&][^=]*(token|signature|credential|secret|key|sign)[^=]*=/i.test(path)) return false
    return /^(https?:\/\/|wxfile:\/\/|\/images\/)/i.test(path)
  }) || '')
}

function formatDateTime(value) {
  const text = String(value || '')
  if (!text) return '暂无'
  return formatShanghaiTime(text)
}

function getOriginalTaskTarget(work = {}) {
  const locator = getTrainingLocator(work)
  const { contentId, moduleId, day } = locator

  if (!locator.canView) {
    return {
      canView: false,
      url: '',
      moduleId,
      day,
      contentId
    }
  }

  const params = ['historyOriginal=1']
  if (moduleId) {
    params.push(`moduleId=${encodeURIComponent(moduleId)}`)
    params.push(`category=${encodeURIComponent(moduleId)}`)
  }
  if (day > 0) params.push(`day=${encodeURIComponent(day)}`)
  if (contentId) params.push(`contentId=${encodeURIComponent(contentId)}`)

  return {
    canView: true,
    url: `/pages/task-detail/task-detail?${params.join('&')}`,
    moduleId,
    day,
    contentId
  }
}

function normalizeDetailWork(work = {}) {
  const mediaType = work.mediaType === 'video' || work.workType === 'video' ? 'video' : 'audio'
  const title = work.title || work.taskTitle || work.contentTitle || '训练作品'
  const originalTask = getOriginalTaskTarget(work)
  return {
    ...work,
    title,
    titleText: title,
    authorName: work.authorName || work.publicNickname || '同学',
    mediaType,
    mediaTypeText: mediaType === 'video' ? '视频作品' : '音频作品',
    trainingTypeText: getWorkTrainingType(work),
    taskText: work.taskTitle || work.moduleTitle || '口才训练',
    dayText: Number(work.dayNumber || work.day || 0) > 0 ? `Day ${Number(work.dayNumber || work.day)}` : '',
    durationText: work.duration || (work.durationSeconds ? `${work.durationSeconds}秒` : '暂无'),
    createdAtText: formatDateTime(work.publicAt || work.createdAt || work.submittedAt),
    likeCount: Math.max(Number(work.likeCount || 0), 0),
    commentCount: Math.max(Number(work.commentCount || 0), 0),
    likedByMe: work.likedByMe === true,
    shareAllowed: isWorkShareAllowed(work),
    originalTask,
    canViewOriginal: originalTask.canView
  }
}

function getTempFileURL(fileID) {
  return new Promise(resolve => {
    if (!/^cloud:\/\//i.test(String(fileID || '')) || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      resolve('')
      return
    }
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(result) {
        const file = result && Array.isArray(result.fileList) ? result.fileList[0] : null
        const statusValid = file && (file.status === undefined || Number(file.status) === 0)
        resolve(statusValid ? String(file.tempFileURL || '') : '')
      },
      fail(error) {
        console.warn('[work-detail] get temp file URL failed', {
          errCode: error && error.errCode,
          errMsg: error && error.errMsg
        })
        resolve('')
      }
    })
  })
}

Page({
  data: {
    workId: '',
    loading: true,
    unavailable: false,
    errorText: '',
    work: null,
    playableSrc: '',
    audioPlayer: getInitialAudioPlayer(),
    likeSubmitting: false,
    generatedShareImage: '',
    generatingShareImage: false,
    shareImageReady: false,
    videoShareBlocked: false
  },

  onLoad(options = {}) {
    disableShareMenu()
    const workId = String(options.squareWorkId || options.workId || '').trim()
    this.setData({ workId })
    this.loadWorkDetail()
  },

  onShow() {
    if (this.data.work && isWorkShareAllowed(this.data.work)) enableShareMenu()
    else disableShareMenu()
  },

  async loadWorkDetail() {
    if (!this.data.workId) {
      this.setData({ loading: false, unavailable: true, errorText: '该作品暂不可查看' })
      return
    }

    this.setData({ loading: true, unavailable: false, errorText: '', videoShareBlocked: false })
    try {
      const result = await getSquareWorkDetail(this.data.workId)
      const work = normalizeDetailWork(result.data || {})
      if (!isWorkShareAllowed(work)) {
        disableShareMenu()
        this.setData({
          loading: false,
          unavailable: true,
          errorText: VIDEO_SHARE_DISABLED_MESSAGE,
          work: null,
          playableSrc: '',
          videoShareBlocked: true
        })
        return
      }
      if (!work.available) {
        this.setData({ loading: false, unavailable: true, errorText: '该作品暂不可查看' })
        return
      }

      const media = resolveWorkMedia(work)
      let playableSrc = media.src && /^https?:\/\//i.test(media.src) ? media.src : ''
      if (!playableSrc && media.fileID) playableSrc = await getTempFileURL(media.fileID)
      this.setData({ loading: false, work, playableSrc }, () => {
        enableShareMenu()
        this.prepareWorkShareImage()
      })
    } catch (error) {
      const code = getCloudErrorCode(error)
      const videoShareDisabled = code === 'VIDEO_SHARE_DISABLED'
      const unavailable = videoShareDisabled || ['WORK_NOT_AVAILABLE', 'WORK_NOT_FOUND'].includes(code)
      this.setData({
        loading: false,
        unavailable,
        videoShareBlocked: videoShareDisabled,
        errorText: videoShareDisabled
          ? VIDEO_SHARE_DISABLED_MESSAGE
          : unavailable ? '该作品暂不可查看' : getCloudErrorMessage(error, '作品加载失败，请稍后再试')
      })
    }
  },

  playAudio() {
    if (!this.data.playableSrc || !this.data.work) {
      wx.showToast({ title: '录音文件暂时无法播放', icon: 'none' })
      return
    }
    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this, { debugPrefix: '[work-detail-play]', autoplay: true })
    }
    this.audioPlayer.play({
      ...this.data.work,
      audioUrl: this.data.playableSrc,
      filePath: this.data.playableSrc,
      fileID: ''
    }, this.data.work._id)
  },

  onAudioSliderChange(event) {
    if (this.audioPlayer) this.audioPlayer.seek(event.detail.value)
  },

  onToggleLike() {
    if (!this.data.work || this.data.likeSubmitting) return
    if (!requirePhoneBound('点赞作品', {
      page: this,
      onSuccess: () => this.toggleLike()
    })) return
    this.toggleLike()
  },

  async toggleLike() {
    if (!this.data.work || this.data.likeSubmitting) return
    this.setData({ likeSubmitting: true })
    try {
      const result = await toggleSquareLike(this.data.work._id)
      this.setData({
        likeSubmitting: false,
        'work.likedByMe': result.liked === true,
        'work.likeCount': Math.max(Number(result.likeCount || 0), 0)
      })
    } catch (error) {
      this.setData({ likeSubmitting: false })
      wx.showToast({ title: getCloudErrorMessage(error, '点赞失败，请稍后再试'), icon: 'none' })
    }
  },

  goSquare() {
    wx.switchTab({ url: '/pages/square/square' })
  },

  goOriginalTask() {
    const work = this.data.work || {}
    const target = work.originalTask || getOriginalTaskTarget(work)

    if (!target.canView || !target.url) {
      wx.showModal({
        title: '历史原文暂不可查看',
        content: HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    let url = target.url
    const snapshot = getTrainingSnapshot(work)
    if (snapshot) {
      const snapshotKey = `${HISTORY_SNAPSHOT_STORAGE_PREFIX}${this.data.workId || Date.now()}`
      wx.setStorageSync(snapshotKey, snapshot)
      url += `&snapshotKey=${encodeURIComponent(snapshotKey)}`
    }

    wx.navigateTo({
      url,
      fail: () => {
        const app = typeof getApp === 'function' ? getApp() : null
        const isSinglePageMode = Boolean(app && app.globalData && app.globalData.isSinglePageMode)
        wx.showToast({
          title: isSinglePageMode ? '请点击底部“前往小程序”后查看原文' : '暂时无法打开原文',
          icon: 'none'
        })
      }
    })
  },

  async prepareWorkShareImage() {
    if (!this.data.work || !isWorkShareAllowed(this.data.work) || this.data.generatingShareImage) return
    if (this.data.shareImageReady && this.data.generatedShareImage) return
    this.setData({ generatingShareImage: true })
    try {
      const generatedShareImage = await generateWorkShareImage({
        canvasId: 'workShareCanvas',
        componentThis: this,
        work: this.data.work,
        fallbackImage: getShareImage('square') || getShareImage('default'),
        logoPath: '/images/yangqin-logo.jpg'
      })
      this.setData({
        generatedShareImage,
        shareImageReady: true
      })
    } catch (error) {
      console.warn('[work-share-canvas] generate failed', {
        errMsg: error && (error.errMsg || error.message) || 'unknown'
      })
      this.setData({
        generatedShareImage: '',
        shareImageReady: false
      })
    } finally {
      this.setData({ generatingShareImage: false })
    }
  },

  getCurrentShareImage() {
    if (this.data.generatedShareImage) return this.data.generatedShareImage
    if (this.data.work) {
      return getDetailShareCandidate(this.data.work) || getWorkShareImage(this.data.work, 'square')
    }
    return getShareImage('square') || getShareImage('default')
  },

  onShareAppMessage() {
    if (this.data.videoShareBlocked) {
      wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
      return undefined
    }
    if (!isWorkShareAllowed(this.data.work || { workType: 'audio' })) {
      wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
      return undefined
    }
    if (this.data.work && this.data.work.available) {
      const shareConfig = buildWorkShareConfig(this.data.work, 'square')
      if (!shareConfig) return undefined
      return getDefaultShareMessage({
        ...shareConfig,
        imageUrl: this.getCurrentShareImage()
      })
    }
    return getDefaultShareMessage({
      title: '表达广场｜看看大家的口才训练作品',
      path: '/pages/square/square',
      imageUrl: getShareImage('square')
    })
  },

  onShareTimeline() {
    if (this.data.videoShareBlocked) {
      wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
      return undefined
    }
    if (!isWorkShareAllowed(this.data.work || { workType: 'audio' })) {
      wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
      return undefined
    }
    const hasWork = Boolean(this.data.workId)
    const shareConfig = this.data.work
      ? buildWorkShareConfig(this.data.work, 'square')
      : null
    return getDefaultShareTimeline({
      title: shareConfig ? shareConfig.title : '表达广场｜口才训练作品',
      targetPage: hasWork ? 'work-detail' : 'square',
      params: hasWork ? { workId: this.data.workId } : {},
      imageUrl: this.getCurrentShareImage()
    })
  },

  onHide() {
    if (this.audioPlayer) this.audioPlayer.pause()
  },

  onUnload() {
    if (this.audioPlayer) this.audioPlayer.destroy()
  }
})
