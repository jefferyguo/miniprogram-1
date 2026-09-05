const {
  DRAFTS_KEY,
  SUBMISSIONS_KEY,
  formatContentTitle,
  getModuleById,
  getTaskByModuleAndContentId,
  isTrainingContentComplete
} = require('../../utils/training-data')
const {
  generateFeedbackForSubmission,
  getFeedbackActionState,
  getFeedbackStatus,
  normalizeAiFeedback
} = require('../../utils/ai-feedback')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
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
const {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isWorkShareAllowed
} = require('../../utils/work-share-policy')
const { canAccessTask } = require('../../utils/access-control')
const { resolveSingleItemPolicy } = require('../../utils/training-access-policy')
const { uploadWorkFile } = require('../../utils/cloud-upload')
const { submitWorkRecord } = require('../../utils/cloud-api')
const { requirePhoneBound } = require('../../utils/phone-auth')
const { ensureVoiceConsentAndMicPermission } = require('../../utils/voice-consent')
const {
  ensureTrainingContentById,
  getRemoteTrainingDebugState,
  refreshRemoteTrainingContents
} = require('../../utils/remote-training')
const {
  HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
  createTrainingSnapshot,
  normalizeModuleId: normalizeOriginalModuleId
} = require('../../utils/training-original')
const {
  CONTENT_STATE,
  getTrainingContentStateView
} = require('../../utils/training-content-state')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline
} = require('../../utils/share-config')

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSeconds(seconds) {
  const minute = Math.floor(seconds / 60)
  const second = seconds % 60
  return `${pad(minute)}:${pad(second)}`
}

function getDrafts() {
  return wx.getStorageSync(DRAFTS_KEY) || []
}

function getSubmissions() {
  return wx.getStorageSync(SUBMISSIONS_KEY) || []
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

function getDurationText(duration, defaultSeconds) {
  const seconds = duration ? Math.max(Math.round(duration / 1000), 1) : Math.max(defaultSeconds || 1, 1)
  return `${seconds}秒`
}

function getDurationSeconds(durationText) {
  const match = String(durationText || '').match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

function getTaskTargetSeconds(task = {}) {
  const targetSeconds = Number(task.targetSeconds || 0)
  if (targetSeconds > 0) return targetSeconds
  const durationSeconds = getDurationSeconds(task.duration)
  return durationSeconds || 60
}

function normalizeMaterialStyle(style = {}) {
  const fontSize = ['small', 'normal', 'large', 'xlarge'].includes(style.fontSize) ? style.fontSize : 'normal'
  const color = ['default', 'green', 'red', 'blue', 'gold'].includes(style.color) ? style.color : 'default'
  return {
    fontSize,
    color,
    bold: style.bold === true
  }
}

function getMaterialStyleClass(style = {}) {
  const normalized = normalizeMaterialStyle(style)
  return [
    `material-size-${normalized.fontSize}`,
    `material-color-${normalized.color}`,
    normalized.bold ? 'material-bold' : ''
  ].filter(Boolean).join(' ')
}

function normalizeMaterialRichStyle(value = {}, contentLength) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const maxLength = Number.isFinite(contentLength) ? Math.max(contentLength, 0) : Infinity
  const ranges = Array.isArray(source.ranges) ? source.ranges : []

  return {
    ranges: ranges
      .map(item => {
        const start = Math.max(Number(item && item.start || 0), 0)
        const end = Math.max(Number(item && item.end || 0), 0)
        const clampedStart = Number.isFinite(maxLength) ? Math.min(start, maxLength) : start
        const clampedEnd = Number.isFinite(maxLength) ? Math.min(end, maxLength) : end
        return {
          start: clampedStart,
          end: clampedEnd,
          ...normalizeMaterialStyle(item)
        }
      })
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
  }
}

function buildMaterialSegments(material, baseStyle, richStyle) {
  const text = String(material || '')
  const ranges = normalizeMaterialRichStyle(richStyle, text.length).ranges
  const segments = []
  let cursor = 0

  ranges.forEach(range => {
    if (range.start > cursor) {
      segments.push({
        text: text.slice(cursor, range.start),
        className: getMaterialStyleClass(baseStyle)
      })
    }
    const start = Math.max(range.start, cursor)
    if (range.end > start) {
      segments.push({
        text: text.slice(start, range.end),
        className: getMaterialStyleClass(range)
      })
      cursor = range.end
    }
  })

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      className: getMaterialStyleClass(baseStyle)
    })
  }

  return segments.filter(item => item.text)
}

