const FEEDBACK_FUNCTION_NAME = 'generateTrainingFeedback'
const TRAINING_SUBMISSIONS_KEY = 'trainingSubmissions'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'
const {
  AI_DAILY_USAGE_KEY,
  canUseAi,
  recordAiUsage,
  showAiLimitModal
} = require('./ai-usage')
const { updateWorkAiFeedback } = require('./cloud-api')
const { uploadWorkFile } = require('./cloud-upload')

const TRANSCRIPT_FIELDS = [
  'transcript',
  'recognizedText',
  'speechText',
  'asrText',
  'asrResult',
  'transcription',
  'audioText',
  'recordText',
  'text'
]

const CLOUD_FILE_FIELDS = [
  'cloudFileID', 'fileID', 'fileId',
  'audioFileID', 'audioFileId',
  'videoFileID', 'videoFileId',
  'mediaFileID', 'mediaFileId'
]

const LOCAL_FILE_FIELDS = [
  'filePath', 'tempFilePath', 'audioPath',
  'recordPath', 'localPath', 'localFilePath'
]

const AUDIO_URL_FIELDS = [
  'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'recordingUrl'
]

function normalizeTranscript(submission = {}) {
  for (const field of TRANSCRIPT_FIELDS) {
    const value = String(submission[field] || '').trim()
    if (value && value.length >= 2) return value
  }
  return ''
}

function getFirstCloudFileID(submission = {}) {
  for (const field of CLOUD_FILE_FIELDS) {
    const value = String(submission[field] || '').trim()
    if (value && /^cloud:\/\//i.test(value)) return value
  }
  return ''
}

function getFirstLocalFilePath(submission = {}) {
  for (const field of LOCAL_FILE_FIELDS) {
    const value = String(submission[field] || '').trim()
    if (value) return value
  }
  return ''
}

function getFirstAudioUrl(submission = {}) {
  for (const field of AUDIO_URL_FIELDS) {
    const value = String(submission[field] || '').trim()
    if (value && /^https?:\/\//i.test(value) && !/^https?:\/\/(tmp|usr)\//i.test(value)) return value
  }
  return ''
}

function hasMediaFile(submission = {}) {
  return Boolean(
    getFirstCloudFileID(submission) ||
    getFirstLocalFilePath(submission) ||
    getFirstAudioUrl(submission)
  )
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function normalizeNumericDuration(value) {
  const duration = Number(value || 0)
  if (!Number.isFinite(duration) || duration <= 0) return 0

  // 录音/录像 API 有时返回毫秒，业务里展示和判断统一使用秒。
  return duration > 600 ? Math.max(Math.round(duration / 1000), 1) : Math.max(Math.floor(duration), 0)
}

function getTodayText() {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return normalizeNumericDuration(duration)
  if (!duration) return 0

  const text = String(duration).trim()
  if (!text) return 0

  const minuteSecondMatch = text.match(/(\d+)\s*分(?:钟)?\s*(\d+)?\s*秒?/)
  if (minuteSecondMatch) {
    const minutes = Number(minuteSecondMatch[1] || 0)
    const seconds = Number(minuteSecondMatch[2] || 0)
    return minutes * 60 + seconds
  }

  const secondMatch = text.match(/(\d+)\s*秒/)
  if (secondMatch) return Number(secondMatch[1] || 0)

  const colonMatch = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colonMatch) {
    return Number(colonMatch[1] || 0) * 60 + Number(colonMatch[2] || 0)
  }

  const numberMatch = text.match(/\d+/)
  return numberMatch ? normalizeNumericDuration(numberMatch[0]) : 0
}

function getAiMinRequiredSeconds() {
  return 0
}

function getFeedbackDurationSeconds(work = {}) {
  const candidates = [
    work.durationSeconds,
    work.duration,
    work.audioDuration,
    work.videoDuration,
    work.recordDuration,
    work.durationText,
    work.audioDurationText,
    work.videoDurationText,
    work.recordingSeconds
  ]

  for (let index = 0; index < candidates.length; index += 1) {
    const seconds = parseDurationToSeconds(candidates[index])
    if (seconds > 0) return seconds
  }

  return 0
}

function isAiFeedbackDurationTooShort(work = {}, computed) {
  return false
}

function getSubmissionStorageKey(submission = {}) {
  if (submission._storageKey) return submission._storageKey
  if (submission.sourceType === 'extra') return EXTRA_SUBMISSIONS_KEY
  if (submission.extraTitle || submission.extraType || submission.extraTraining) return EXTRA_SUBMISSIONS_KEY
  return TRAINING_SUBMISSIONS_KEY
}

function updateSubmissionFeedback(storageKey, id, patch) {
  if (!storageKey || id === undefined || id === null || id === '') return

  const list = wx.getStorageSync(storageKey) || []
  const nextList = list.map(item => (
    Number(item.id) === Number(id)
      ? {
        ...item,
        ...patch
      }
      : item
  ))

  wx.setStorageSync(storageKey, nextList)
}

function findSubmission(storageKey, id) {
  const list = wx.getStorageSync(storageKey) || []
  return list.find(item => String(item.id) === String(id)) || null
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForCloudMedia(storageKey, submission, timeoutMs = 10000) {
  const workType = submission.workType || submission.type || ''
  const hasCloudFile = submission.cloudFileID || submission.fileID
  const hasLocalMedia = submission.filePath || submission.tempFilePath || submission.audioPath || submission.recordPath

  if (!['audio', 'video'].includes(workType) || hasCloudFile || !hasLocalMedia) return submission

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await wait(500)
    const latest = findSubmission(storageKey, submission.id)
    if (latest && (latest.cloudFileID || latest.fileID)) {
      return {
        ...submission,
        ...latest
      }
    }
  }

  return submission
}

function toArray(value, max = 3) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n|；|;/)
      : value && Array.isArray(value.items)
        ? value.items
        : []

  return source
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max)
}

