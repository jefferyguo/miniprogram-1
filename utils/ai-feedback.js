const FEEDBACK_FUNCTION_NAME = 'generateTrainingFeedback'
const TRAINING_SUBMISSIONS_KEY = 'trainingSubmissions'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'
const DAILY_USAGE_KEY = 'aiFeedbackDailyUsage'
const DAILY_LIMIT = 5
const PER_WORK_LIMIT = 2

function pad(value) {
  return String(value).padStart(2, '0')
}

function getTodayText() {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return Math.max(Math.floor(duration), 0)
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
  return numberMatch ? Number(numberMatch[0]) : 0
}

function getAiMinRequiredSeconds(submission = {}) {
  const targetSeconds = Number(submission.targetSeconds || 0)

  if (targetSeconds > 0) {
    return Math.max(20, Math.floor(targetSeconds * 0.4))
  }

  return 30
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

function getDailyUsage() {
  const today = getTodayText()
  const usage = wx.getStorageSync(DAILY_USAGE_KEY) || {}

  if (usage.date !== today) {
    return {
      date: today,
      count: 0
    }
  }

  return {
    date: today,
    count: Number(usage.count || 0)
  }
}

function increaseDailyUsage() {
  const usage = getDailyUsage()
  const nextUsage = {
    date: usage.date,
    count: usage.count + 1
  }

  wx.setStorageSync(DAILY_USAGE_KEY, nextUsage)
  return nextUsage
}

function normalizeFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object') return null

  return {
    summary: feedback.summary || '',
    highlights: Array.isArray(feedback.highlights) ? feedback.highlights.slice(0, 2) : [],
    improvements: Array.isArray(feedback.improvements) ? feedback.improvements.slice(0, 2) : [],
    suggestions: Array.isArray(feedback.suggestions) ? feedback.suggestions.slice(0, 3) : [],
    score: Number(feedback.score || 0),
    level: feedback.level || ''
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

function buildFeedbackPayload(submission = {}, computed = {}) {
  const sourceType = submission.sourceType === 'extra' ? 'extra' : 'main'

  return {
    id: submission.id,
    sourceType,
    moduleTitle: submission.moduleTitle || submission.extraTitle || '',
    day: submission.day || '',
    taskTitle: submission.taskTitle || submission.extraTitle || '',
    requirement: submission.requirement || '',
    materialSummary: getMaterialSummary(submission),
    workType: submission.type || submission.workType || '',
    durationSeconds: computed.durationSeconds,
    targetSeconds: Number(submission.targetSeconds || 0),
    minRequiredSeconds: computed.minRequiredSeconds,
    createdAt: submission.createdAt || '',
    className: submission.className || ''
  }
}

function getFeedbackStatus(submission = {}) {
  const status = submission.aiFeedbackStatus
  if (['blocked', 'pending', 'done', 'error'].indexOf(status) > -1) return status
  if (submission.aiFeedbackError) return 'error'
  if (submission.aiFeedback) return 'done'
  return ''
}

function getFeedbackActionState(submission = {}) {
  const status = getFeedbackStatus(submission)

  if (status === 'blocked') {
    return {
      status,
      text: '时长不够',
      disabled: false,
      blocked: true,
      canGenerate: false,
      canView: false,
      className: 'feedback-blocked-btn'
    }
  }

  if (status === 'pending') {
    return {
      status,
      text: '生成中',
      disabled: true,
      canGenerate: false,
      canView: false,
      className: 'feedback-pending-btn'
    }
  }

  if (status === 'done') {
    return {
      status,
      text: '查看AI反馈',
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
    text: '生成AI反馈',
    disabled: false,
    canGenerate: true,
    canView: false,
    className: 'feedback-ai-btn'
  }
}

function buildFeedbackModalTitle() {
  return 'AI反馈'
}

function buildFeedbackModalContent(submission = {}) {
  if (getFeedbackStatus(submission) !== 'done' || !submission.aiFeedback) {
    return 'AI反馈尚未生成。'
  }

  const feedback = submission.aiFeedback
  const highlights = feedback.highlights || []
  const improvements = feedback.improvements || []
  const suggestions = feedback.suggestions || []

  return [
    `综合评价：${feedback.summary || '暂无'}`,
    `优点：\n${highlights.map((item, index) => `${index + 1}. ${item}`).join('\n') || '暂无'}`,
    `提升点：\n${improvements.map((item, index) => `${index + 1}. ${item}`).join('\n') || '暂无'}`,
    `训练建议：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n') || '暂无'}`,
    `综合分：${feedback.score || 0}`,
    `等级：${feedback.level || '暂无'}`,
    `反馈来源：${submission.aiFeedbackSource || 'cloudbase-ai'}`,
    `模型：${submission.aiFeedbackModel || 'qwen3.5-flash'}`
  ].join('\n\n')
}

function buildComputedFields(submission = {}) {
  const durationSeconds = parseDurationToSeconds(submission.durationSeconds || submission.duration)
  const minRequiredSeconds = getAiMinRequiredSeconds(submission)

  return {
    durationSeconds,
    minRequiredSeconds
  }
}

function markBlocked(storageKey, submission, computed) {
  const patch = {
    aiFeedbackStatus: 'blocked',
    aiFeedback: null,
    aiFeedbackBlockedReason: 'duration_too_short',
    aiFeedbackSource: 'none',
    aiFeedbackModel: 'none',
    aiFeedbackError: false,
    durationSeconds: computed.durationSeconds,
    minRequiredSeconds: computed.minRequiredSeconds
  }

  updateSubmissionFeedback(storageKey, submission.id, patch)

  return {
    status: 'blocked',
    blocked: true,
    ...patch
  }
}

function markError(storageKey, submission, message, patch = {}) {
  const nextPatch = {
    aiFeedbackStatus: 'error',
    aiFeedback: null,
    aiFeedbackError: true,
    aiFeedbackErrorMessage: message || 'AI反馈生成失败，请稍后重试',
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

function generateFeedbackForSubmission(submission = {}, options = {}) {
  const storageKey = options.storageKey || getSubmissionStorageKey(submission)
  const computed = buildComputedFields(submission)

  if (computed.durationSeconds < computed.minRequiredSeconds) {
    return Promise.resolve(markBlocked(storageKey, submission, computed))
  }

  const generateCount = Number(submission.aiFeedbackGenerateCount || 0)
  if (generateCount >= PER_WORK_LIMIT) {
    return Promise.resolve(markError(storageKey, submission, '本作品已达到 AI 反馈生成次数上限。', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: generateCount
    }))
  }

  const usage = getDailyUsage()
  if (usage.count >= DAILY_LIMIT) {
    return Promise.resolve(markError(storageKey, submission, '今日 AI 反馈次数已用完，明天可继续生成。', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: generateCount
    }))
  }

  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.resolve(markError(storageKey, submission, 'AI反馈生成失败，请稍后重试', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: generateCount
    }))
  }

  const nextGenerateCount = generateCount + 1

  updateSubmissionFeedback(storageKey, submission.id, {
    aiFeedbackStatus: 'pending',
    aiFeedback: null,
    aiFeedbackError: false,
    aiFeedbackErrorMessage: '',
    aiFeedbackSource: '',
    aiFeedbackModel: '',
    durationSeconds: computed.durationSeconds,
    minRequiredSeconds: computed.minRequiredSeconds,
    aiFeedbackGenerateCount: nextGenerateCount
  })
  increaseDailyUsage()

  return wx.cloud.callFunction({
    name: FEEDBACK_FUNCTION_NAME,
    data: {
      submission: buildFeedbackPayload(submission, computed)
    }
  }).then(res => {
    const result = res && res.result ? res.result : {}
    const feedback = normalizeFeedback(result.feedback)

    if (!result.success || !feedback) {
      return markError(storageKey, submission, 'AI反馈生成失败，请稍后重试', {
        durationSeconds: computed.durationSeconds,
        minRequiredSeconds: computed.minRequiredSeconds,
        aiFeedbackGenerateCount: nextGenerateCount
      })
    }

    const patch = {
      aiFeedbackStatus: 'done',
      aiFeedback: feedback,
      aiFeedbackSource: result.source || 'cloudbase-ai',
      aiFeedbackModel: result.model || 'qwen3.5-flash',
      aiFeedbackGeneratedAt: new Date().toISOString(),
      aiFeedbackError: false,
      aiFeedbackErrorMessage: '',
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: nextGenerateCount
    }

    updateSubmissionFeedback(storageKey, submission.id, patch)

    return {
      status: 'done',
      feedback,
      source: patch.aiFeedbackSource,
      model: patch.aiFeedbackModel
    }
  }).catch(error => {
    console.log('generateTrainingFeedback failed', error)
    return markError(storageKey, submission, 'AI反馈生成失败，请稍后重试', {
      durationSeconds: computed.durationSeconds,
      minRequiredSeconds: computed.minRequiredSeconds,
      aiFeedbackGenerateCount: nextGenerateCount
    })
  })
}

function requestTrainingFeedback({ storageKey, submission }) {
  return generateFeedbackForSubmission(submission, {
    storageKey
  })
}

module.exports = {
  TRAINING_SUBMISSIONS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  DAILY_USAGE_KEY,
  parseDurationToSeconds,
  getAiMinRequiredSeconds,
  getFeedbackActionState,
  getFeedbackStatus,
  getSubmissionStorageKey,
  buildFeedbackModalTitle,
  buildFeedbackModalContent,
  generateFeedbackForSubmission,
  requestTrainingFeedback,
  updateSubmissionFeedback
}
