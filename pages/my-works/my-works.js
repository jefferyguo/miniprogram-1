const STORAGE_KEYS = {
  trainingDrafts: 'trainingDrafts',
  trainingSubmissions: 'trainingSubmissions',
  extraDrafts: 'extraTrainingDrafts',
  extraSubmissions: 'extraTrainingSubmissions'
}
const {
  generateFeedbackForSubmission,
  getFeedbackActionState,
  getFeedbackStatus,
  normalizeAiFeedback
} = require('../../utils/ai-feedback')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
const { cleanReadingDisplayTitle } = require('../../utils/training-data')
const {
  createAudioPlayer,
  getAudioPath,
  getInitialAudioPlayer,
  getVideoPath,
  previewVideoByPath
} = require('../../utils/work-media')
const {
  ensureSavedWorks,
  formatDateTime,
  getSavedStatusClass,
  getSavedStatusText,
  getTeacherButtonText,
  getTeacherFeedbackState,
  getTeacherStatusClass,
  getTeacherStatusText,
  patchWorkInStorages
} = require('../../utils/local-data')
const { publishWorkToSquare, unpublishWorkFromSquare } = require('../../utils/work-public')
const { deleteMyWork, getMyWorks } = require('../../utils/cloud-api')
const { requireLogin } = require('../../utils/auth')
const { requirePhoneBound } = require('../../utils/phone-auth')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')
const { buildWorkShareConfig, getWorkPublicId } = require('../../utils/work-share')
const {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isWorkShareAllowed
} = require('../../utils/work-share-policy')

function getStorageList(key) {
  const list = wx.getStorageSync(key) || []
  let changed = false
  const baseId = Date.now()
  const nextList = list.map((item, index) => {
    if (item.id) return item
    changed = true
    return {
      ...item,
      id: baseId + index
    }
  })

  if (changed) {
    wx.setStorageSync(key, nextList)
  }

  return nextList
}

function getTimeValue(timeText) {
  if (!timeText) return 0
  const date = new Date(String(timeText).replace(/-/g, '/'))
  return date.getTime() || 0
}

function getAiTip(item) {
  const status = getFeedbackStatus(item)
  if (status === 'blocked') return '录音或录像需满 30 秒后再生成 AI 点评。'
  if (status === 'error') return 'AI点评生成失败，可稍后重试。'
  if (status === 'done' && item.aiFeedback) return 'AI点评已生成。'
  return ''
}

function getAiStatusText(item) {
  const status = getFeedbackStatus(item)
  if (status === 'done' && item.aiFeedback) return 'AI已生成'
  if (status === 'pending') return 'AI生成中'
  if (status === 'error') return 'AI失败'
  if (status === 'blocked') return '时长不足'
  return 'AI待生成'
}

function getAiStatusClass(item) {
  const status = getFeedbackStatus(item)
  if (status === 'done' && item.aiFeedback) return 'ai-done-tag'
  if (status === 'pending') return 'ai-pending-tag'
  if (status === 'error') return 'ai-error-tag'
  if (status === 'blocked') return 'ai-blocked-tag'
  return 'ai-wait-tag'
}

function normalizeModuleTitle(title) {
  return String(title || '主训练').replace(/^21天/, '')
}

function normalizeWorkSubtitle(item) {
  const title = item.trainingTitleSnapshot || item.taskTitle || item.contentTitle || item.content || '训练作品'
  if (item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1) {
    return cleanReadingDisplayTitle(title)
  }

  return title
}

function getWorkSequence(item = {}) {
  return Number(item.trainingDaySnapshot || item.day || item.dayNumber || 0)
}