function clampScore(value) {
  const score = Math.round(Number(value || 0))
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, score))
}

function normalizeDimensionScores(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => ({
      name: String(item && item.name || '').trim(),
      score: clampScore(item && item.score),
      comment: String(item && item.comment || '').trim()
    }))
    .filter(item => item.name)
    .slice(0, 6)
}

function normalizeAbilityRadar(value) {
  const source = value && Array.isArray(value.dimensions) ? value.dimensions : []
  if (source.length < 5 || source.length > 6) return null

  const dimensions = source
    .map(item => ({
      name: String(item && item.name || '').trim().slice(0, 8),
      score: clampScore(item && item.score)
    }))
    .filter(item => item.name)

  return dimensions.length === source.length ? { dimensions } : null
}

function unwrapAiFeedback(feedback, meta = {}) {
  if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) return feedback
  const directKeys = ['summary', 'contentReview', 'content_review', 'voiceStateReview', 'voice_state_review', 'strengths', 'improvements', 'nextPractice', 'next_practice']
  if (directKeys.some(key => feedback[key] !== undefined && feedback[key] !== null)) return feedback

  const feedbackType = meta.feedbackType || meta.aiFeedbackType || feedback.feedbackType || ''
  const candidates = feedbackType === 'deep'
    ? [feedback.deep_feedback, feedback.deepFeedback, feedback.feedback, feedback.result, feedback.data]
    : [feedback.normal_feedback, feedback.normalFeedback, feedback.feedback, feedback.result, feedback.data, feedback.deep_feedback, feedback.deepFeedback]

  return candidates.find(item => typeof item === 'string' || (item && typeof item === 'object' && !Array.isArray(item))) || feedback
}

function getFeedbackMode(meta = {}, feedback = {}) {
  return meta.feedbackMode || meta.aiFeedbackMode || feedback.feedbackMode || 'metadata_only'
}

function getFeedbackVersion(meta = {}, feedback = {}) {
  return meta.feedbackVersion || meta.aiFeedbackVersion || feedback.feedbackVersion || 'v2'
}

function getModeNotice(feedbackMode) {
  if (feedbackMode === 'no_valid_speech') {
    return {
      noticeText: '未识别到有效表达内容，建议重新录制。',
      noticeClass: 'ai-mode-no-speech'
    }
  }

  if (feedbackMode === 'transcript_based') {
    return {
      noticeText: '已根据训练内容生成反馈。',
      noticeClass: 'ai-mode-transcript'
    }
  }

  if (feedbackMode === 'metadata_only') {
    return {
      noticeText: '本次反馈暂未分析真实语音内容，仅基于训练任务信息生成。',
      noticeClass: 'ai-mode-metadata'
    }
  }

  return {
    noticeText: '',
    noticeClass: ''
  }
}

