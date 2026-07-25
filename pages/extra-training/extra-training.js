// pages/extra-training/extra-training.js
const { getExtraTraining } = require('../../utils/training-data')
const {
  getDailyQuote,
  getDailyTopic,
  getDailyTongueTwister
} = require('../../utils/daily-training-data')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
const {
  generateFeedbackForSubmission,
  getFeedbackActionState,
  getFeedbackStatus,
  normalizeAiFeedback
} = require('../../utils/ai-feedback')
const {
  buildClassSubmissionPatch,
  ensureSavedWorks,
  getSavedStatusClass,
  getSavedStatusText,
  getTeacherButtonText,
  getTeacherFeedbackState,
  getTeacherStatusClass,
  getTeacherStatusText,
  patchWorkInStorages,
  saveWorkWithSubmission
} = require('../../utils/local-data')
const {
  createAudioPlayer,
  getAudioPath,
  getInitialAudioPlayer,
  getVideoPath,
  previewVideoByPath
} = require('../../utils/work-media')
const { publishWorkToSquare, unpublishWorkFromSquare } = require('../../utils/work-public')
const { uploadWorkFile } = require('../../utils/cloud-upload')
const { submitWorkRecord } = require('../../utils/cloud-api')
const { getActiveMemberAccess } = require('../../utils/access-control')
const { requirePhoneBound } = require('../../utils/phone-auth')
const { refreshRemoteTrainingContents } = require('../../utils/remote-training')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline
} = require('../../utils/share-config')

const PAGE_CONFIG = {
  dailyQuote: {
    contentTitle: '今日金句',
    contentTip: '朗读这句金句，注意停顿、重音和情绪。',
    changeButtonText: '换一条'
  },
  randomTopic: {
    contentTitle: '今日话题',
    contentTip: '围绕该话题完成 60 秒以上即兴表达。',
    changeButtonText: '换一题'
  },
  tongueTwister: {
    contentTitle: '今日绕口令',
    contentTip: '慢速读清楚，再逐渐加快速度，注意气息、平翘舌和前后鼻音。',
    changeButtonText: '换一条'
  }
}

function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

function buildWorkItem(item) {
  const feedbackAction = getFeedbackActionState(item)
  const teacherState = getTeacherFeedbackState(item)

  return {
    ...item,
    audioKey: `extra-${item.id}`,
    typeTitle: item.type === 'audio' ? '录音作品' : '录像作品',
    typeIcon: item.type === 'audio' ? '🎤' : '🎥',
    actionText: item.type === 'audio' ? '播放' : '查看',
    statusText: getSavedStatusText(item),
    statusClass: getSavedStatusClass(item),
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    aiStatusText: getAiStatusText(item),
    aiStatusClass: getAiStatusClass(item),
    teacherButtonText: getTeacherButtonText(item),
    teacherStatusText: getTeacherStatusText(item),
    teacherStatusClass: getTeacherStatusClass(item),
    teacherActionClass: teacherState === 'done' ? 'teacher-done-btn' : teacherState === 'pending' ? 'teacher-pending-btn' : 'teacher-ready-btn',
    hasTeacherFeedback: teacherState === 'done',
    teacherState
  }
}

function applyAiGeneratingState(item, generatingWorkId) {
  if (!generatingWorkId || String(item.id) !== String(generatingWorkId)) return item

  return {
    ...item,
    feedbackActionText: '生成中...',
    feedbackActionDisabled: true,
    feedbackActionClass: 'feedback-generating-btn',
    aiStatusText: 'AI生成中',
    aiStatusClass: 'ai-pending-tag',
    aiGeneratingTip: '正在分析录音内容，请稍候...'
  }
}

function getAiStatusText(work) {
  const status = getFeedbackStatus(work)
  if (status === 'done' && work.aiFeedback) return 'AI已生成'
  if (status === 'pending') return 'AI生成中'
  if (status === 'error') return 'AI失败'
  if (status === 'blocked') return '时长不足'
  return 'AI待生成'
}

function getAiStatusClass(work) {
  const status = getFeedbackStatus(work)
  if (status === 'done' && work.aiFeedback) return 'ai-done-tag'
  if (status === 'pending') return 'ai-pending-tag'
  if (status === 'error') return 'ai-error-tag'
  if (status === 'blocked') return 'ai-blocked-tag'
  return 'ai-wait-tag'
}