function buildWork(item, sourceType, submitted, index) {
  const isMain = sourceType === 'main'
  const workType = item.workType || item.type
  const isVideo = workType === 'video'
  const feedbackAction = getFeedbackActionState(item)
  const teacherState = getTeacherFeedbackState(item)

  return {
    ...item,
    id: item.id || item._id || item.cloudId || index,
    cloudId: item.cloudId || item._id || '',
    key: `${sourceType}-${item.id || item._id || item.cloudId || index}`,
    audioKey: `${sourceType}-${item.id || item._id || item.cloudId || index}`,
    workType,
    sourceType,
    sourceText: isMain ? '主训练' : (sourceType === 'extra' ? '额外训练' : '云端作品'),
    typeText: isVideo ? '录像作品' : '录音作品',
    actionText: isVideo ? '查看' : '播放',
    titleText: isMain
      ? `${normalizeModuleTitle(item.moduleTitle)}${getWorkSequence(item) ? ` Day ${getWorkSequence(item)}` : ''}`
      : (item.extraTitle || '额外训练'),
    subtitleText: normalizeWorkSubtitle(item),
    durationText: item.duration || '暂无',
    createdAtText: item.submittedAt || item.createdAt || '暂无',
    submitted: true,
    statusText: getSavedStatusText(item),
    statusClass: getSavedStatusClass(item),
    publicStatusText: item.isPublic ? '已发布到广场' : '',
    shareAllowed: isWorkShareAllowed(item),
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    aiStatusText: getAiStatusText(item),
    aiStatusClass: getAiStatusClass(item),
    hasTeacherFeedback: teacherState === 'done',
    teacherButtonText: getTeacherButtonText(item),
    teacherButtonClass: teacherState === 'done' ? 'teacher-done-btn' : teacherState === 'pending' ? 'teacher-pending-btn' : 'teacher-ready-btn',
    teacherStatusText: getTeacherStatusText(item),
    teacherStatusClass: getTeacherStatusClass(item),
    teacherState,
    aiTip: getAiTip(item),
    sortTime: getTimeValue(item.submittedAt || item.createdAt)
  }
}

function applyAiGeneratingState(item, generatingWorkKey) {
  if (!generatingWorkKey || item.key !== generatingWorkKey) return item

  return {
    ...item,
    feedbackActionText: '生成中...',
    feedbackActionDisabled: true,
    feedbackActionClass: 'feedback-generating-btn',
    aiStatusText: 'AI生成中',
    aiStatusClass: 'ai-pending-tag',
    aiTip: '正在分析录音内容，请稍候...'
  }
}

function mergeWorks(drafts, submissions, sourceType) {
  const map = {}

  drafts.forEach((item, index) => {
    const work = buildWork(item, sourceType, Boolean(item.submitted), index)
    map[work.key] = work
  })

  submissions.forEach((item, index) => {
    const work = buildWork(item, sourceType, true, index)
    map[work.key] = {
      ...(map[work.key] || {}),
      ...work
    }
  })

  return Object.keys(map).map(key => map[key])
}

const SNAPSHOT_FIELDS = [
  'trainingTitleSnapshot',
  'trainingContentSnapshot',
  'trainingCategorySnapshot',
  'trainingDaySnapshot'
]

function getWorkIdentityKeys(item = {}) {
  return [
    item.cloudId,
    item._id,
    item.id,
    item.squareWorkId
  ].map(value => String(value || '').trim()).filter(Boolean)
}

function getSnapshotPatch(item = {}) {
  return SNAPSHOT_FIELDS.reduce((patch, field) => {
    const value = item[field]
    if (value !== undefined && value !== null && String(value).trim()) {
      patch[field] = value
    }
    return patch
  }, {})
}

function buildSnapshotLookup(items = []) {
  const lookup = new Map()
  items.forEach(item => {
    const patch = getSnapshotPatch(item)
    if (!Object.keys(patch).length) return
    getWorkIdentityKeys(item).forEach(key => {
      if (!lookup.has(key)) lookup.set(key, patch)
    })
  })
  return lookup
}

function applyPreferredSnapshot(item = {}, snapshotLookup) {
  const patch = getWorkIdentityKeys(item)
    .map(key => snapshotLookup.get(key))
    .find(Boolean)
  return patch ? { ...item, ...patch } : item
}