function normalizeAiFeedback(feedback, meta = {}) {
  const normalizedSource = unwrapAiFeedback(feedback, meta)
  if (normalizedSource !== feedback) {
    return normalizeAiFeedback(normalizedSource, {
      ...meta,
      feedbackVersion: getFeedbackVersion(meta, feedback),
      feedbackMode: getFeedbackMode(meta, feedback)
    })
  }

  if (typeof feedback === 'string') {
    const text = feedback.trim()
    const notice = getModeNotice(getFeedbackMode(meta, {}))

    return {
      title: 'AI点评',
      summary: text,
      basis: text ? '这是旧版 AI 点评内容。' : '暂无 AI 点评内容。',
      contentReview: '',
      voiceStateReview: '',
      strengths: [],
      improvements: [],
      nextPractice: [],
      dimensionScores: [],
      abilityRadar: null,
      totalScore: 0,
      level: '',
      caution: '',
      teacherToneTip: '',
      feedbackVersion: 'legacy',
      feedbackMode: getFeedbackMode(meta, {}),
      ...notice
    }
  }

  if (!feedback || typeof feedback !== 'object') {
    const notice = getModeNotice(getFeedbackMode(meta, {}))

    return {
      title: 'AI点评',
      summary: '',
      basis: '',
      contentReview: '',
      voiceStateReview: '',
      strengths: [],
      improvements: [],
      nextPractice: [],
      dimensionScores: [],
      abilityRadar: null,
      totalScore: 0,
      level: '',
      caution: '',
      teacherToneTip: '',
      feedbackVersion: getFeedbackVersion(meta, {}),
      feedbackMode: getFeedbackMode(meta, {}),
      ...notice
    }
  }

  const summary = feedback.summary || feedback.overallReview || feedback.overall_review || feedback.evaluation || feedback.comment || ''
  const strengths = toArray(feedback.strengths || feedback.highlights || feedback.advantages, 3)
  const improvements = toArray(feedback.improvements || feedback.weaknesses || feedback.improvementPoints || feedback.improvement_points, 3)
  const nextPractice = toArray(feedback.nextPractice || feedback.next_practice || feedback.suggestions || feedback.trainingAdvice || feedback.training_advice, 3)
  const dimensionScores = normalizeDimensionScores(feedback.dimensionScores || feedback.dimension_scores)
  const abilityRadar = normalizeAbilityRadar(feedback.abilityRadar || feedback.ability_radar)
  const feedbackMode = getFeedbackMode(meta, feedback)
  const notice = getModeNotice(feedbackMode)

  return {
    title: feedback.title || 'AI点评',
    summary: String(summary || '').trim(),
    basis: feedback.basis || '',
    contentReview: feedback.contentReview || feedback.content_review || '',
    voiceStateReview: feedback.voiceStateReview || feedback.voice_state_review || feedback.voiceReview || feedback.voice_review || '',
    strengths,
    improvements,
    nextPractice,
    dimensionScores,
    abilityRadar,
    totalScore: clampScore(feedback.totalScore || feedback.total_score || feedback.score),
    level: feedback.level || '',
    caution: feedback.caution || '',
    teacherToneTip: feedback.teacherToneTip || feedback.encouragement || '',
    feedbackVersion: getFeedbackVersion(meta, feedback),
    feedbackMode,
    ...notice
  }
}

function getMaterialSummary(submission = {}) {
  const text = String(
    submission.materialSummary ||
    submission.content ||
    submission.promptText ||
    submission.requirement ||
    ''
  )

  return text.replace(/\s+/g, ' ').slice(0, 150)
}

function getMaterialText(submission = {}) {
  const text = String(
    submission.materialText ||
    submission.material ||
    submission.content ||
    submission.promptText ||
    submission.requirement ||
    ''
  )

  // 完整材料只供规则匹配，云函数不会把它整篇传给模型。
  return text.replace(/\s+/g, ' ').slice(0, 4000)
}

