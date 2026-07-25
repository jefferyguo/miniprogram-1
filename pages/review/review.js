const {
  generateFeedbackForSubmission,
  getFeedbackActionState,
  getFeedbackStatus,
  normalizeAiFeedback
} = require('../../utils/ai-feedback')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
const {
  formatDateTime,
  getAllSubmittedWorks,
  getSavedStatusClass,
  getSavedStatusText,
  getTeacherButtonText,
  getTeacherFeedbackState,
  getTeacherStatusClass,
  getTeacherStatusText,
  hasTeacherFeedback,
  patchWorkInStorages
} = require('../../utils/local-data')
const {
  createAudioPlayer,
  getAudioPath,
  getInitialAudioPlayer,
  getVideoPath,
  previewVideoByPath
} = require('../../utils/work-media')
const { publishWorkToSquare, unpublishWorkFromSquare } = require('../../utils/work-public')
const { deleteMyWork } = require('../../utils/cloud-api')
const { requirePhoneBound } = require('../../utils/phone-auth')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')
const { buildWorkShareConfig, getWorkPublicId } = require('../../utils/work-share')

const STORAGE_KEYS = {
  mainDrafts: 'trainingDrafts',
  mainSubmissions: 'trainingSubmissions',
  extraDrafts: 'extraTrainingDrafts',
  extraSubmissions: 'extraTrainingSubmissions'
}