function getKeysBySource(sourceType) {
  if (sourceType === 'extra') {
    return {
      draftKey: STORAGE_KEYS.extraDrafts,
      submissionKey: STORAGE_KEYS.extraSubmissions
    }
  }

  return {
    draftKey: STORAGE_KEYS.trainingDrafts,
    submissionKey: STORAGE_KEYS.trainingSubmissions
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
    // 我的作品页统一展示已保存作品和点评状态。
    works: [],
    totalCount: 0,
    savedCount: 0,
    aiReadyCount: 0,
    teacherReviewedCount: 0,
    teacherFeedbackEnabled: FEATURE_FLAGS.teacherFeedbackEnabled,
    audioPlayer: getInitialAudioPlayer(),
    showAiFeedbackPanel: false,
    currentAiFeedback: null,
    aiFeedbackScrollTop: 0,
    aiGeneratingWorkKey: '',
    currentShareWorkId: ''
  },

  onShow() {
    enableShareMenu()
    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this)
    }
    if (!requireLogin(() => this.loadWorks(), { actionName: '查看训练记录' })) return
    this.loadWorks()
  },

  async loadWorks() {
    const mainSaved = ensureSavedWorks('main')
    const extraSaved = ensureSavedWorks('extra')
    const trainingDrafts = mainSaved.drafts
    const trainingSubmissions = mainSaved.submissions
    const extraDrafts = extraSaved.drafts
    const extraSubmissions = extraSaved.submissions

    const localWorks = mergeWorks(trainingDrafts, trainingSubmissions, 'main')
      .concat(mergeWorks(extraDrafts, extraSubmissions, 'extra'))
      .sort((a, b) => b.sortTime - a.sortTime)
    const snapshotLookup = buildSnapshotLookup(
      trainingDrafts
        .concat(trainingSubmissions, extraDrafts, extraSubmissions)
        .concat(localWorks)
    )
    let works = localWorks

    try {
      const cloudRes = await getMyWorks(50)
      const cloudWorks = (cloudRes.works || []).map((item, index) => {
        const snapshotItem = applyPreferredSnapshot(item, snapshotLookup)
        return buildWork(
          snapshotItem,
          snapshotItem.sourceType || (snapshotItem.extraType ? 'extra' : 'main'),
          true,
          index
        )
      })
      const cloudIds = cloudWorks.map(item => item.cloudId || item.id).filter(Boolean)
      const unsyncedLocalWorks = localWorks.filter(item => !item.cloudId || !cloudIds.includes(item.cloudId))

      works = cloudWorks.concat(unsyncedLocalWorks)
        .sort((a, b) => b.sortTime - a.sortTime)
    } catch (err) {
      console.warn('[my-works] 云端作品读取失败，使用本地 fallback:', err)
    }

    const aiReadyCount = works.filter(item => item.aiFeedbackStatus === 'done' && item.aiFeedback).length
    const teacherReviewedCount = works.filter(item => item.teacherState === 'done' || item.teacherFeedback).length

    const displayWorks = works.map(item => applyAiGeneratingState(item, this.data.aiGeneratingWorkKey))

    this.setData({
      works: displayWorks,
      totalCount: works.length,
      savedCount: works.length,
      aiReadyCount,
      teacherReviewedCount
    })
  },

  playWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.workType === 'video') {
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

    previewVideoByPath(videoPath, item.subtitleText || item.titleText || '训练录像')
  },

  showWorkStatus(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) return

    wx.showToast({
      title: target.statusText === '已同步' ? '作品已同步，可继续生成AI点评' : '作品已保存，可继续生成AI点评',
      icon: 'none'
    })
  },

  publishWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (!isWorkShareAllowed(target)) {
      wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
      return
    }

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

        this.loadWorks()
        wx.showToast({
          title: '已发布到广场',
          icon: 'success'
        })
      }
    })
  },

  unpublishWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

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

        this.loadWorks()
        wx.showToast({
          title: '已取消公开',
          icon: 'none'
        })
      }
    })
  },

  deleteWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

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
        this.loadWorks()
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
    console.log('[my-works][ai-feedback] click:', { workId: key })

    if (this.data.aiGeneratingWorkKey && this.data.aiGeneratingWorkKey === key) {
      return
    }

    if (!requirePhoneBound('生成 AI 点评', {
      page: this,
      onSuccess: () => this.handleFeedbackAction(e)
    })) return

    const target = this.data.works.find(item => item.key === key)

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
      console.log('[my-works][ai-feedback] entering generating:', { workId: workKey })
      this.loadWorks()
    })

    wx.showLoading({
      title: 'AI点评生成中...',
      mask: true
    })

    try {
      const res = await generateFeedbackForSubmission(target)
      console.log('[my-works][ai-feedback] result:', {
        workId: workKey,
        success: res.status === 'done',
        feedbackMode: res.feedbackMode || '',
        asrStatus: res.asrStatus || ''
      })
      await this.loadWorks()

      if (res.status === 'blocked') {
        this.showDurationBlockedModal()
        return
      }

      if (res.status === 'empty_transcript') {
        this.showEmptyTranscriptModal(res)
        return
      }

      if (res.status === 'done') {
        feedbackTarget = this.data.works.find(item => item.key === workKey) || {
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
      console.log('my works feedback failed', error)
      await this.loadWorks()
      wx.showToast({
        title: 'AI生成失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
      this.setData({
        aiGeneratingWorkKey: ''
      }, async () => {
        await this.loadWorks()
        if (feedbackTarget) {
          console.log('[my-works][ai-feedback] panel opened:', { workId: workKey })
          this.showFeedback(feedbackTarget)
        }
      })
    }
  },

  showFeedback(target) {
    console.log('[my-works][ai-feedback] panel opened:', { workId: target.key || target.id || '' })
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
      content: res.message || '暂未识别到有效语音内容，请确认录音声音清晰后重试。',
      confirmText: canRetry ? '重新识别' : '我知道了',
      cancelText: canRetry ? '我知道了' : '',
      showCancel: canRetry,
      success: modalRes => {
        if (modalRes.confirm && canRetry) {
          const currentTarget = this.data.works.find(item => item.key === this.data.aiGeneratingWorkKey)
          if (currentTarget) {
            this.generateFeedback(currentTarget)
          }
        }
      }
    })
  },

  handleTeacherFeedbackAction(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

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

      wx.showModal({
        title: '老师点评',
        content: [
          `老师：${feedback.teacherName || '杨勤老师'}`,
          `评分：${feedback.score || 5} / 5`,
          `标签：${Array.isArray(feedback.tags) ? feedback.tags.join('、') : '暂无'}`,
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
        this.loadWorks()
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
    const workIndex = Number(dataset.workIndex)
    if (res.from === 'button' && (workId || hasWorkIndex)) {
      const work = this.data.works.find(item => getWorkPublicId(item) === workId) ||
        (Number.isInteger(workIndex) ? this.data.works[workIndex] : null)
      if (work && !isWorkShareAllowed(work)) {
        wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
        return undefined
      }
      if (work && work.isPublic) {
        const shareWorkId = getWorkPublicId(work)
        this.setData({ currentShareWorkId: shareWorkId })
        const shareConfig = buildWorkShareConfig(work, 'mine')
        return shareConfig ? getDefaultShareMessage(shareConfig) : undefined
      }
    }

    return getDefaultShareMessage({
      title: '我的口才训练作品｜每天练一点，表达更自信',
      path: '/pages/my-works/my-works',
      imageUrl: getShareImage('training')
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '我的口才训练作品｜每天练一点，表达更自信',
      targetPage: 'my-works',
      imageUrl: getShareImage('training')
    })
  },

  stopAudioContext() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy()
    }
  },

  onHide() {
    if (this.audioPlayer) {
      this.audioPlayer.pause()
    }
  },

  onUnload() {
    this.stopAudioContext()
  }
})