function buildFeedbackPayload(submission = {}, computed = {}) {
  const sourceType = submission.sourceType === 'extra' ? 'extra' : 'main'
  const cloudFileID = getFirstCloudFileID(submission)
  const localFilePath = getFirstLocalFilePath(submission)
  const audioUrl = getFirstAudioUrl(submission)
  const effectiveCloudFileID = cloudFileID || submission.fileID || submission.fileId || ''
  const effectiveAudioUrl = audioUrl || submission.audioUrl || submission.audioURL || ''
  const transcript = normalizeTranscript(submission)
  const originalText = String(
    submission.originalText ||
    submission.materialText ||
    submission.material ||
    submission.content ||
    submission.promptText ||
    submission.materialSummary ||
    ''
  ).trim()

  return {
    workId: submission.id,
    id: submission.id,
    sourceType,
    extraType: submission.extraType || '',
    moduleId: submission.moduleId || '',
    moduleType: submission.moduleType || submission.moduleId || '',
    category: submission.category || submission.moduleId || '',
    trainingType: submission.trainingType || submission.moduleType || submission.moduleId || '',
    contentId: submission.contentId || '',
    taskId: submission.taskId || submission.contentId || '',
    moduleTitle: submission.moduleTitle || submission.extraTitle || '',
    day: submission.day || '',
    taskTitle: submission.taskTitle || submission.extraTitle || '',
    contentTitle: submission.contentTitle || submission.taskTitle || submission.extraTitle || '',
    requirement: submission.requirement || '',
    materialSummary: getMaterialSummary(submission),
    materialText: getMaterialText(submission),
    originalText,
    workType: submission.type || submission.workType || '',
    durationSeconds: computed.durationSeconds,
    audioDuration: computed.durationSeconds,
    targetSeconds: Number(submission.targetSeconds || 0),
    minRequiredSeconds: computed.minRequiredSeconds,
    cloudFileID: effectiveCloudFileID,
    fileID: effectiveCloudFileID,
    filePath: localFilePath || submission.filePath || '',
    fileName: submission.fileName || '',
    fileSize: Object.prototype.hasOwnProperty.call(submission, 'fileSize') ? submission.fileSize : undefined,
    mimeType: submission.mimeType || '',
    traceId: submission.traceId || '',
    mediaInfo: submission.mediaInfo || null,
    tempFilePath: localFilePath || submission.tempFilePath || '',
    audioPath: submission.audioPath || '',
    recordPath: submission.recordPath || '',
    audioUrl: effectiveAudioUrl,
    audioFileID: submission.audioFileID || submission.audioFileId || effectiveCloudFileID || '',
    createdAt: submission.createdAt || '',
    submittedAt: submission.submittedAt || submission.createdAt || '',
    className: submission.className || '',
    hasTranscript: Boolean(transcript),
    transcript,
    recognizedText: transcript,
    speechText: transcript,
    asrText: transcript,
    text: transcript,
    audioAnalysis: submission.audioAnalysis || null
  }
}

function getFeedbackStatus(submission = {}) {
  const status = submission.aiFeedbackStatus
  if (status === 'blocked') return ''
  if (['pending', 'done', 'error'].indexOf(status) > -1) return status
  if (submission.aiFeedbackError) return 'error'
  if (submission.aiFeedback) return 'done'
  return ''
}

function getSuccessfulGenerateCount(submission = {}) {
  const rawCount = Number(submission.aiFeedbackGenerateCount || 0)

  // 旧版本曾在失败时提前增加成功次数；没有有效反馈时不把旧错误计为成功。
  if (getFeedbackStatus(submission) === 'done' && submission.aiFeedback) {
    return Math.max(rawCount, 1)
  }

  if (submission.aiFeedback) return rawCount

  return 0
}

function getFeedbackActionState(submission = {}) {
  const status = getFeedbackStatus(submission)

  if (status === 'pending') {
    return {
      status,
      text: '生成中...',
      disabled: true,
      canGenerate: false,
      canView: false,
      className: 'feedback-pending-btn'
    }
  }

  if (status === 'done') {
    return {
      status,
      text: '查看AI点评',
      disabled: false,
      canGenerate: false,
      canView: true,
      className: 'feedback-done-btn'
    }
  }

  if (status === 'error') {
    return {
      status,
      text: '重新生成',
      disabled: false,
      canGenerate: true,
      canView: false,
      className: 'feedback-error-btn'
    }
  }

  return {
    status: '',
    text: '生成AI点评',
    disabled: false,
    canGenerate: true,
    canView: false,
    className: 'feedback-ai-btn'
  }
}

function buildFeedbackModalTitle() {
  return 'AI点评'
}