function mergeDraftWithSubmission(draft, submission) {
  if (!submission) return draft

  return {
    ...draft,
    ...submission,
    submitted: true,
    filePath: submission.filePath || draft.filePath || '',
    tempFilePath: submission.tempFilePath || draft.tempFilePath || draft.filePath || '',
    thumbPath: submission.thumbPath || draft.thumbPath || ''
  }
}

function getDurationSeconds(durationText) {
  const match = String(durationText || '').match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

function patchStoredWork(storageKey, id, patch) {
  const list = wx.getStorageSync(storageKey) || []
  wx.setStorageSync(storageKey, list.map(item => (
    String(item.id) === String(id)
      ? {
        ...item,
        ...patch
      }
      : item
  )))
}

function normalizeExtraItem(item) {
  if (typeof item === 'string') {
    return {
      id: '',
      text: item,
      category: '',
      usageTip: ''
    }
  }

  return {
    id: item && item.id ? item.id : '',
    text: item && (item.text || item.content || item.title) ? (item.text || item.content || item.title) : '',
    title: item && item.title ? item.title : '',
    author: item && item.author ? item.author : '',
    category: item && item.category ? item.category : '',
    usageTip: item && item.usageTip ? item.usageTip : '',
    membershipLevel: item && item.membershipLevel === 'member' ? 'member' : 'free'
  }
}

function getExtraItemText(item) {
  return normalizeExtraItem(item).text
}

function buildSavedSubmission(draft) {
  return {
    id: draft.id,
    sourceType: 'extra',
    ...buildClassSubmissionPatch(),
    extraType: draft.extraType,
    extraTitle: draft.extraTitle,
    taskTitle: draft.extraTitle,
    contentTitle: draft.content,
    content: draft.content,
    promptText: draft.promptText || draft.content || '',
    requirement: '',
    type: draft.type,
    workType: draft.type,
    duration: draft.duration,
    durationSeconds: getDurationSeconds(draft.duration),
    targetSeconds: 0,
    createdAt: draft.createdAt,
    submittedAt: draft.createdAt,
    submitted: true,
    isSubmitted: true,
    status: 'saved',
    savedStatus: 'saved',
    teacherFeedbackRequestStatus: 'none',
    teacherFeedbackSubmittedAt: '',
    teacherFeedbackCloudSync: true,
    teacherFeedbackStatus: '',
    teacherFeedback: null,
    filePath: draft.filePath || '',
    tempFilePath: draft.tempFilePath || draft.filePath || '',
    thumbPath: draft.thumbPath || '',
    fileSize: draft.fileSize || 0,
    isPublic: false,
    publicPermissionConfirmed: false,
    aiFeedbackStatus: '',
    aiFeedbackSource: '',
    aiFeedbackModel: ''
  }
}

Page({
  data: {
    type: '',
    title: '',
    desc: '',
    icon: '',
    heroClass: '',
    contentTitle: '',
    contentTip: '',
    content: '',
    currentItemId: '',
    contentCategory: '',
    contentUsageTip: '',
    currentItemMembershipLevel: 'free',
    changeButtonText: '换一条',
    items: [],

    isAudioRecording: false,
    isVideoRecording: false,
    isRecording: false,
    recordingSeconds: 0,
    recordingTypeText: '',
    recordingTimeText: '00:00',
    maxVideoDuration: '',
    videoMaxDuration: '',
    durationLimit: '',
    drafts: [],
    hasDrafts: false,
    teacherFeedbackEnabled: FEATURE_FLAGS.teacherFeedbackEnabled,
    audioPlayer: getInitialAudioPlayer(),
    showAiFeedbackPanel: false,
    currentAiFeedback: null,
    aiFeedbackScrollTop: 0,
    aiGeneratingWorkId: ''
  },

  onLoad(options = {}) {
    enableShareMenu()
    const type = options.type || 'dailyQuote'

    const extraTraining = getExtraTraining()
    const training = extraTraining.find(item => item.id === type) || extraTraining[0]
    const config = PAGE_CONFIG[training.id] || PAGE_CONFIG.dailyQuote
    const items = (training.items || []).concat(training.importedQuotes || [])
    const firstItem = this.getInitialItem(training.id, items)
    const normalizedItem = this.normalizeExtraItem(firstItem)

    this.setData({
      type: training.id,
      title: training.title,
      desc: training.desc,
      icon: training.icon,
      heroClass: training.className,
      contentTitle: config.contentTitle,
      contentTip: config.contentTip,
      changeButtonText: config.changeButtonText,
      items,
      content: normalizedItem.text,
      currentItemId: normalizedItem.id,
      contentCategory: normalizedItem.category,
      contentUsageTip: normalizedItem.usageTip,
      currentItemMembershipLevel: normalizedItem.membershipLevel,
      maxVideoDuration: training.maxVideoDuration || '',
      videoMaxDuration: training.videoMaxDuration || '',
      durationLimit: training.durationLimit || ''
    })
    this.audioPlayer = createAudioPlayer(this)
    this.initRecorderManager()
    this.loadDrafts()
    const cloudCategory = training.id === 'randomTopic' ? 'dailyTopic' : training.id
    refreshRemoteTrainingContents({ force: true, category: cloudCategory })
      .then(() => this.reloadExtraTrainingFromRemote())
      .catch(error => console.warn('[extra-training] 云端额外训练覆盖读取失败，继续使用本地内容:', error))
  },

  onShow() {
    enableShareMenu()
    if (this.data.type) {
      this.loadDrafts()
    }
  },

  normalizeExtraItem(item) {
    return normalizeExtraItem(item)
  },

  findItemInList(items, id) {
    if (!id) return null
    return (items || []).find(item => String(this.normalizeExtraItem(item).id) === String(id)) || null
  },

  findCloudOverrideItem(items, localItem) {
    const normalizedItem = this.normalizeExtraItem(localItem)
    return this.findItemInList(items, normalizedItem.id) || localItem
  },

  hasMemberAccess() {
    const access = getActiveMemberAccess()
    return access.isAdmin === true ||
      access.isMember === true ||
      ['monthly', 'yearly', 'admin'].includes(access.membershipType)
  },

  getAvailableItems(items = []) {
    if (this.hasMemberAccess()) return items
    return (items || []).filter(item => this.normalizeExtraItem(item).membershipLevel !== 'member')
  },

  showMemberModal() {
    wx.showModal({
      title: '会员内容',
      content: '该训练为会员内容，开通会员后即可解锁更多训练。',
      confirmText: '开通会员',
      cancelText: '稍后再说',
      success: res => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/member-center/member-center'
          })
        }
      }
    })
  },

  ensureCurrentExtraAccess() {
    if (this.data.currentItemMembershipLevel !== 'member' || this.hasMemberAccess()) return true
    this.showMemberModal()
    return false
  },

  getInitialItem(type, items) {
    const availableItems = this.getAvailableItems(items)
    if (!availableItems.length) {
      this.showMemberModal()
      return { id: '', text: '当前额外训练内容为会员内容，开通会员后即可训练。', membershipLevel: 'member' }
    }

    if (type === 'dailyQuote') {
      const dailyItem = this.normalizeExtraItem(getDailyQuote())
      return this.findItemInList(availableItems, dailyItem.id) || this.getRandomItem(availableItems)
    }

    if (type === 'randomTopic') {
      const dailyItem = this.normalizeExtraItem(getDailyTopic())
      return this.findItemInList(availableItems, dailyItem.id) || this.getRandomItem(availableItems)
    }

    if (type === 'tongueTwister') {
      const dailyItem = this.normalizeExtraItem(getDailyTongueTwister())
      return this.findItemInList(availableItems, dailyItem.id) || this.getRandomItem(availableItems)
    }

    return this.getRandomItem(availableItems)
  },

  reloadExtraTrainingFromRemote() {
    if (!this.data.type) return

    const extraTraining = getExtraTraining()
    const training = extraTraining.find(item => item.id === this.data.type)
    if (!training) return

    const config = PAGE_CONFIG[training.id] || PAGE_CONFIG.dailyQuote
    const items = (training.items || []).concat(training.importedQuotes || [])
    const availableItems = this.getAvailableItems(items)
    const currentItem = this.findItemInList(availableItems, this.data.currentItemId) || this.getInitialItem(training.id, items)
    const normalizedItem = this.normalizeExtraItem(currentItem)

    this.setData({
      title: training.title,
      desc: training.desc,
      icon: training.icon,
      heroClass: training.className,
      contentTitle: config.contentTitle,
      contentTip: config.contentTip,
      changeButtonText: config.changeButtonText,
      items,
      content: normalizedItem.text,
      currentItemId: normalizedItem.id,
      contentCategory: normalizedItem.category,
      contentUsageTip: normalizedItem.usageTip,
      currentItemMembershipLevel: normalizedItem.membershipLevel,
      maxVideoDuration: training.maxVideoDuration || '',
      videoMaxDuration: training.videoMaxDuration || '',
      durationLimit: training.durationLimit || ''
    })
  },

  getRandomItem(items, currentContent = '') {
    if (!items.length) return '暂无训练内容'
    if (items.length === 1) return items[0]

    let next = null
    let count = 0

    while (getExtraItemText(next) === currentContent && count < 8) {
      const index = Math.floor(Math.random() * items.length)
      next = items[index]
      count += 1
    }

    return next
  },

  changeContent() {
    const availableItems = this.getAvailableItems(this.data.items)
    if (!availableItems.length) {
      this.showMemberModal()
      return
    }

    let nextItem = this.getRandomItem(availableItems, this.data.content)

    nextItem = this.findCloudOverrideItem(availableItems, nextItem)
    const normalizedItem = this.normalizeExtraItem(nextItem)

    this.setData({
      content: normalizedItem.text,
      currentItemId: normalizedItem.id,
      contentCategory: normalizedItem.category,
      contentUsageTip: normalizedItem.usageTip,
      currentItemMembershipLevel: normalizedItem.membershipLevel
    })

    wx.showToast({
      title: this.data.type === 'randomTopic' ? '已换一题' : '已换一条',
      icon: 'none'
    })
  },

  loadDrafts() {
    const saved = ensureSavedWorks('extra')
    const currentMap = {}

    saved.drafts
      .filter(item => item.extraType === this.data.type)
      .forEach(item => {
        currentMap[String(item.id)] = item
      })

    saved.submissions
      .filter(item => item.extraType === this.data.type)
      .forEach(item => {
        const key = String(item.id)
        currentMap[key] = mergeDraftWithSubmission(currentMap[key] || item, item)
      })

    const currentDrafts = Object.keys(currentMap)
      .map(key => applyAiGeneratingState(buildWorkItem(currentMap[key]), this.data.aiGeneratingWorkId))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    this.setData({
      drafts: currentDrafts,
      hasDrafts: currentDrafts.length > 0
    })
  },

  initRecorderManager() {
    this.recorderManager = wx.getRecorderManager()

    this.recorderManager.onStart(() => {
      this.startRecordingTimer()
    })

    this.recorderManager.onStop(res => {
      this.clearTimer()
      this.createAudioDraft(res)
      this.setData({
        isAudioRecording: false,
        isRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00'
      })
      wx.showToast({
        title: '录音已保存',
        icon: 'success'
      })
    })

    this.recorderManager.onError(error => {
      this.clearTimer()
      this.setData({
        isAudioRecording: false,
        isRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00'
      })
      console.error('额外训练录音失败', error)
      wx.showToast({
        title: '录音失败',
        icon: 'none'
      })
    })
  },

  toggleAudio() {
    if (this.data.isVideoRecording) return
    if (!this.ensureCurrentExtraAccess()) return

    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    } else {
      if (!requirePhoneBound('提交训练作品', {
        page: this,
        onSuccess: () => this.toggleAudio()
      })) return
      this.ensureRecordPermission(() => {
        this.startAudioRecord()
      })
    }
  },

  toggleVideo() {
    if (this.data.isAudioRecording) return
    if (!this.ensureCurrentExtraAccess()) return

    if (!requirePhoneBound('提交训练作品', {
      page: this,
      onSuccess: () => this.toggleVideo()
    })) return

    wx.navigateTo({
      url: '/pages/video-record/video-record',
      events: {
        videoRecorded: data => {
          this.createVideoDraft(data)
        }
      },
      success: async res => {
        res.eventChannel.emit('videoRecordContext', {
          sourceType: 'extra',
          title: this.data.title,
          subtitle: '额外训练',
          promptText: this.data.content || '',
          requirement: '',
          maxVideoDuration: this.data.maxVideoDuration,
          videoMaxDuration: this.data.videoMaxDuration,
          durationLimit: this.data.durationLimit
        })
      }
    })
  },

  startAudioRecord() {
    this.clearTimer()
    this.setData({
      isAudioRecording: true,
      isVideoRecording: false,
      isRecording: true,
      recordingSeconds: 0,
      recordingTypeText: '录音',
      recordingTimeText: '00:00'
    })

    this.recorderManager.start({
      // 微信录音 API 需要传入 duration；这里使用 10 分钟上限，避免业务侧 60 秒强制停止。
      duration: 600000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  },

  stopAudioRecord() {
    if (this.recorderManager) {
      this.recorderManager.stop()
    }
  },

  startRecordingTimer() {
    this.clearTimer()
    this.recordingTimer = setInterval(() => {
      const seconds = this.data.recordingSeconds + 1

      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds)
      })
    }, 1000)
  },

  createAudioDraft(res) {
    const seconds = res.duration ? Math.max(Math.round(res.duration / 1000), 1) : Math.max(this.data.recordingSeconds || 1, 1)
    const draft = {
      id: Date.now(),
      extraType: this.data.type,
      extraTitle: this.data.title,
      content: this.data.content,
      type: 'audio',
      duration: `${seconds}秒`,
      createdAt: formatDate(new Date()),
      submitted: true,
      isSubmitted: true,
      status: 'saved',
      savedStatus: 'saved',
      teacherFeedbackRequestStatus: 'none',
      teacherFeedbackSubmittedAt: '',
      teacherFeedbackCloudSync: true,
      teacherFeedbackStatus: '',
      teacherFeedback: null,
      filePath: res.tempFilePath || '',
      fileSize: res.fileSize || 0
    }
    const submission = buildSavedSubmission(draft)

    saveWorkWithSubmission('extra', draft, submission)
    this.loadDrafts()
    this.syncSubmissionToCloud(submission)
  },

  createVideoDraft(data) {
    const seconds = Math.max(Number(data.duration || 1), 1)
    const draft = {
      id: Date.now(),
      extraType: this.data.type,
      extraTitle: this.data.title,
      content: this.data.content,
      type: 'video',
      duration: `${seconds}秒`,
      createdAt: formatDate(new Date()),
      submitted: true,
      isSubmitted: true,
      status: 'saved',
      savedStatus: 'saved',
      teacherFeedbackRequestStatus: 'none',
      teacherFeedbackSubmittedAt: '',
      teacherFeedbackCloudSync: true,
      teacherFeedbackStatus: '',
      teacherFeedback: null,
      filePath: data.filePath || '',
      thumbPath: data.thumbPath || '',
      promptText: data.promptText || '',
      recordTitle: data.recordTitle || '',
      recordSubtitle: data.recordSubtitle || ''
    }
    const submission = buildSavedSubmission(draft)

    saveWorkWithSubmission('extra', draft, submission)
    this.loadDrafts()
    this.syncSubmissionToCloud(submission)

    wx.showToast({
      title: '录像已保存',
      icon: 'success'
    })
  },

  playWork(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.type === 'audio') {
      const audioPath = getAudioPath(target)

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
      this.audioPlayer.play(target, `extra-${target.id}`)
      return
    }

    const videoPath = getVideoPath(target)

    console.log('[work-play] video path:', videoPath)

    if (!videoPath) {
      wx.showToast({
        title: '视频文件暂时无法查看',
        icon: 'none'
      })
      return
    }

    previewVideoByPath(videoPath, target.content || target.extraTitle || '额外训练录像')
  },

  findMergedDraft(id) {
    ensureSavedWorks('extra')
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const submissions = wx.getStorageSync('extraTrainingSubmissions') || []
    const draft = drafts.find(item => String(item.id) === String(id))
    const submission = submissions.find(item => String(item.id) === String(id))

    return draft || submission ? mergeDraftWithSubmission(draft || submission, submission) : null
  },

  handleAiFeedbackAction(e) {
    const id = e.currentTarget.dataset.id
    console.log('[extra-training][ai-feedback] click:', { workId: id })

    if (this.data.aiGeneratingWorkId && String(this.data.aiGeneratingWorkId) === String(id)) {
      return
    }

    if (!requirePhoneBound('生成 AI 点评', {
      page: this,
      onSuccess: () => this.handleAiFeedbackAction(e)
    })) return

    const target = this.findMergedDraft(id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    const action = getFeedbackActionState(target)

    if (action.status === 'pending') {
      wx.showToast({
        title: 'AI点评正在生成中，请稍候。',
        icon: 'none'
      })
      return
    }

    if (action.blocked) {
      this.showDurationBlockedToast()
      return
    }

    if (action.canView && target.aiFeedback) {
      this.showAiFeedback(target)
      return
    }

    this.generateAiFeedback(target)
  },

  async generateAiFeedback(target) {
    const workId = String(target.id || '')
    let feedbackTarget = null

    this.setData({
      aiGeneratingWorkId: workId
    }, () => {
      console.log('[extra-training][ai-feedback] entering generating:', { workId })
      this.loadDrafts()
    })

    wx.showLoading({
      title: 'AI点评生成中...',
      mask: true
    })

    try {
      const res = await generateFeedbackForSubmission(target, {
        storageKey: 'extraTrainingSubmissions'
      })
      console.log('[extra-training][ai-feedback] result:', {
        workId,
        success: res.status === 'done',
        feedbackMode: res.feedbackMode || '',
        asrStatus: res.asrStatus || ''
      })
      this.loadDrafts()

      if (res.status === 'blocked') {
        this.showDurationBlockedToast()
        return
      }

      if (res.status === 'empty_transcript') {
        this.showEmptyTranscriptModal(res)
        return
      }

      if (res.status === 'done') {
        feedbackTarget = this.findMergedDraft(target.id) || {
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
      console.log('extra training feedback failed', error)
      this.loadDrafts()
      wx.showToast({
        title: 'AI生成失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
      this.setData({
        aiGeneratingWorkId: ''
      }, () => {
        this.loadDrafts()
        if (feedbackTarget) {
          console.log('[extra-training][ai-feedback] panel opened:', { workId })
          this.showAiFeedback(feedbackTarget)
        }
      })
    }
  },

  showAiFeedback(target) {
    console.log('[extra-training][ai-feedback] panel opened:', { workId: target.id || '' })
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

  showDurationBlockedToast() {
    wx.showToast({
      title: '录音或录像需满 30 秒后再生成 AI 点评。',
      icon: 'none'
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
          const currentTarget = this.findMergedDraft(this.data.aiGeneratingWorkId)
          if (currentTarget) {
            this.generateAiFeedback(currentTarget)
          }
        }
      }
    })
  },

  handleTeacherFeedbackAction(e) {
    const id = e.currentTarget.dataset.id
    const target = this.findMergedDraft(id)

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
          `评分：${feedback.score || '暂无'}`,
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
          teacherFeedbackSubmittedAt: formatDate(new Date()),
          teacherFeedbackCloudSync: target.cloudId ? false : true,
          teacherFeedbackStatus: 'pending',
          teacherReviewSubmitted: true
        }

        // TODO: 后续新增 cloudApi action 同步 teacherFeedbackRequestStatus 到 submissions。
        patchWorkInStorages('extra', target.id, patch, target.cloudId || '')
        this.loadDrafts()
        wx.showToast({
          title: target.cloudId ? '已本地保存，云端同步稍后重试' : '已提交老师点评',
          icon: 'none'
        })
      }
    })
  },

  onAudioSliderChange(e) {
    if (!this.audioPlayer) return
    this.audioPlayer.seek(e.detail.value)
  },

  async syncSubmissionToCloud(submission) {
    const localFilePath = submission.tempFilePath || submission.filePath || ''
    let fileID = ''

    try {
      if (localFilePath) {
        const uploadRes = await uploadWorkFile(localFilePath, submission.workType || submission.type || 'audio')
        fileID = uploadRes.fileID || ''
      }

      const cloudRes = await submitWorkRecord({
        ...submission,
        fileID,
        filePath: '',
        localFilePath
      })
      const patch = {
        cloudId: cloudRes.submission && cloudRes.submission._id,
        cloudFileID: fileID,
        fileID,
        cloudUploaded: true,
        cloudError: ''
      }

      patchStoredWork('extraTrainingSubmissions', submission.id, patch)
      patchStoredWork('extraTrainingDrafts', submission.id, patch)
      this.loadDrafts()
      console.log('[extra-training] 云端作品同步成功:', patch)
    } catch (err) {
      const patch = {
        cloudFileID: fileID,
        fileID,
        cloudUploaded: false,
        cloudError: err.message || '云端同步失败'
      }

      console.warn('[extra-training] 云端作品同步失败，本地已保存:', err)
      patchStoredWork('extraTrainingSubmissions', submission.id, patch)
      patchStoredWork('extraTrainingDrafts', submission.id, patch)
      this.loadDrafts()
      wx.showToast({
        title: '已保存本地，云端同步失败',
        icon: 'none'
      })
    }
  },

  updateDraftPublicStatus(id, patch) {
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const updatedDrafts = drafts.map(item => (
      String(item.id) === String(id)
        ? {
          ...item,
          ...patch
        }
        : item
    ))

    wx.setStorageSync('extraTrainingDrafts', updatedDrafts)
    this.loadDrafts()
  },

  publishDraftToSquare(e) {
    const id = e.currentTarget.dataset.id

    if (!requirePhoneBound('发布广场', {
      page: this,
      onSuccess: () => this.publishDraftToSquare(e)
    })) return

    wx.showModal({
      title: '确认发布到广场？',
      content: '发布后，所有用户都可以看到你的作品内容。请确认作品中没有个人隐私、不适合公开的信息。',
      confirmText: '确认发布',
      cancelText: '取消',
      confirmColor: '#16c784',
      success: async res => {
        if (!res.confirm) return

        const result = await publishWorkToSquare(id, 'extra')

        if (!result.success) {
          wx.showToast({
            title: result.message || '发布失败',
            icon: 'none'
          })
          return
        }

        this.updateDraftPublicStatus(id, result.patch)
        wx.showToast({
          title: '已发布到广场',
          icon: 'success'
        })
      }
    })
  },

  unpublishDraftFromSquare(e) {
    const id = e.currentTarget.dataset.id

    wx.showModal({
      title: '确认取消公开？',
      content: '取消公开后，该作品将不再出现在表达广场。',
      confirmText: '取消公开',
      cancelText: '再想想',
      confirmColor: '#d84d4d',
      success: async res => {
        if (!res.confirm) return

        const result = await unpublishWorkFromSquare(id, 'extra')

        if (!result.success) {
          wx.showToast({
            title: result.message || '取消失败',
            icon: 'none'
          })
          return
        }

        this.updateDraftPublicStatus(id, result.patch)
        wx.showToast({
          title: '已取消公开',
          icon: 'none'
        })
      }
    })
  },

  deleteDraft(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

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
      success: res => {
        if (res.confirm) {
          this.confirmDeleteDraft(id)
        }
      }
    })
  },

  confirmDeleteDraft(id) {
    const updatedDrafts = (wx.getStorageSync('extraTrainingDrafts') || []).filter(item => Number(item.id) !== id)

    wx.setStorageSync('extraTrainingDrafts', updatedDrafts)
    wx.setStorageSync('extraTrainingSubmissions', (wx.getStorageSync('extraTrainingSubmissions') || []).filter(item => Number(item.id) !== id))

    this.loadDrafts()

    wx.showToast({
      title: '已删除',
      icon: 'none'
    })
  },

  clearTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  },

  ensureRecordPermission(callback) {
    wx.getSetting({
      success: setting => {
        if (setting.authSetting['scope.record']) {
          callback()
          return
        }

        wx.authorize({
          scope: 'scope.record',
          success: callback,
          fail: () => {
            wx.showModal({
              title: '需要录音权限',
              content: '需要开启录音权限后才能使用该功能。',
              confirmText: '去设置',
              success: res => {
                if (res.confirm) {
                  wx.openSetting()
                }
              }
            })
          }
        })
      }
    })
  },

  stopAudioContext() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy()
    }
  },

  onShareAppMessage() {
    const type = this.data.type || 'dailyQuote'
    return getDefaultShareMessage({
      title: `${this.data.title || '每日加餐训练'}｜来一起练表达`,
      path: `/pages/extra-training/extra-training?type=${encodeURIComponent(type)}`,
      pageType: 'training'
    })
  },

  onShareTimeline() {
    const type = this.data.type || 'dailyQuote'
    return getDefaultShareTimeline({
      title: `${this.data.title || '每日加餐训练'}｜来一起练表达`,
      targetPage: 'extra-training',
      params: { type },
      pageType: 'training'
    })
  },

  onUnload() {
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
    this.clearTimer()
    this.stopAudioContext()
  },

  onHide() {
    if (this.audioPlayer) {
      this.audioPlayer.pause()
    }
  }
})