function buildDisplayDraft(draft) {
  const feedbackAction = getFeedbackActionState(draft)
  const teacherState = getTeacherFeedbackState(draft)

  return {
    ...draft,
    shareAllowed: isWorkShareAllowed(draft),
    icon: draft.type === 'audio' ? '🎤' : '🎥',
    audioKey: `main-${draft.id}`,
    typeTitle: draft.type === 'audio' ? '录音作品' : '录像作品',
    statusText: getSavedStatusText(draft),
    statusClass: getSavedStatusClass(draft),
    actionText: draft.type === 'audio' ? '播放' : '查看',
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    aiStatusText: getAiStatusText(draft),
    aiStatusClass: getAiStatusClass(draft),
    teacherButtonText: getTeacherButtonText(draft),
    teacherStatusText: getTeacherStatusText(draft),
    teacherStatusClass: getTeacherStatusClass(draft),
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

function getTaskDisplayTitle(task) {
  if (!task) return ''
  return task.displayTitle || formatContentTitle(task) || task.contentTitle || task.title || ''
}

function normalizeRouteModuleId(value) {
  const text = String(value || '').trim()
  const aliases = {
    reading: 'reading',
    read: 'reading',
    retell: 'retell',
    retelling: 'retell',
    topic: 'topic',
    randomTopic: 'topic',
    mandarin: 'mandarin',
    putonghua: 'mandarin',
    tongueTwister: 'mandarin',
    speech: 'speech',
    leaderSpeech: 'leaderSpeech',
    leaderspeech: 'leaderSpeech'
  }
  if (aliases[text]) return aliases[text]
  if (/朗读|朗诵|reading/i.test(text)) return 'reading'
  if (/复述|retell/i.test(text)) return 'retell'
  if (/话题|即兴|topic/i.test(text)) return 'topic'
  if (/普通话|绕口令|mandarin|putonghua/i.test(text)) return 'mandarin'
  if (/领导发言|leader\s*speech/i.test(text)) return 'leaderSpeech'
  if (/演讲|speech/i.test(text)) return 'speech'
  return 'reading'
}

function decodeRouteValue(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch (error) {
    console.warn('[task-detail] 路由参数解码失败:', { value: String(value || '').slice(0, 120) })
    return String(value || '')
  }
}

function buildSavedSubmission(pageData, draft) {
  const displayTitle = getTaskDisplayTitle(pageData.task)
  const moduleId = draft.moduleId || pageData.moduleId || ''
  const contentId = draft.contentId || pageData.contentId || pageData.task.contentId || ''
  const snapshotCategory = moduleId === 'retell' ? 'retelling' : moduleId
  const trainingSnapshot = createTrainingSnapshot(pageData.task, snapshotCategory)

  return {
    id: draft.id,
    sourceType: 'main',
    ...buildClassSubmissionPatch(),
    moduleId,
    category: moduleId,
    moduleType: moduleId,
    trainingType: moduleId,
    moduleTitle: draft.moduleTitle,
    day: draft.day,
    contentId,
    taskId: contentId,
    taskTitle: draft.taskTitle,
    contentTitle: displayTitle || draft.taskTitle || pageData.task.title,
    title: displayTitle || draft.taskTitle || pageData.task.title,
    ...trainingSnapshot,
    // 主训练原文使用专用快照字段，不复用额外训练的 content 字段。
    content: '',
    promptText: '',
    materialSummary: displayTitle || draft.taskTitle || pageData.task.title || '',
    materialText: '',
    requirement: pageData.task.requirement || '',
    type: draft.type,
    workType: draft.type,
    duration: draft.duration,
    durationSeconds: getDurationSeconds(draft.duration),
    targetSeconds: getTaskTargetSeconds(pageData.task),
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
    mimeType: draft.mimeType || '',
    traceId: draft.traceId || '',
    mediaInfo: draft.mediaInfo || null,
    isPublic: false,
    publicPermissionConfirmed: false,
    aiFeedbackStatus: '',
    aiFeedbackSource: '',
    aiFeedbackModel: ''
  }
}

Page({
  data: {
    // 本页面使用真实录音；录像跳转到 video-record 页面完成
    moduleInfo: null,
    task: null,
    moduleId: '',
    day: 1,
    contentId: '',
    contentLoadState: CONTENT_STATE.LOADING,
    contentReady: false,
    contentError: false,
    contentNotFound: false,
    retrying: false,
    trainingContentLoading: true,
    trainingContentUnavailable: false,
    trainingContentMessage: '正在加载完整训练内容...',
    isHistoricalOriginal: false,
    historicalOriginalUnavailable: false,
    historicalOriginalMessage: HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
    materialStyleClass: 'material-size-normal material-color-default',
    materialSegments: [],
    hasMaterialSegments: false,
    actionStatus: '还没有开始录制',
    isAudioRecording: false,
    isVideoRecording: false,
    recordingSeconds: 0,
    recordingTimeText: '00:00',
    drafts: [],
    hasDrafts: false,
    submittedCount: 0,
    feedbackCount: 0,
    feedbackDesc: '还没有作品，完成录音或录像后可以生成 AI 点评。',
    teacherFeedbackEnabled: FEATURE_FLAGS.teacherFeedbackEnabled,
    audioPlayer: getInitialAudioPlayer(),
    showAiFeedbackPanel: false,
    currentAiFeedback: null,
    aiFeedbackScrollTop: 0,
    aiGeneratingWorkId: ''
  },

  onLoad(options = {}) {
    this._isUnloaded = false
    this._contentLoadRevision = 0
    enableShareMenu()
    if (String(options.historyOriginal || '') === '1') {
      this.loadHistoricalOriginal(options)
      return
    }
    this.initializeTask(options)
  },

  async loadHistoricalOriginal(options = {}) {
    const revision = ++this._contentLoadRevision
    const contentId = decodeRouteValue(options.contentId)
    const snapshotKey = decodeRouteValue(options.snapshotKey)
    let snapshot = null

    if (snapshotKey) {
      snapshot = wx.getStorageSync(snapshotKey) || null
      wx.removeStorageSync(snapshotKey)
    }

    const routeModuleId = normalizeRouteModuleId(
      options.moduleId ||
      options.category ||
      snapshot && (snapshot.moduleId || snapshot.category) ||
      normalizeOriginalModuleId(contentId) ||
      'reading'
    )

    if (snapshot && String(snapshot.content || snapshot.material || '').trim()) {
      if (this._isUnloaded || revision !== this._contentLoadRevision) return
      this.applyHistoricalOriginal(snapshot, routeModuleId, contentId)
      return
    }

    if (!contentId) {
      if (this._isUnloaded || revision !== this._contentLoadRevision) return
      this.showHistoricalOriginalUnavailable()
      return
    }

    const localExact = getTaskByModuleAndContentId(routeModuleId, contentId)
    try {
      const result = await ensureTrainingContentById({ contentId })
      if (this._isUnloaded || revision !== this._contentLoadRevision) return
      if (result && result.status === 'ready' && result.content) {
        this.applyHistoricalOriginal(result.content, routeModuleId, contentId)
        return
      }
    } catch (error) {
      if (this._isUnloaded || revision !== this._contentLoadRevision) return
      console.warn('[task-detail] 历史原文精确查询失败:', {
        contentId,
        code: error && (error.code || error.errCode) || '',
        message: error && (error.message || error.errMsg) || ''
      })
    }

    // 云端不可用时，只允许使用 contentId 完全相同且正文已落地的本地内容。
    if (this._isUnloaded || revision !== this._contentLoadRevision) return
    if (localExact && localExact.contentId === contentId && isTrainingContentComplete(localExact)) {
      this.applyHistoricalOriginal(localExact, routeModuleId, contentId)
      return
    }

    this.showHistoricalOriginalUnavailable()
  },

  applyHistoricalOriginal(source = {}, fallbackModuleId = 'reading', requestedContentId = '') {
    if (this._isUnloaded) return
    const moduleId = normalizeRouteModuleId(source.moduleId || source.category || fallbackModuleId)
    const moduleInfo = getModuleById(moduleId)
    const material = String(source.content || source.material || source.promptText || '').trim()
    const day = Number(source.day || source.dayNumber || 0)
    const task = {
      ...source,
      contentId: source.contentId || requestedContentId,
      day,
      displayIndex: Number(source.displayIndex || source.sortOrder || day || 0),
      title: source.title || source.contentTitle || '历史训练内容',
      contentTitle: source.contentTitle || source.title || '历史训练内容',
      material,
      content: material,
      promptText: material,
      tips: Array.isArray(source.tips) ? source.tips : [],
      membershipLevel: source.membershipLevel || resolveSingleItemPolicy(source).effectiveMembershipLevel
    }

    if (!moduleInfo || !material) {
      this.showHistoricalOriginalUnavailable()
      return
    }

    const displayTask = {
      ...task,
      displayTitle: getTaskDisplayTitle(task)
    }
    const materialStyleClass = getMaterialStyleClass(displayTask.contentStyle)
    const materialSegments = buildMaterialSegments(displayTask.material, displayTask.contentStyle, displayTask.contentRichStyle)

    this.setData({
      moduleId,
      day,
      contentId: displayTask.contentId || requestedContentId,
      moduleInfo,
      task: displayTask,
      isHistoricalOriginal: true,
      historicalOriginalUnavailable: false,
      contentLoadState: CONTENT_STATE.READY,
      contentReady: true,
      contentError: false,
      contentNotFound: false,
      retrying: false,
      trainingContentLoading: false,
      trainingContentUnavailable: false,
      materialStyleClass,
      materialSegments,
      hasMaterialSegments: materialSegments.length > 0
    })
  },

  showHistoricalOriginalUnavailable() {
    if (this._isUnloaded) return
    this.setData({
      moduleInfo: null,
      task: null,
      isHistoricalOriginal: true,
      historicalOriginalUnavailable: true,
      contentLoadState: CONTENT_STATE.NOT_FOUND,
      contentReady: false,
      contentError: false,
      contentNotFound: true,
      retrying: false,
      trainingContentLoading: false,
      historicalOriginalMessage: HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE
    })
  },

  resolveTaskRoute(options = {}) {
    const moduleId = normalizeRouteModuleId(options.moduleId || options.category || options.moduleType || options.trainingType || 'reading')
    const contentId = decodeRouteValue(options.contentId)
    const day = Number(options.day || 1)
    const moduleInfo = getModuleById(moduleId)
    // 正文身份只允许永久 contentId；day 仅用于页面展示。
    const task = contentId ? getTaskByModuleAndContentId(moduleId, contentId) : null

    return { moduleId, contentId, day, moduleInfo, task }
  },

  setContentLoadState(state, message = '') {
    if (this._isUnloaded) return
    this.setData(getTrainingContentStateView(state, message))
  },

  applyTaskToPage(resolved, state) {
    const { moduleId, contentId, day, moduleInfo, task } = resolved
    if (!moduleInfo || !task || this._isUnloaded) return false

    const accessResult = canAccessTask(moduleId, task)
    console.log('[task-detail] 当前 Day:', task.day, 'access:', accessResult)

    if (!accessResult.allowed) {
      if (accessResult.reason === 'need_phone') {
        setTimeout(() => {
          if (this._isUnloaded) return
          requirePhoneBound('使用会员训练内容', {
            page: this,
            onSuccess: () => this.initializeTask(this._taskRouteOptions || resolved)
          })
        }, 100)
        return false
      }
      this.showMemberModal()
      return false
    }

    // Apply contentStylePreset if no explicit contentStyle exists
    const presetStyles = {
      'small-green-bold': { fontSize: 'small', color: 'green', bold: true }
    }
    const effectiveContentStyle = task.contentStyle && task.contentStyle.fontSize
      ? task.contentStyle
      : (task.contentStylePreset ? presetStyles[task.contentStylePreset] : undefined) || task.contentStyle || {}
    const displayTask = {
      ...task,
      displayIndex: Number(task.displayIndex || task.sortOrder || task.day || day || 0),
      displayTitle: getTaskDisplayTitle(task),
      contentStyle: effectiveContentStyle,
      titleStyle: task.titleStyle || undefined
    }
    const materialStyleClass = getMaterialStyleClass(effectiveContentStyle)
    const materialSegments = state === CONTENT_STATE.READY
      ? buildMaterialSegments(displayTask.material, effectiveContentStyle, displayTask.contentRichStyle)
      : []

    console.log('[task-detail] 当前任务标题：', displayTask.displayTitle, displayTask.title)

    this.setData({
      moduleId,
      day: Number(displayTask.day || day),
      contentId: displayTask.contentId || contentId,
      moduleInfo,
      task: displayTask,
      materialStyleClass,
      materialSegments,
      hasMaterialSegments: materialSegments.length > 0
    })
    this.setContentLoadState(state)

    if (state !== CONTENT_STATE.READY) return true
    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this)
    }
    if (!this.recorderManager) {
      this.initRecorderManager()
    }
    this.loadDrafts()
    this.loadFeedbackSummary()
    return true
  },

  async initializeTask(options = {}) {
    let resolved = this.resolveTaskRoute(options)
    const revision = ++this._contentLoadRevision
    this._taskRouteOptions = {
      moduleId: resolved.moduleId,
      day: resolved.day,
      contentId: resolved.contentId,
      contentVersion: resolved.task && (resolved.task.contentVersion || resolved.task.version) || options.contentVersion || ''
    }
    const localComplete = isTrainingContentComplete(resolved.task)
    const category = resolved.moduleId === 'retell' ? 'retelling' : resolved.moduleId

    console.log('[task-detail][initialize] route:', {
      rawOptions: {
        moduleId: options.moduleId || '',
        category: options.category || '',
        day: options.day || '',
        contentId: options.contentId || ''
      },
      moduleId: resolved.moduleId,
      category,
      day: resolved.day,
      contentId: resolved.contentId,
      revision,
      localHit: Boolean(resolved.task),
      localComplete,
      remoteState: getRemoteTrainingDebugState({
        category,
        contentId: resolved.contentId || resolved.task && resolved.task.contentId || ''
      })
    })

    if (!resolved.moduleInfo || !resolved.task) {
      if (resolved.moduleInfo) {
        const placeholderTask = {
          day: resolved.day,
          contentId: resolved.contentId,
          contentVersion: options.contentVersion || '',
          title: '训练内容',
          contentTitle: '训练内容',
          material: '',
          tips: []
        }
        this.setData({
          moduleId: resolved.moduleId,
          day: resolved.day,
          contentId: resolved.contentId,
          moduleInfo: resolved.moduleInfo,
          task: placeholderTask,
          materialSegments: [],
          hasMaterialSegments: false
        })
        this.setContentLoadState(CONTENT_STATE.LOADING)
      } else {
        this.setContentLoadState(CONTENT_STATE.LOADING)
      }
      await this.loadCurrentTrainingContent(this._taskRouteOptions, {
        revision,
        expectedActive: false
      })
      return
    }

    const initialAccess = canAccessTask(resolved.moduleId, resolved.task)
    if (!initialAccess.allowed) {
      await refreshRemoteTrainingContents({ force: true, category })
      if (this._isUnloaded || revision !== this._contentLoadRevision) return
      resolved = this.resolveTaskRoute(options)
    }

    const applied = this.applyTaskToPage(
      resolved,
      isTrainingContentComplete(resolved.task) ? CONTENT_STATE.READY : CONTENT_STATE.LOADING
    )
    if (!applied || isTrainingContentComplete(resolved.task)) return
    await this.loadCurrentTrainingContent(this._taskRouteOptions, {
      revision,
      expectedActive: true
    })
  },

  async loadCurrentTrainingContent(options = {}, settings = {}) {
    const revision = Number(settings.revision || 0) || ++this._contentLoadRevision
    const isRetry = settings.retry === true
    const resolvedBeforeLoad = this.resolveTaskRoute(options)
    const contentId = resolvedBeforeLoad.contentId || resolvedBeforeLoad.task && resolvedBeforeLoad.task.contentId || ''
    const contentVersion = resolvedBeforeLoad.task && (resolvedBeforeLoad.task.contentVersion || resolvedBeforeLoad.task.version) || options.contentVersion || ''
    const category = resolvedBeforeLoad.moduleId === 'retell' ? 'retelling' : resolvedBeforeLoad.moduleId
    if (!this._isUnloaded) {
      this.setData({ retrying: isRetry })
      this.setContentLoadState(CONTENT_STATE.LOADING, isRetry
        ? '正在重新加载完整训练内容...'
        : '正在加载完整训练内容...')
    }

    let result
    if (contentId) {
      result = await ensureTrainingContentById({
        contentId,
        contentVersion
      })
    } else {
      result = {
        status: 'notFound',
        source: 'route',
        code: 'INVALID_PERMANENT_CONTENT_ID',
        message: '内容同步中或暂时无法获取。'
      }
    }

    if (this._isUnloaded || revision !== this._contentLoadRevision) return
    this.setData({ retrying: false })

    if (result.status === 'ready') {
      const indexResolved = this.resolveTaskRoute({ ...options, contentId })
      const remoteTask = result.content
      if (remoteTask && isTrainingContentComplete(remoteTask)) {
        const task = {
          ...(indexResolved.task || {}),
          ...remoteTask,
          contentId,
          day: Number(remoteTask.day || indexResolved.task && indexResolved.task.day || options.day || 0),
          material: String(remoteTask.content || '').trim(),
          content: String(remoteTask.content || '').trim()
        }
        this.applyTaskToPage({
          ...indexResolved,
          moduleInfo: indexResolved.moduleInfo || getModuleById(normalizeRouteModuleId(remoteTask.moduleId || remoteTask.category)),
          task,
          day: task.day
        }, CONTENT_STATE.READY)
        return
      }
      this.setContentLoadState(CONTENT_STATE.NETWORK_ERROR)
      return
    }

    if (result.status === 'notFound') {
      console.warn('[task-detail][not-found] confirmed:', {
        contentId,
        category,
        requestCompleted: true,
        requestError: false,
        explicitNotFound: true,
        revision,
        remoteState: getRemoteTrainingDebugState({ category, contentId })
      })
      this.setContentLoadState(CONTENT_STATE.NOT_FOUND, result.message)
      return
    }

    if (result.status === 'accessDenied' || result.code === 'membership_required') {
      this.setContentLoadState(CONTENT_STATE.ACCESS_DENIED, '该训练为会员内容，开通会员后即可练习。')
      this.showMemberModal()
      return
    }

    if (result.status === 'inactive' || result.code === 'content_inactive') {
      this.setContentLoadState(CONTENT_STATE.INACTIVE, '该训练内容已下架。')
      return
    }

    console.warn('[task-detail] 完整训练正文加载失败:', {
      contentId,
      category,
      source: result.source || '',
      code: result.code || '',
      message: result.message || ''
    })
    this.setContentLoadState(CONTENT_STATE.NETWORK_ERROR, result.message)
  },

  retryTrainingContent() {
    if (this.data.trainingContentLoading || this.data.retrying) return
    const route = this._taskRouteOptions || {
      moduleId: this.data.moduleId,
      day: this.data.day,
      contentId: this.data.contentId
    }
    const resolved = this.resolveTaskRoute(route)
    this.loadCurrentTrainingContent(route, {
      retry: true,
      expectedActive: Boolean(resolved.task)
    })
  },

  showMemberModal() {
    wx.showModal({
      title: '会员内容',
      content: '该训练为会员内容，开通会员后即可解锁更多训练。',
      confirmText: '开通会员',
      cancelText: '返回',
      success: async res => {
        if (res.confirm) {
          wx.redirectTo({
            url: '/pages/member-center/member-center'
          })
          return
        }

        wx.navigateBack({
          fail: () => {
            wx.switchTab({
              url: '/pages/training/training'
            })
          }
        })
      }
    })
  },

  ensureTaskAccess() {
    if (!this.ensureTrainingContentReady()) return false
    const accessResult = canAccessTask(this.data.moduleId, this.data.task || {})
    if (accessResult.allowed) return true

    if (accessResult.reason === 'need_phone') {
      requirePhoneBound('使用会员训练内容', {
        page: this,
        onSuccess: () => this.initializeTask({
          moduleId: this.data.moduleId,
          day: this.data.day,
          contentId: this.data.contentId
        })
      })
      return false
    }

    this.showMemberModal()
    return false
  },

  ensureTrainingContentReady() {
    if (!this.data.contentReady) {
      wx.showToast({
        title: this.data.contentLoadState === CONTENT_STATE.LOADING
          ? '训练内容正在加载，请稍候'
          : '请先重新加载完整训练内容',
        icon: 'none'
      })
      return false
    }
    // 防止占位正文进入录音、AI点评和作品保存
    if (!isTrainingContentComplete(this.data.task)) {
      wx.showToast({ title: '训练内容尚未加载完成，请重试', icon: 'none' })
      return false
    }
    return true
  },

  onShow() {
    if (this.data.moduleId) {
      this.loadDrafts()
      this.loadFeedbackSummary()
      if (!this.data.isHistoricalOriginal) {
        this.refreshTaskOnShow()
      }
    }
  },

  async refreshTaskOnShow() {
    if (this.data.trainingContentLoading || this.data.isAudioRecording || this.data.isVideoRecording) return
    const route = this._taskRouteOptions || {
      moduleId: this.data.moduleId,
      day: this.data.day,
      contentId: this.data.contentId,
      contentVersion: this.data.task && (this.data.task.contentVersion || this.data.task.version) || ''
    }
    const resolved = this.resolveTaskRoute(route)
    const category = resolved.moduleId === 'retell' ? 'retelling' : resolved.moduleId

    try {
      await refreshRemoteTrainingContents({ force: true, category })
      if (!this._isUnloaded) await this.initializeTask(route)
    } catch (error) {
      console.warn('[task-detail] onShow 训练内容刷新失败，继续使用当前内容:', error)
    }
  },

  initRecorderManager() {
    this.recorderManager = wx.getRecorderManager()

    this.recorderManager.onStart(() => {
      this.startRecordingTimer()
    })

    this.recorderManager.onStop(res => {
      this.clearRecordingTimer()
      this.createAudioDraft(res)
      this.setData({
        isAudioRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00',
        actionStatus: '录音已保存'
      })
      wx.showToast({
        title: '录音已保存',
        icon: 'success'
      })
    })

    this.recorderManager.onError(error => {
      this.clearRecordingTimer()
      this.setData({
        isAudioRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00',
        actionStatus: '录音失败，请重试'
      })
      console.error('录音失败', error)
      wx.showToast({
        title: '录音失败',
        icon: 'none'
      })
    })
  },

  loadDrafts() {
    const saved = ensureSavedWorks('main')
    const currentMap = {}
    const currentContentId = this.data.contentId || (this.data.task && this.data.task.contentId) || ''
    const isCurrentTaskWork = item => Boolean(
      currentContentId &&
      item.moduleId === this.data.moduleId &&
      String(item.contentId || '') === String(currentContentId)
    )

    saved.drafts
      .filter(isCurrentTaskWork)
      .forEach(item => {
        currentMap[String(item.id)] = item
      })

    saved.submissions
      .filter(isCurrentTaskWork)
      .forEach(item => {
        const key = String(item.id)
        currentMap[key] = mergeDraftWithSubmission(currentMap[key] || item, item)
      })

    const drafts = Object.keys(currentMap)
      .map(key => applyAiGeneratingState(buildDisplayDraft(currentMap[key]), this.data.aiGeneratingWorkId))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    this.setData({
      drafts,
      hasDrafts: drafts.length > 0
    })
  },

  loadFeedbackSummary() {
    const currentContentId = this.data.contentId || (this.data.task && this.data.task.contentId) || ''
    const taskSubmissions = ensureSavedWorks('main').submissions.filter(item => Boolean(
      currentContentId &&
      item.moduleId === this.data.moduleId &&
      String(item.contentId || '') === String(currentContentId)
    ))
    const feedbackCount = taskSubmissions.filter(item => (
      item.aiFeedbackStatus === 'done' && item.aiFeedback
    )).length
    const submittedCount = taskSubmissions.length

    this.setData({
      submittedCount,
      feedbackCount,
      feedbackDesc: submittedCount > 0
        ? `已保存 ${submittedCount} 个作品，${feedbackCount} 个已有 AI 点评。`
        : '还没有作品，完成录音或录像后可以生成 AI 点评。'
    })
  },

  async toggleAudioRecord() {
    if (!this.ensureTaskAccess()) return

    if (this.data.isVideoRecording) {
      wx.showToast({
        title: '请先完成录像',
        icon: 'none'
      })
      return
    }

    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
      return
    }

    if (this._audioStartPending) return

    if (!requirePhoneBound('提交训练作品', {
      page: this,
      onSuccess: () => this.toggleAudioRecord()
    })) return

    this._audioStartPending = true
    try {
      const allowed = await ensureVoiceConsentAndMicPermission(this)
      if (!allowed || this.data.isAudioRecording || this.data.isVideoRecording) return
      this.startAudioRecord()
    } finally {
      this._audioStartPending = false
    }
  },

  startAudioRecord() {
    this.clearRecordingTimer()
    this.setData({
      isAudioRecording: true,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      actionStatus: '正在录音中 00:00'
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

  toggleVideoRecord() {
    if (!this.ensureTaskAccess()) return

    if (this.data.isAudioRecording) {
      wx.showToast({
        title: '请先停止录音',
        icon: 'none'
      })
      return
    }

    if (!requirePhoneBound('提交训练作品', {
      page: this,
      onSuccess: () => this.toggleVideoRecord()
    })) return

    wx.navigateTo({
      url: '/pages/video-record/video-record',
      events: {
        videoRecorded: data => {
          this.createVideoDraft(data)
        }
      },
      success: res => {
        const displayTitle = getTaskDisplayTitle(this.data.task)

        res.eventChannel.emit('videoRecordContext', {
          sourceType: 'main',
          title: displayTitle,
          taskTitle: displayTitle,
          contentTitle: displayTitle,
          moduleTitle: this.data.moduleInfo.title,
          day: this.data.task.day,
          subtitle: `${this.data.moduleInfo.title} 序号 ${this.data.task.displayIndex || this.data.task.day}`,
          material: this.data.task.material || '',
          promptText: this.data.task.promptText || this.data.task.material || '',
          requirement: this.data.task.requirement || '',
          maxVideoDuration: this.data.task.maxVideoDuration,
          videoMaxDuration: this.data.task.videoMaxDuration,
          durationLimit: this.data.task.durationLimit
        })
      }
    })
  },

  startRecordingTimer() {
    this.clearRecordingTimer()
    this.recordingTimer = setInterval(() => {
      const seconds = this.data.recordingSeconds + 1

      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds),
        actionStatus: `正在录音中 ${formatSeconds(seconds)}`
      })
    }, 1000)
  },

  clearRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  },

  createAudioDraft(res) {
    const trainingSnapshot = createTrainingSnapshot(
      this.data.task,
      this.data.moduleInfo.id === 'retell' ? 'retelling' : this.data.moduleInfo.id
    )
    const draft = {
      id: Date.now(),
      moduleId: this.data.moduleInfo.id,
      moduleTitle: this.data.moduleInfo.title,
      day: this.data.task.day,
      contentId: this.data.task.contentId || this.data.contentId || '',
      taskTitle: getTaskDisplayTitle(this.data.task),
      contentTitle: getTaskDisplayTitle(this.data.task),
      ...trainingSnapshot,
      type: 'audio',
      duration: getDurationText(res.duration, this.data.recordingSeconds),
      createdAt: formatDateTime(new Date()),
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
    const submission = buildSavedSubmission(this.data, draft)

    saveWorkWithSubmission('main', draft, submission)
    this.loadDrafts()
    this.loadFeedbackSummary()
    this.syncSubmissionToCloud(submission)
  },

  createVideoDraft(data) {
    const seconds = Math.max(Number(data.duration || 1), 1)
    const trainingSnapshot = createTrainingSnapshot(
      this.data.task,
      this.data.moduleInfo.id === 'retell' ? 'retelling' : this.data.moduleInfo.id
    )
    const draft = {
      id: Date.now(),
      moduleId: this.data.moduleInfo.id,
      moduleTitle: this.data.moduleInfo.title,
      day: this.data.task.day,
      contentId: this.data.task.contentId || this.data.contentId || '',
      taskTitle: getTaskDisplayTitle(this.data.task),
      contentTitle: getTaskDisplayTitle(this.data.task),
      ...trainingSnapshot,
      type: 'video',
      duration: `${seconds}秒`,
      createdAt: formatDateTime(new Date()),
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
      fileSize: data.fileSize || 0,
      mimeType: data.mimeType || 'video/mp4',
      traceId: data.traceId || '',
      mediaInfo: data.mediaInfo || null,
      thumbPath: data.thumbPath || '',
      promptText: '',
      recordTitle: data.recordTitle || '',
      recordSubtitle: data.recordSubtitle || ''
    }
    const submission = buildSavedSubmission(this.data, draft)

    saveWorkWithSubmission('main', draft, submission)
    this.loadDrafts()
    this.loadFeedbackSummary()
    this.syncSubmissionToCloud(submission)
    wx.showToast({
      title: '录像已保存',
      icon: 'success'
    })
  },

  playWork(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = getDrafts()
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.type === 'audio') {
      this.playAudio(target, `main-${target.id}`)
      return
    }

    this.previewVideo(target)
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

    previewVideoByPath(videoPath, item.taskTitle || '训练录像')
  },

  findMergedDraft(id) {
    ensureSavedWorks('main')
    const draft = getDrafts().find(item => String(item.id) === String(id))
    const submission = getSubmissions().find(item => String(item.id) === String(id))
    return draft || submission ? mergeDraftWithSubmission(draft || submission, submission) : null
  },

  handleAiFeedbackAction(e) {
    if (!this.ensureTrainingContentReady()) return
    const id = e.currentTarget.dataset.id
    console.log('[task-detail][ai-feedback] click:', { workId: id })

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
    if (!this.ensureTrainingContentReady()) return
    const workId = String(target.id || '')
    let feedbackTarget = null
    const currentTask = this.data.task || {}
    const taskMaterial = currentTask.material || currentTask.content || currentTask.promptText || ''
    const feedbackInput = {
      ...target,
      originalText: taskMaterial,
      materialText: taskMaterial,
      materialSummary: target.materialSummary || getTaskDisplayTitle(currentTask),
      contentId: target.contentId || this.data.contentId || currentTask.contentId || '',
      taskId: target.taskId || target.contentId || this.data.contentId || currentTask.contentId || '',
      category: target.category || this.data.moduleId,
      moduleType: target.moduleType || this.data.moduleId,
      trainingType: target.trainingType || this.data.moduleId
    }

    this.setData({
      aiGeneratingWorkId: workId
    }, () => {
      console.log('[task-detail][ai-feedback] entering generating:', { workId })
      this.loadDrafts()
    })

    wx.showLoading({
      title: 'AI点评生成中...',
      mask: true
    })

    try {
      const res = await generateFeedbackForSubmission(feedbackInput, {
        storageKey: SUBMISSIONS_KEY
      })
      console.log('[task-detail][ai-feedback] result:', {
        workId,
        success: res.status === 'done',
        feedbackMode: res.feedbackMode || '',
        asrStatus: res.asrStatus || ''
      })
      this.loadDrafts()
      this.loadFeedbackSummary()

      if (res.status === 'blocked') {
        this.showDurationBlockedToast()
        return
      }

      if (res.status === 'empty_transcript') {
        this.showEmptyTranscriptModal(res, feedbackInput)
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
      console.log('task detail feedback failed', error)
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
        this.loadFeedbackSummary()
        if (feedbackTarget) {
          console.log('[task-detail][ai-feedback] panel opened:', { workId })
          this.showAiFeedback(feedbackTarget)
        }
      })
    }
  },

  showAiFeedback(target) {
    console.log('[task-detail][ai-feedback] panel opened:', { workId: target.id || '' })
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

  showEmptyTranscriptModal(res = {}, retryTarget = null) {
    const canRetry = res.canRetry === true
    console.error('[task-detail][ai-feedback] ASR returned no transcript:', {
      debugCode: res.debugCode || '',
      asrStatus: res.asrStatus || '',
      asrErrorMessage: res.asrErrorMessage || '',
      providerCode: res.providerCode || '',
      requestId: res.requestId || ''
    })
    wx.showModal({
      title: '未识别到有效语音',
      content: res.message || '暂未识别到有效语音内容，请确认录音声音清晰后重试。',
      confirmText: canRetry ? '重新识别' : '我知道了',
      cancelText: canRetry ? '我知道了' : '',
      showCancel: canRetry,
      success: modalRes => {
        if (modalRes.confirm && canRetry) {
          const currentTarget = retryTarget || this.findMergedDraft(this.data.aiGeneratingWorkId)
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
          teacherFeedbackSubmittedAt: formatDateTime(new Date()),
          teacherFeedbackCloudSync: target.cloudId ? false : true,
          teacherFeedbackStatus: 'pending',
          teacherReviewSubmitted: true
        }

        // TODO: 后续新增 cloudApi action 同步 teacherFeedbackRequestStatus 到 submissions。
        patchWorkInStorages('main', target.id, patch, target.cloudId || '')
        this.loadDrafts()
        this.loadFeedbackSummary()
        wx.showToast({
          title: target.cloudId ? '已本地保存，云端同步稍后重试' : '已提交老师点评',
          icon: 'none'
        })
      }
    })
  },

  async syncSubmissionToCloud(submission) {
    const localFilePath = submission.tempFilePath || submission.filePath || ''
    let fileID = ''

    try {
      if (localFilePath) {
        const uploadRes = await uploadWorkFile(localFilePath, submission.workType || submission.type || 'audio', {
          traceId: submission.traceId || '',
          mimeType: submission.mimeType || ''
        })
        fileID = uploadRes.fileID || ''
        if (uploadRes.fileSize !== null && uploadRes.fileSize !== undefined) submission.fileSize = uploadRes.fileSize
      }

      const cloudRes = await submitWorkRecord({
        ...submission,
        fileID,
        fileSize: submission.fileSize,
        filePath: '',
        localFilePath
      })
      const patch = {
        cloudId: cloudRes.submission && cloudRes.submission._id,
        cloudFileID: fileID,
        fileID,
        fileSize: submission.fileSize,
        cloudUploaded: true,
        cloudError: ''
      }

      patchStoredWork(SUBMISSIONS_KEY, submission.id, patch)
      patchStoredWork(DRAFTS_KEY, submission.id, patch)
      this.loadDrafts()
      console.log('[task-detail] 云端作品同步成功:', patch)
    } catch (err) {
      const patch = {
        cloudFileID: fileID,
        fileID,
        cloudUploaded: false,
        cloudError: err.message || '云端同步失败'
      }

      console.warn('[task-detail] 云端作品同步失败，本地已保存:', err)
      patchStoredWork(SUBMISSIONS_KEY, submission.id, patch)
      patchStoredWork(DRAFTS_KEY, submission.id, patch)
      this.loadDrafts()
      wx.showToast({
        title: '已保存本地，云端同步失败',
        icon: 'none'
      })
    }
  },

  updateDraftPublicStatus(id, patch) {
    const drafts = getDrafts()
    const updatedDrafts = drafts.map(item => (
      String(item.id) === String(id)
        ? {
          ...item,
          ...patch
        }
        : item
    ))

    wx.setStorageSync(DRAFTS_KEY, updatedDrafts)
    this.loadDrafts()
  },

  publishDraftToSquare(e) {
    const id = e.currentTarget.dataset.id
    const target = this.findMergedDraft(id)

    if (!target || !isWorkShareAllowed(target)) {
      wx.showToast({
        title: target ? VIDEO_SHARE_DISABLED_MESSAGE : '作品不存在',
        icon: 'none'
      })
      return
    }

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

        const result = await publishWorkToSquare(id, 'main')

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

        const result = await unpublishWorkFromSquare(id, 'main')

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
    const drafts = getDrafts()
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
    const updatedDrafts = getDrafts().filter(item => Number(item.id) !== id)

    wx.setStorageSync(DRAFTS_KEY, updatedDrafts)
    wx.setStorageSync(SUBMISSIONS_KEY, getSubmissions().filter(item => Number(item.id) !== id))

    this.loadDrafts()
    this.loadFeedbackSummary()

    wx.showToast({
      title: '已删除',
      icon: 'none'
    })
  },

  openTaskReview() {
    wx.setStorageSync('reviewFilter', {
      type: 'task',
      moduleId: this.data.moduleId,
      moduleTitle: this.data.moduleInfo && this.data.moduleInfo.title,
      day: this.data.day,
      contentId: this.data.contentId || (this.data.task && this.data.task.contentId) || '',
      taskTitle: getTaskDisplayTitle(this.data.task),
      createdAt: Date.now()
    })

    wx.switchTab({
      url: '/pages/review/review'
    })
  },

  stopAudioContext() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy()
    }
  },

  onShareAppMessage() {
    const task = this.data.task || {}
    const moduleId = this.data.moduleId || 'reading'
    const day = Number(task.day || this.data.day || 1)
    const contentId = task.contentId || this.data.contentId || ''
    return getDefaultShareMessage({
      title: `${getTaskDisplayTitle(task) || '口才训练'}｜来一起练表达`,
      path: `/pages/task-detail/task-detail?moduleId=${encodeURIComponent(moduleId)}&day=${day}${contentId ? `&contentId=${encodeURIComponent(contentId)}` : ''}`,
      pageType: 'training'
    })
  },

  onShareTimeline() {
    const task = this.data.task || {}
    const moduleId = this.data.moduleId || 'reading'
    const day = Number(task.day || this.data.day || 1)
    const contentId = task.contentId || this.data.contentId || ''
    return getDefaultShareTimeline({
      title: `${getTaskDisplayTitle(task) || '口才训练'}｜来一起练表达`,
      targetPage: 'task-detail',
      params: contentId ? { moduleId, day, contentId } : { moduleId, day },
      pageType: 'training'
    })
  },

  onHide() {
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
    if (this.audioPlayer) {
      this.audioPlayer.pause()
    }
  },

  onUnload() {
    this._isUnloaded = true
    this._contentLoadRevision = Number(this._contentLoadRevision || 0) + 1
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
    this.clearRecordingTimer()
    this.stopAudioContext()
  }
})