function buildFeedbackModalContent(submission = {}) {
  if (getFeedbackStatus(submission) !== 'done' || !submission.aiFeedback) {
    return 'AI点评尚未生成。'
  }

  const feedback = normalizeAiFeedback(submission.aiFeedback, submission)
  const highlights = feedback.strengths || []
  const improvements = feedback.improvements || []
  const suggestions = feedback.nextPractice || []

  return [
    feedback.summary ? `综合评价：${feedback.summary}` : '',
    feedback.contentReview ? `内容表现：${feedback.contentReview}` : '',
    feedback.voiceStateReview ? `声音状态：${feedback.voiceStateReview}` : '',
    highlights.length ? `可以保留的做法：\n${highlights.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    improvements.length ? `下次提升重点：\n${improvements.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    suggestions.length ? `下一次训练动作：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n')
}

function buildComputedFields(submission = {}) {
  const durationSeconds = getFeedbackDurationSeconds(submission)
  const minRequiredSeconds = getAiMinRequiredSeconds()

  return {
    durationSeconds,
    minRequiredSeconds
  }
}

function markError(storageKey, submission, message, patch = {}) {
  const errorMessage = message || 'AI反馈生成失败，请稍后重试'
  const nextPatch = {
    aiFeedbackStatus: 'error',
    aiFeedback: null,
    aiFeedbackError: true,
    aiFeedbackLastError: errorMessage,
    aiFeedbackErrorMessage: errorMessage,
    aiFeedbackSource: 'none',
    aiFeedbackModel: 'none',
    ...patch
  }

  updateSubmissionFeedback(storageKey, submission.id, nextPatch)

  return {
    status: 'error',
    error: true,
    message: nextPatch.aiFeedbackErrorMessage,
    ...nextPatch
  }
}

async function generateFeedbackForSubmission(submission = {}, options = {}) {
  const storageKey = options.storageKey || getSubmissionStorageKey(submission)
  const computed = buildComputedFields(submission)
  const currentStatus = getFeedbackStatus(submission)

  console.log('[ai-feedback] start', {
    workId: submission.id,
    status: currentStatus,
    sourceType: submission.sourceType || 'main',
    durationSeconds: computed.durationSeconds,
    minRequiredSeconds: computed.minRequiredSeconds
  })

  if (currentStatus === 'done' && submission.aiFeedback) {
    return {
      status: 'done',
      feedback: submission.aiFeedback,
      source: submission.aiFeedbackSource || 'cloudbase-ai',
      model: submission.aiFeedbackModel || 'none'
    }
  }

  if (currentStatus === 'pending') {
    return {
      status: 'pending',
      message: 'AI点评正在生成中，请稍候。'
    }
  }

  const usage = await canUseAi('training_feedback')
  console.log('[ai-feedback] usage check', usage)
  if (!usage.allowed) {
    showAiLimitModal(usage)
    return {
      status: 'limit',
      limited: true,
      message: '今日 AI 次数已用完',
      ...usage
    }
  }

  const generateCount = getSuccessfulGenerateCount(submission)
  const attemptCount = Number(submission.aiFeedbackAttemptCount || 0)

  if (!wx.cloud || !wx.cloud.callFunction) {
    console.error('[ai-feedback] fail', 'wx.cloud.callFunction unavailable')
    return markError(storageKey, submission, 'AI反馈生成失败，请稍后重试', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: generateCount
    })
  }

  const nextAttemptCount = attemptCount + 1
  const activeSubmission = await waitForCloudMedia(storageKey, submission)
  const feedbackType = options.feedbackType === 'deep' || activeSubmission.feedbackType === 'deep'
    ? 'deep'
    : 'normal'

  let ensuredSubmission = activeSubmission
  if (!getFirstCloudFileID(ensuredSubmission) && getFirstLocalFilePath(ensuredSubmission)) {
    console.log('[ai-feedback] no cloud file, will upload local:', {
      workId: submission.id,
      localPath: getFirstLocalFilePath(ensuredSubmission)
    })
    try {
      wx.showLoading({ title: '上传作品...', mask: true })
      const uploadRes = await uploadWorkFile(
        getFirstLocalFilePath(ensuredSubmission),
        ensuredSubmission.type || ensuredSubmission.workType || 'audio',
        { traceId: ensuredSubmission.traceId || '', mimeType: ensuredSubmission.mimeType || '' }
      )
      const uploadedFileID = uploadRes && uploadRes.fileID ? String(uploadRes.fileID) : ''
      if (uploadedFileID) {
        console.log('[ai-feedback] local upload success:', { workId: submission.id, fileID: uploadedFileID })
        const uploadedFileSize = uploadRes.fileSize !== null && uploadRes.fileSize !== undefined
          ? uploadRes.fileSize
          : ensuredSubmission.fileSize
        ensuredSubmission = {
          ...ensuredSubmission,
          cloudFileID: uploadedFileID,
          fileID: uploadedFileID,
          fileSize: uploadedFileSize
        }
        updateSubmissionFeedback(storageKey, submission.id, {
          cloudFileID: uploadedFileID,
          fileID: uploadedFileID,
          fileSize: uploadedFileSize
        })
      }
    } catch (uploadErr) {
      console.warn('[ai-feedback] local upload failed:', uploadErr)
    } finally {
      wx.hideLoading()
    }
  }

  const payload = {
    ...buildFeedbackPayload(ensuredSubmission, computed),
    feedbackType
  }

  console.log('[ai-feedback] entering generating:', {
    workId: submission.id,
    feedbackType,
    hasCloudFileID: Boolean(payload.cloudFileID),
    hasFileID: Boolean(payload.fileID),
    hasAudioUrl: Boolean(payload.audioUrl),
    hasTranscript: Boolean(payload.transcript)
  })

  updateSubmissionFeedback(storageKey, submission.id, {
    aiFeedbackStatus: 'pending',
    aiFeedback: null,
    aiFeedbackError: false,
    aiFeedbackErrorMessage: '',
    aiFeedbackLastError: '',
    aiFeedbackSource: '',
    aiFeedbackModel: '',
    durationSeconds: computed.durationSeconds,
    minRequiredSeconds: computed.minRequiredSeconds,
    aiFeedbackGenerateCount: generateCount,
    aiFeedbackAttemptCount: nextAttemptCount
  })

  try {
    console.log('[ai-feedback] call generateTrainingFeedback', payload)
    const res = await wx.cloud.callFunction({
      name: FEEDBACK_FUNCTION_NAME,
      data: {
        submission: payload
      }
    })
    const result = res && res.result ? res.result : {}
    console.log('[ai-feedback] result:', {
      workId: submission.id,
      success: result.success === true,
      feedbackMode: result.feedbackMode || '',
      asrStatus: result.asrStatus || '',
      debugCode: result.debugCode || '',
      transcriptLength: Number(result.transcriptLength || 0),
      model: result.model || 'none'
    })
    const feedback = normalizeAiFeedback(result.feedback, {
      feedbackVersion: result.feedbackVersion,
      feedbackMode: result.feedbackMode
    })

    if (!result.success || !feedback || !result.feedback) {
      const code = result.code || ''
      const message = result.message || code || 'AI反馈生成失败，请稍后重试'
      console.error('[ai-feedback] fail', message, result)

      if (code === 'EMPTY_TRANSCRIPT') {
        return {
          status: 'empty_transcript',
          code,
          message,
          asrStatus: result.asrStatus || 'failed',
          debugCode: result.debugCode || 'ASR_EMPTY_RESULT',
          asrErrorMessage: result.asrErrorMessage || '',
          providerCode: result.providerCode || '',
          requestId: result.requestId || '',
          traceId: result.traceId || payload.traceId || '',
          canRetry: hasMediaFile(submission)
        }
      }

      return markError(storageKey, submission, message, {
        durationSeconds: computed.durationSeconds,
        minRequiredSeconds: computed.minRequiredSeconds,
        aiFeedbackGenerateCount: generateCount,
        aiFeedbackAttemptCount: nextAttemptCount,
        asrStatus: result.asrStatus || 'failed',
        asrDebugCode: result.debugCode || code || '',
        asrErrorMessage: result.asrErrorMessage || message,
        asrProviderCode: result.providerCode || '',
        asrRequestId: result.requestId || '',
        asrTraceId: result.traceId || payload.traceId || ''
      })
    }

    const shouldRecordAiUsage = result.source === 'cloudbase-ai'
    const nextGenerateCount = shouldRecordAiUsage ? generateCount + 1 : generateCount
    const patch = {
      aiFeedbackStatus: 'done',
      aiFeedback: feedback,
      aiFeedbackSource: result.source || 'none',
      aiFeedbackModel: result.model || 'none',
      feedbackVersion: result.feedbackVersion || 'v2',
      feedbackMode: result.feedbackMode || 'metadata_only',
      feedbackType: result.feedbackType || feedbackType,
      aiFeedbackVersion: result.feedbackVersion || 'v2',
      aiFeedbackMode: result.feedbackMode || 'metadata_only',
      transcript: result.transcript || '',
      recognizedText: result.recognizedText || result.transcript || result.speechText || result.asrText || '',
      speechText: result.speechText || result.transcript || result.recognizedText || result.asrText || '',
      asrText: result.asrText || result.transcript || result.recognizedText || result.speechText || '',
      hasTranscript: Boolean(result.hasTranscript || result.transcript || result.speechText || result.recognizedText || result.asrText),
      asrStatus: result.asrStatus || 'not_started',
      aiFeedbackDebugCode: result.debugCode || '',
      asrDebugCode: result.debugCode || '',
      asrErrorMessage: result.asrErrorMessage || '',
      transcriptLength: Number(result.transcriptLength || String(result.transcript || result.speechText || result.recognizedText || result.asrText || '').length),
      asrProvider: result.asrProvider || '',
      audioAnalysis: result.audioAnalysis || null,
      speechAnalysis: result.speechAnalysis || null,
      ruleAnalysis: result.ruleAnalysis || result.speechAnalysis || null,
      rawText: result.rawText || '',
      aiFeedbackRawText: result.rawText || '',
      aiFeedbackUsage: result.usage || null,
      tokenUsage: result.tokenUsage || result.usage || null,
      estimatedInputTokens: Number(result.estimatedInputTokens || 0),
      estimatedOutputTokens: Number(result.estimatedOutputTokens || 0),
      aiFeedbackGeneratedAt: new Date().toISOString(),
      aiFeedbackError: false,
      aiFeedbackErrorMessage: '',
      aiFeedbackLastError: '',
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: nextGenerateCount,
      aiFeedbackAttemptCount: nextAttemptCount
    }

    updateSubmissionFeedback(storageKey, submission.id, patch)
    const cloudId = activeSubmission.cloudId || activeSubmission._id || ''
    if (cloudId) {
      updateWorkAiFeedback(cloudId, patch).catch(error => {
        console.warn('[ai-feedback] 云端 AI 点评同步失败，本地结果已保留:', error)
      })
    }
    if (shouldRecordAiUsage) {
      await recordAiUsage('training_feedback', {
        workId: submission.id,
        storageKey,
        feedbackType: patch.feedbackType,
        model: patch.aiFeedbackModel,
        source: patch.aiFeedbackSource,
        tokenUsage: patch.tokenUsage,
        estimatedInputTokens: patch.estimatedInputTokens,
        estimatedOutputTokens: patch.estimatedOutputTokens,
        asrDurationSeconds: Number((patch.audioAnalysis && patch.audioAnalysis.durationSeconds) || computed.durationSeconds || 0)
      })
    }

    console.log('[ai-feedback] success:', {
      workId: submission.id,
      feedbackMode: patch.aiFeedbackMode,
      asrStatus: patch.asrStatus,
      model: patch.aiFeedbackModel
    })

    return {
      status: 'done',
      feedback,
      source: patch.aiFeedbackSource,
      model: patch.aiFeedbackModel,
      feedbackVersion: patch.aiFeedbackVersion,
      feedbackMode: patch.aiFeedbackMode,
      asrStatus: patch.asrStatus
    }
  } catch (error) {
    console.error('[ai-feedback] fail', error)
    return markError(storageKey, submission, error.message || 'AI反馈生成失败，请稍后重试', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: generateCount,
      aiFeedbackAttemptCount: nextAttemptCount
    })
  }
}

function requestTrainingFeedback({ storageKey, submission }) {
  return generateFeedbackForSubmission(submission, {
    storageKey
  })
}

module.exports = {
  TRAINING_SUBMISSIONS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  DAILY_USAGE_KEY: AI_DAILY_USAGE_KEY,
  normalizeTranscript,
  getFirstCloudFileID,
  getFirstLocalFilePath,
  getFirstAudioUrl,
  hasMediaFile,
  parseDurationToSeconds,
  getAiMinRequiredSeconds,
  getFeedbackDurationSeconds,
  isAiFeedbackDurationTooShort,
  getFeedbackActionState,
  getFeedbackStatus,
  getSubmissionStorageKey,
  buildFeedbackModalTitle,
  buildFeedbackModalContent,
  normalizeAiFeedback,
  normalizeAbilityRadar,
  generateFeedbackForSubmission,
  requestTrainingFeedback,
  updateSubmissionFeedback
}