function getShortText(text, maxLength = 32) {
  const value = String(text || '训练作品')
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function getAiFeedbackCount(works) {
  return works.filter(item => (
    item.aiFeedbackStatus === 'done' && item.aiFeedback
  )).length
}

function getAiStatusText(item) {
  const status = getFeedbackStatus(item)
  if (status === 'blocked') return '时长不足'
  if (status === 'pending') return 'AI生成中'
  if (status === 'done' && item.aiFeedback) return 'AI已生成'
  if (status === 'error') return 'AI失败'
  if (item.aiFeedback) return 'AI已生成'
  return 'AI待生成'
}

function getAiStatusClass(item) {
  const status = getFeedbackStatus(item)
  if (status === 'blocked') return 'blocked-status'
  if (status === 'pending') return 'ai-pending-status'
  if (status === 'error') return 'error-status'
  if (status === 'done' || item.aiFeedback) return 'ai-done-status'
  return 'pending-status'
}

function getAiTip(item) {
  const status = getFeedbackStatus(item)
  if (status === 'blocked') return '录音或录像需满 30 秒后再生成 AI 点评。'
  if (status === 'error') return 'AI点评生成失败，可稍后重试。'
  if (status === 'done' && item.aiFeedback) return 'AI点评已生成。'
  return ''
}

function getWorkShareId(item = {}) {
  return String(item.squareWorkId || item.shareId || item._id || item.cloudId || item.id || item.key || '')
}

function buildDisplayWork(item) {
  const feedbackAction = getFeedbackActionState(item)
  const workType = item.workType || item.type || 'audio'
  const key = item.key || `${item.sourceType || 'work'}-${item.id || item._id || item.cloudId || Date.now()}`
  const teacherState = getTeacherFeedbackState(item)

  return {
    ...item,
    key,
    shareId: getWorkShareId({ ...item, key }),
    audioKey: key,
    workType,
    displaySubtitle: item.displaySubtitle || (item.sourceType === 'main'
      ? (item.taskTitle || '训练任务')
      : getShortText(item.content)),
    savedStatusText: getSavedStatusText(item),
    savedStatusClass: getSavedStatusClass(item),
    aiStatusText: getAiStatusText(item),
    aiStatusClass: getAiStatusClass(item),
    teacherStatusText: getTeacherStatusText(item),
    teacherStatusClass: getTeacherStatusClass(item),
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    feedbackActionStatus: feedbackAction.status,
    aiTip: getAiTip(item),
    hasTeacherFeedback: teacherState === 'done',
    teacherButtonText: getTeacherButtonText(item),
    teacherButtonClass: teacherState === 'done' ? 'teacher-done-btn' : teacherState === 'pending' ? 'teacher-pending-btn' : 'teacher-ready-btn',
    teacherState
  }
}

function applyAiGeneratingState(item, generatingWorkKey) {
  if (!generatingWorkKey || item.key !== generatingWorkKey) return item

  return {
    ...item,
    feedbackActionText: '生成中...',
    feedbackActionDisabled: true,
    feedbackActionClass: 'feedback-generating-btn',
    feedbackActionStatus: 'generating',
    aiStatusText: 'AI生成中',
    aiStatusClass: 'ai-pending-status',
    aiTip: '正在分析录音内容，请稍候...'
  }
}

function matchTaskFilter(item, filter) {
  if (!filter || filter.type !== 'task') return true

  const sameDay = Number(item.day) === Number(filter.day)
  const sameModuleId = filter.moduleId && item.moduleId === filter.moduleId
  const sameModuleTitle = filter.moduleTitle && item.moduleTitle === filter.moduleTitle

  return item.sourceType === 'main' && sameDay && (sameModuleId || sameModuleTitle)
}

function getKeysBySource(sourceType) {
  if (sourceType === 'extra') {
    return {
      draftKey: STORAGE_KEYS.extraDrafts,
      submissionKey: STORAGE_KEYS.extraSubmissions
    }
  }

  return {
    draftKey: STORAGE_KEYS.mainDrafts,
    submissionKey: STORAGE_KEYS.mainSubmissions
  }
}

function removeWorkFromStorage(target) {
  const keys = getKeysBySource(target.sourceType)
  const matcher = item => String(item.id) !== String(target.id) && String(item.cloudId || '') !== String(target.cloudId || target.id)

  wx.setStorageSync(keys.draftKey, (wx.getStorageSync(keys.draftKey) || []).filter(matcher))
  wx.setStorageSync(keys.submissionKey, (wx.getStorageSync(keys.submissionKey) || []).filter(matcher))
}

Page({
  data: {
    // 点评中心展示已保存作品；筛选入口会在当前页内切换列表。
    works: [],
    filteredWorks: [],
    submittedWorks: [],
    filterType: 'all',
    filterTitle: '',
    totalCount: 0,
    pendingCount: 0,
    reviewedCount: 0,
    aiFeedbackCount: 0,
    feedbackCards: [],
    hasReviewFilter: false,
    reviewFilter: null,
    filterText: '',
    emptyTitle: '暂无已保存作品',
    emptyDesc: '完成训练并保存作品后，这里会显示你的作品和点评状态。',
    emptyButtonText: '去训练',
    teacherFeedbackEnabled: FEATURE_FLAGS.teacherFeedbackEnabled,
    audioPlayer: getInitialAudioPlayer(),
    showAiFeedbackPanel: false,
    currentAiFeedback: null,
    aiFeedbackScrollTop: 0,
    aiGeneratingWorkKey: '',
    currentShareWorkId: ''
  },

  onLoad(options = {}) {
    enableShareMenu()
    // 分享链接可能携带作品 ID；找不到对应本地作品时仍正常展示完整列表。
    this.setData({
      currentShareWorkId: String(options.workId || '')
    })
  },

  onShow() {
    enableShareMenu()
    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this)
    }
    if (!requirePhoneBound('查看训练记录', {
      page: this,
      onSuccess: () => this.loadReviewData()
    })) {
      this.setData({
        works: [],
        filteredWorks: [],
        submittedWorks: [],
        totalCount: 0,
        pendingCount: 0,
        reviewedCount: 0,
        aiFeedbackCount: 0,
        feedbackCards: []
      })
      return
    }
    this.loadReviewData()
  },

  loadReviewData() {
    const works = getAllSubmittedWorks()
      .map(buildDisplayWork)
      .map(item => applyAiGeneratingState(item, this.data.aiGeneratingWorkKey))
    const reviewFilter = wx.getStorageSync('reviewFilter') || null
    const aiFeedbackCount = getAiFeedbackCount(works)
    const pendingAiCount = works.length - aiFeedbackCount
    const feedbackCards = [
      {
        type: 'ai',
        title: 'AI点评',
        desc: '已保存作品可主动生成 AI 点评，包含优势、提升点和训练建议。'
      },
      {
        type: 'all',
        title: '已保存作品',
        desc: `当前已有 ${works.length} 个作品进入点评列表。`
      }
    ]

    this.setData({
      works,
      totalCount: works.length,
      pendingCount: pendingAiCount,
      reviewedCount: aiFeedbackCount,
      aiFeedbackCount,
      feedbackCards
    }, () => {
      if (reviewFilter && reviewFilter.type === 'task') {
        this.applyReviewFilter()
      } else {
        this.showAllWorks(false)
      }
    })
  },

  applyReviewFilter() {
    const reviewFilter = wx.getStorageSync('reviewFilter') || null

    if (!reviewFilter || reviewFilter.type !== 'task') {
      this.showAllWorks(false)
      return
    }

    const filteredWorks = this.data.works.filter(item => matchTaskFilter(item, reviewFilter))
    const filterTitle = `${reviewFilter.moduleTitle || '当前训练'} Day ${reviewFilter.day || ''}`

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'task',
      filterTitle,
      hasReviewFilter: true,
      reviewFilter,
      filterText: filterTitle,
      emptyTitle: '当前训练日暂无已保存作品',
      emptyDesc: '完成本日训练并保存作品后，可以在这里生成或查看 AI 点评。',
      emptyButtonText: '返回训练'
    })
  },

  showAllWorks(shouldClearStorage = true) {
    if (shouldClearStorage) {
      wx.removeStorageSync('reviewFilter')
    }

    this.setData({
      filteredWorks: this.data.works,
      submittedWorks: this.data.works,
      filterType: 'all',
      filterTitle: '',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: '',
      emptyTitle: '暂无已保存作品',
      emptyDesc: '完成训练并保存作品后，这里会显示你的作品和点评状态。',
      emptyButtonText: '去训练'
    })
  },

  showAiFeedbackWorks() {
    wx.removeStorageSync('reviewFilter')
    const filteredWorks = this.data.works.filter(item => (
      item.aiFeedbackStatus === 'done' && item.aiFeedback
    ))

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'ai',
      filterTitle: 'AI点评作品',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: 'AI点评作品',
      emptyTitle: '暂无 AI 点评作品',
      emptyDesc: '保存作品后可以点击“生成AI点评”，系统会在时长达标后生成表达建议。',
      emptyButtonText: '去训练'
    })
  },

  showTeacherFeedbackWorks() {
    wx.removeStorageSync('reviewFilter')
    const filteredWorks = this.data.works.filter(item => hasTeacherFeedback(item))

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'teacher',
      filterTitle: '老师点评作品',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: '老师点评作品',
      emptyTitle: '暂无老师点评作品',
      emptyDesc: '老师点评功能开发中，后续可查看老师的文字点评、标签和评分。',
      emptyButtonText: '去训练'
    })
  },

  clearFilter() {
    this.showAllWorks(true)
  },

  clearReviewFilter() {
    this.clearFilter()
  },

  handleFeedbackCardTap(e) {
    const type = e.currentTarget.dataset.type

    if (type === 'ai') {
      this.showAiFeedbackWorks()
      return
    }

    if (type === 'teacher') {
      this.showTeacherFeedbackWorks()
      return
    }

    this.showAllWorks(true)
  },

  findWorkByKey(key) {
    return this.data.works.find(item => item.key === key) ||
      this.data.filteredWorks.find(item => item.key === key)
  },

  playWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.workType === 'video' || target.type === 'video') {
      this.previewVideo(target)
      return
    }

    this.playAudio(target, target.audioKey)
  },

  playAudio(item, key) {
    const audioPath = getAudioPath(item)

    console.log('[work-play] audio path:', audioPath)

    if (!audioPath) {
      wx.showToast({
        title: '录音文件暂时无法播放',
        icon: 'none'
      })
      return
    }

    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this)
    }
    this.audioPlayer.play(item, key)
  },

  onAudioSliderChange(e) {
    if (!this.audioPlayer) return
    this.audioPlayer.seek(e.detail.value)
  },

  previewVideo(item) {
    const videoPath = getVideoPath(item)

    console.log('[work-play] video path:', videoPath)

    if (!videoPath) {
      wx.showToast({
        title: '视频文件暂时无法查看',
        icon: 'none'
      })
      return
    }

    previewVideoByPath(videoPath, item.displaySubtitle || item.displayTitle || '训练录像')
  },

  publishWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) return

    if (!requirePhoneBound('发布广场', {
      page: this,
      onSuccess: () => this.publishWork(e)
    })) return

    wx.showModal({
      title: '确认发布到广场？',
      content: '发布后，所有用户都可以看到你的作品内容。请确认作品中没有个人隐私、不适合公开的信息。',
      confirmText: '确认发布',
      cancelText: '取消',
      confirmColor: '#16c784',
      success: async res => {
        if (!res.confirm) return

        const result = await publishWorkToSquare(target.id, target.sourceType)

        if (!result.success) {
          wx.showToast({
            title: result.message || '发布失败',
            icon: 'none'
          })
          return
        }

        this.loadReviewData()
        wx.showToast({
          title: '已发布到广场',
          icon: 'success'
        })
      }
    })
  },

  unpublishWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) return

    wx.showModal({
      title: '确认取消公开？',
      content: '取消公开后，该作品将不再出现在表达广场。',
      confirmText: '取消公开',
      cancelText: '再想想',
      confirmColor: '#d84d4d',
      success: async res => {
        if (!res.confirm) return

        const result = await unpublishWorkFromSquare(target.id, target.sourceType)

        if (!result.success) {
          wx.showToast({
            title: result.message || '取消失败',
            icon: 'none'
          })
          return
        }

        this.loadReviewData()
        wx.showToast({
          title: '已取消公开',
          icon: 'none'
        })
      }
    })
  },

  deleteWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: '删除后，该作品记录将无法恢复。是否确认删除？',
      cancelText: '取消',
      confirmText: '确认删除',
      confirmColor: '#d84d4d',
      success: async res => {
        if (!res.confirm) return

        const cloudId = target.cloudId || target.squareWorkId || ''
        let cloudResult = null
        try {
          if (cloudId) cloudResult = await deleteMyWork(cloudId)
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请稍后重试', icon: 'none' })
          return
        }
        removeWorkFromStorage(target)
        this.loadReviewData()
        if ((cloudResult && cloudResult.wasPublic) || target.isPublic) {
          wx.showModal({
            title: '作品已删除',
            content: '该作品已同时从表达广场下架。',
            showCancel: false,
            confirmText: '知道了'
          })
        } else {
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      }
    })
  },

  handleFeedbackAction(e) {
    const key = e.currentTarget.dataset.key
    console.log('[review][ai-feedback] click:', { workId: key })

    if (this.data.aiGeneratingWorkKey && this.data.aiGeneratingWorkKey === key) {
      return
    }

    if (!requirePhoneBound('生成 AI 点评', {
      page: this,
      onSuccess: () => this.handleFeedbackAction(e)
    })) return

    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    const action = getFeedbackActionState(target)

    if (action.disabled) {
      wx.showToast({
        title: 'AI点评正在生成中，请稍候。',
        icon: 'none'
      })
      return
    }

    if (action.blocked) {
      this.showDurationBlockedModal()
      return
    }

    if (action.canView && target.aiFeedback) {
      this.showFeedback(target)
      return
    }

    this.generateFeedback(target)
  },

  async generateFeedback(target) {
    const workKey = target.key || ''
    let feedbackTarget = null

    this.setData({
      aiGeneratingWorkKey: workKey
    }, () => {
      console.log('[review][ai-feedback] entering generating:', { workId: workKey })
      this.loadReviewData()
    })

    wx.showLoading({
      title: 'AI点评生成中...',
      mask: true
    })

    try {
      const res = await generateFeedbackForSubmission(target)
      console.log('[review][ai-feedback] result:', {
        workId: workKey,
        success: res.status === 'done',
        feedbackMode: res.feedbackMode || '',
        asrStatus: res.asrStatus || ''
      })
      this.loadReviewData()

      if (res.status === 'blocked') {
        this.showDurationBlockedModal()
        return
      }

      if (res.status === 'empty_transcript') {
        this.showEmptyTranscriptModal(res)
        return
      }

      if (res.status === 'done') {
        feedbackTarget = this.findWorkByKey(workKey) || {
          ...target,
          aiFeedbackStatus: 'done',
          aiFeedback: res.feedback,
          aiFeedbackSource: res.source || '',
          aiFeedbackModel: res.model || '',
          aiFeedbackVersion: res.feedbackVersion || '',
          aiFeedbackMode: res.feedbackMode || ''
        }
        return
      }

      wx.showToast({
        title: res.message || 'AI生成失败，请稍后重试',
        icon: 'none'
      })
    } catch (error) {
      console.log('manual feedback failed', error)
      this.loadReviewData()
      wx.showToast({
        title: 'AI生成失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
      this.setData({
        aiGeneratingWorkKey: ''
      }, () => {
        this.loadReviewData()
        if (feedbackTarget) {
          console.log('[review][ai-feedback] panel opened:', { workId: workKey })
          this.showFeedback(feedbackTarget)
        }
      })
    }
  },

  showFeedback(target) {
    console.log('[review][ai-feedback] panel opened:', { workId: target.key || target.id || '' })
    if (target.aiFeedbackStatus !== 'done' || !target.aiFeedback) {
      wx.showToast({
        title: 'AI点评尚未生成',
        icon: 'none'
      })
      return
    }

    this.setData({
      showAiFeedbackPanel: false,
      currentAiFeedback: normalizeAiFeedback(target.aiFeedback, target),
      aiFeedbackScrollTop: 1
    }, () => {
      this.setData({
        showAiFeedbackPanel: true,
        aiFeedbackScrollTop: 0
      })
    })
  },

  closeAiFeedbackPanel() {
    this.setData({
      showAiFeedbackPanel: false,
      currentAiFeedback: null,
      aiFeedbackScrollTop: 0
    })
  },

  noop() {},

  showDurationBlockedModal() {
    wx.showModal({
      title: '时长不足',
      content: '录音或录像需满 30 秒后再生成 AI 点评。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  showEmptyTranscriptModal(res = {}) {
    const canRetry = res.canRetry === true
    wx.showModal({
      title: '未识别到有效语音',
      content: '暂未识别到有效语音内容，请确认录音声音清晰后重试。',
      confirmText: canRetry ? '重新识别' : '我知道了',
      cancelText: canRetry ? '我知道了' : '',
      showCancel: canRetry,
      success: modalRes => {
        if (modalRes.confirm && canRetry) {
          const currentTarget = this.findWorkByKey(this.data.aiGeneratingWorkKey)
          if (currentTarget) {
            this.generateFeedback(currentTarget)
          }
        }
      }
    })
  },

  handleTeacherFeedbackAction(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    const teacherState = getTeacherFeedbackState(target)

    if (teacherState === 'done') {
      const feedback = target.teacherFeedback || {}
      const tags = Array.isArray(feedback.tags) ? feedback.tags.join('、') : ''

      wx.showModal({
        title: '老师点评',
        content: [
          `老师：${feedback.teacherName || '杨勤老师'}`,
          `评分：${feedback.score || 5} / 5`,
          `标签：${tags || '暂无'}`,
          `点评内容：${feedback.content || '暂无'}`,
          `点评时间：${feedback.createdAt || '暂无'}`
        ].join('\n\n'),
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    if (teacherState === 'pending') {
      wx.showToast({
        title: '已提交给老师，老师点评完成后会显示在这里。',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '提交老师点评',
      content: '提交后，老师可以看到你的作品并进行真人点评。是否提交？',
      confirmText: '提交',
      cancelText: '取消',
      confirmColor: '#07c160',
      success: res => {
        if (!res.confirm) return

        const patch = {
          teacherFeedbackRequestStatus: 'submitted',
          teacherFeedbackSubmittedAt: formatDateTime(),
          teacherFeedbackCloudSync: target.cloudId ? false : true,
          teacherFeedbackStatus: 'pending',
          teacherReviewSubmitted: true
        }

        // TODO: 后续新增 cloudApi action 同步 teacherFeedbackRequestStatus 到 submissions。
        patchWorkInStorages(target.sourceType === 'extra' ? 'extra' : 'main', target.id, patch, target.cloudId || '')
        this.loadReviewData()
        wx.showToast({
          title: target.cloudId ? '已本地保存，云端同步稍后重试' : '已提交老师点评',
          icon: 'none'
        })
      }
    })
  },

  switchToTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  },

  showPrivateShareTip() {
    wx.showToast({
      title: '请先发布到广场后再分享作品。',
      icon: 'none'
    })
  },

  onShareAppMessage(res = {}) {
    const dataset = res.target && res.target.dataset ? res.target.dataset : {}
    const workId = String(dataset.workId || '')
    const hasWorkIndex = dataset.workIndex !== undefined && dataset.workIndex !== null

    if (res.from === 'button' && (workId || hasWorkIndex)) {
      const workIndex = Number(dataset.workIndex)
      const work = this.data.filteredWorks.find(item => getWorkShareId(item) === workId) ||
        (Number.isInteger(workIndex) ? this.data.filteredWorks[workIndex] : null)

      if (work && work.isPublic) {
        const shareWorkId = getWorkPublicId(work)
        this.setData({ currentShareWorkId: shareWorkId })
        return getDefaultShareMessage(buildWorkShareConfig(work, 'mine'))
      }
    }

    return getDefaultShareMessage({
      title: 'AI口才点评｜录音录像后获得表达反馈',
      path: '/pages/review/review',
      imageUrl: getShareImage('review')
    })
  },

  onShareTimeline() {
    const workId = String(this.data.currentShareWorkId || '')
    return getDefaultShareTimeline({
      title: 'AI口才点评｜录音录像后获得表达反馈',
      targetPage: 'review',
      params: workId ? { workId } : {},
      imageUrl: getShareImage('review')
    })
  },

  onUnload() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy()
    }
  },

  onHide() {
    if (this.audioPlayer) {
      this.audioPlayer.pause()
    }
  }
})
