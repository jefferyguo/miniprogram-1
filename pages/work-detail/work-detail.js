const {
  addSquareComment,
  deleteSquareComment,
  getSquareWorkDetail,
  listSquareComments,
  toggleSquareLike
} = require('../../utils/cloud-api')
const { requirePhoneBound } = require('../../utils/phone-auth')
const {
  createAudioPlayer,
  getInitialAudioPlayer,
  resolveWorkMedia
} = require('../../utils/work-media')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')
const { buildWorkShareConfig, getWorkShareImage, getWorkTrainingType } = require('../../utils/work-share')
const { generateWorkShareImage } = require('../../utils/work-share-canvas')
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
  const date = new Date(text.replace(/-/g, '/'))
  if (!date.getTime()) return text
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
    commentsLoading: false,
    comments: [],
    commentText: '',
    commentSubmitting: false,
    likeSubmitting: false,
    generatedShareImage: '',
    generatingShareImage: false,
    shareImageReady: false
  },

  onLoad(options = {}) {
    enableShareMenu()
    const workId = String(options.squareWorkId || options.workId || '').trim()
    this.setData({ workId })
    this.loadWorkDetail()
  },

  onShow() {
    enableShareMenu()
  },

  async loadWorkDetail() {
    if (!this.data.workId) {
      this.setData({ loading: false, unavailable: true, errorText: '该作品暂不可查看' })
      return
    }

    this.setData({ loading: true, unavailable: false, errorText: '' })
    try {
      const result = await getSquareWorkDetail(this.data.workId)
      const work = normalizeDetailWork(result.data || {})
      if (!work.available) {
        this.setData({ loading: false, unavailable: true, errorText: '该作品暂不可查看' })
        return
      }

      const media = resolveWorkMedia(work)
      let playableSrc = media.src && /^https?:\/\//i.test(media.src) ? media.src : ''
      if (!playableSrc && media.fileID) playableSrc = await getTempFileURL(media.fileID)
      this.setData({ loading: false, work, playableSrc }, () => {
        this.prepareWorkShareImage()
      })
      this.loadComments()
    } catch (error) {
      const code = getCloudErrorCode(error)
      const unavailable = ['WORK_NOT_AVAILABLE', 'WORK_NOT_FOUND'].includes(code)
      this.setData({
        loading: false,
        unavailable,
        errorText: unavailable ? '该作品暂不可查看' : getCloudErrorMessage(error, '作品加载失败，请稍后再试')
      })
    }
  },

  async loadComments() {
    if (!this.data.work) return
    this.setData({ commentsLoading: true })
    try {
      const result = await listSquareComments(this.data.work._id, 1, 50)
      const comments = result.data || []
      this.setData({ comments, commentsLoading: false, 'work.commentCount': Math.max(Number(result.total || 0), 0) })
    } catch (error) {
      this.setData({ commentsLoading: false })
      console.warn('[work-detail] load comments failed', getCloudErrorCode(error))
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

  onCommentInput(event) {
    this.setData({ commentText: event.detail.value || '' })
  },

  onSubmitComment() {
    if (!requirePhoneBound('发表评论', {
      page: this,
      onSuccess: () => this.submitComment()
    })) return
    this.submitComment()
  },

  async submitComment() {
    if (!this.data.work || this.data.commentSubmitting) return
    const content = String(this.data.commentText || '').trim()
    if (!content) {
      wx.showToast({ title: '评论内容不能为空', icon: 'none' })
      return
    }
    if (Array.from(content).length > 200) {
      wx.showToast({ title: '评论内容不能超过 200 字', icon: 'none' })
      return
    }

    this.setData({ commentSubmitting: true })
    try {
      const result = await addSquareComment(this.data.work._id, content)
      const comments = result.comment ? [result.comment, ...this.data.comments] : this.data.comments
      this.setData({
        comments,
        commentText: '',
        commentSubmitting: false,
        'work.commentCount': Math.max(Number(result.commentCount || comments.length), 0)
      })
      wx.showToast({ title: '评论已发布', icon: 'success' })
    } catch (error) {
      this.setData({ commentSubmitting: false })
      if (getCloudErrorCode(error) === 'COMMENT_FORBIDDEN_WORD') {
        wx.showModal({
          title: '评论未发布',
          content: '评论包含不适合公开展示的内容，请修改后再发布。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({ title: getCloudErrorMessage(error, '评论发布失败，请稍后再试'), icon: 'none' })
    }
  },

  onDeleteComment(event) {
    const commentId = String(event.currentTarget.dataset.id || '')
    if (!commentId) return
    wx.showModal({
      title: '删除评论',
      content: '确认删除这条评论吗？',
      confirmColor: '#d85050',
      success: async result => {
        if (!result.confirm) return
        try {
          const response = await deleteSquareComment(commentId)
          this.setData({
            comments: this.data.comments.filter(item => item._id !== commentId && item.id !== commentId),
            'work.commentCount': Math.max(Number(response.commentCount || 0), 0)
          })
        } catch (error) {
          wx.showToast({ title: getCloudErrorMessage(error, '删除失败，请稍后再试'), icon: 'none' })
        }
      }
    })
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
    if (!this.data.work || this.data.generatingShareImage) return
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
    if (this.data.work && this.data.work.available) {
      return getDefaultShareMessage({
        ...buildWorkShareConfig(this.data.work, 'square'),
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
