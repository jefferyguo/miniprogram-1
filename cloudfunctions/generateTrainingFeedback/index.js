const cloud = require('wx-server-sdk')
const AI_MODEL = process.env.CLOUDBASE_AI_MODEL || 'hy3-preview'
const NORMAL_AI_MODEL = AI_MODEL
const DEEP_AI_MODEL = AI_MODEL
const { analyzeSpeechForTraining } = require('./speech-analysis')
const {
  sanitizeDurationEvaluationText,
  sanitizeDurationEvaluationList
} = require('./duration-feedback-policy')
const VIDEO_ASR_FUNCTION_TIMEOUT_MS = 300000
// 父函数还需解析识别结果并生成点评，子调用须早于父函数执行上限结束。
const VIDEO_ASR_CALL_TIMEOUT_MS = 280000

// 平台执行时限仍需在云开发控制台手动设置为 300 秒。
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: VIDEO_ASR_FUNCTION_TIMEOUT_MS
})

const db = cloud.database()

async function hasBoundPhone() {
  try {
    const openid = cloud.getWXContext().OPENID || ''
    if (!openid) return false
    const res = await db.collection('users').where({ openid, phoneBound: true }).limit(1).get()
    const user = res.data && res.data[0]
    return Boolean(user && /^1\d{10}$/.test(String(user.phone || '')))
  } catch (error) {
    console.warn('[generateTrainingFeedback] phone binding check failed:', error.message)
    return false
  }
}

function toText(value, fallback = '') {
  return String(value || fallback).trim()
}

function firstText(...values) {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ''
}

function getSubmissionTranscript(submission = {}) {
  return firstText(
    submission.transcript,
    submission.recognizedText,
    submission.speechText,
    submission.asrText,
    submission.asrResult,
    submission.transcription,
    submission.audioText,
    submission.recordText,
    submission.text
  )
}

function getOriginalText(submission = {}) {
  return firstText(
    submission.originalText,
    submission.materialText,
    submission.material,
    submission.content,
    submission.promptText,
    submission.materialSummary
  )
}

function toList(value, max = 3) {
  if (!Array.isArray(value)) return []

  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max)
}

const METADATA_ONLY_FORBIDDEN_PATTERNS = [
  /声音.{0,6}(清晰|清楚|稳定|洪亮|饱满)/,
  /发音.{0,6}(准确|标准|清晰|清楚)/,
  /语速.{0,6}(稳定|自然|适中)/,
  /停顿.{0,6}(自然|准确|合理)/,
  /情绪.{0,6}(饱满|到位)/,
  /内容.{0,6}(完整|充实|准确)/,
  /完整.{0,6}(朗读|覆盖|表达)/,
  /听得出/,
  /能听到/
]

const EVALUATION_STANDARDS = {
  reading: {
    label: '朗读',
    dimensions: ['字音清晰度', '声音状态', '停连节奏', '情感表达']
  },
  retelling: {
    label: '复述',
    dimensions: ['复述表达能力', '重点提取能力', '语言组织能力', '表达流畅度']
  },
  topic: {
    label: '即兴话题',
    dimensions: ['观点明确度', '内容展开能力', '逻辑结构', '语言流畅度']
  },
  mandarin: {
    label: '普通话',
    dimensions: ['声母准确度', '韵母准确度', '声调准确度', '语流音变', '吐字归音', '朗读自然度']
  },
  speech: {
    label: '演讲',
    dimensions: ['观点聚焦度', '结构推进', '节奏与停顿', '情绪感染力', '说服表达']
  },
  leaderSpeech: {
    label: '领导发言',
    dimensions: ['立意与主题', '结构层次', '重点突出度', '语言稳重度', '现场带动感']
  }
}

const EVALUATION_FOCUS = {
  reading: '重点结合内容完整度、字词清楚程度、语句连贯、重音停顿、情绪投入、文字理解和文章氛围来评价。',
  retelling: '重点结合核心信息完整度、逻辑顺序、重要内容遗漏、是否能用自己的语言组织，以及开头和结尾是否完整来评价。',
  topic: '重点结合观点明确度、结构完整度、内容展开、具体例子、重复情况、结尾完整度和交流感来评价。',
  mandarin: '重点结合本次训练内容中的字词表达、语句清楚程度、语速和停连来评价；没有精细发音评测数据时，不判断具体声母、韵母或声调准确度。',
  speech: '重点结合主题观点、开头吸引力、结构推进、事例与画面、情绪感染方向和结尾力量来评价。',
  leaderSpeech: '重点结合立场清晰度、表达稳重度、逻辑层次、措辞分寸、总结号召作用，以及温度与权威感来评价。'
}

const ABILITY_RADAR_DIMENSIONS = ['流畅度', '逻辑性', '表达感染力', '完整度', '说服力']

const ABILITY_RADAR_KEYWORDS = {
  '流畅度': ['流畅', '语速', '停连', '节奏', '自然'],
  '逻辑性': ['逻辑', '结构', '层次', '组织', '重点提取'],
  '表达感染力': ['感染', '情感', '情绪', '表现力', '声音状态', '带动'],
  '完整度': ['完整', '内容展开', '信息', '重点', '立意'],
  '说服力': ['说服', '观点', '影响', '聚焦', '号召']
}

function getEvaluationType(submission = {}) {
  const moduleId = String(submission.moduleId || submission.category || submission.moduleType || '').trim().toLowerCase()
  const extraType = String(submission.extraType || '').trim()
  const titleText = `${submission.moduleTitle || ''} ${submission.extraTitle || ''} ${submission.contentTitle || ''} ${submission.taskTitle || ''} ${submission.title || ''}`

  if (moduleId === 'leaderspeech' || moduleId === 'leader_speech' || /领导发言|讲话稿|致辞|署名文章/.test(titleText)) return 'leaderSpeech'
  if (moduleId === 'speech' || /演讲/.test(titleText)) return 'speech'
  if (moduleId === 'retell' || moduleId === 'retelling' || /复述/.test(titleText)) return 'retelling'
  if (moduleId === 'topic' || extraType === 'randomTopic' || /话题|即兴/.test(titleText)) return 'topic'
  if (moduleId === 'mandarin' || extraType === 'tongueTwister' || /普通话|绕口令/.test(titleText)) return 'mandarin'
  return 'reading'
}

function getLevelByScore(score) {
  const value = Number(score || 0)
  if (value >= 90) return 'S级 表现优秀'
  if (value >= 80) return 'A级 表现良好'
  if (value >= 70) return 'B级 基本完成'
  return 'C级 继续加油'
}

function clampScore(value) {
  const score = Math.round(Number(value || 0))
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, score))
}

function normalizeDimensionScores(feedback = {}, speechContext = {}) {
  const dimensions = speechContext.evaluationDimensions || EVALUATION_STANDARDS.reading.dimensions
  const source = Array.isArray(feedback.dimensionScores) ? feedback.dimensionScores : []
  return dimensions.map((name, index) => {
    const raw = source.find(item => String(item && item.name || '').trim() === name) || source[index] || {}
    let score = clampScore(raw.score)
    let comment = toText(raw.comment)

    if (speechContext.feedbackMode === 'no_valid_speech') {
      score = 0
      comment = '未识别到有效表达内容，建议重新录制后再判断该维度。'
    } else if (speechContext.feedbackMode === 'metadata_only') {
      if (!comment || hasForbiddenMetadataClaim(comment)) {
        comment = '暂未分析真实语音内容，此维度仅作为训练方向参考。'
      }
    } else if (!comment) {
      comment = '可结合本次训练内容继续优化。'
    }

    return {
      name,
      score,
      comment: comment.slice(0, 72)
    }
  })
}

function normalizeAbilityRadar(value) {
  const source = value && Array.isArray(value.dimensions) ? value.dimensions : []
  if (source.length < 5 || source.length > 6) return null

  const dimensions = source
    .map((item, index) => ({
      name: source.length === 5
        ? ABILITY_RADAR_DIMENSIONS[index]
        : toText(item && item.name).slice(0, 8),
      score: clampScore(item && item.score)
    }))
    .filter(item => item.name)

  return dimensions.length === source.length ? { dimensions } : null
}

function buildAbilityRadarFallback(feedback = {}, speechContext = {}) {
  const dimensionScores = Array.isArray(feedback.dimensionScores) ? feedback.dimensionScores : []
  const positiveScores = dimensionScores
    .map(item => clampScore(item && item.score))
    .filter(score => score > 0)
  const ruleScore = clampScore(speechContext.speechAnalysis && speechContext.speechAnalysis.overallRuleScore)
  const totalScore = clampScore(feedback.totalScore || feedback.score)
  const averageScore = positiveScores.length
    ? Math.round(positiveScores.reduce((sum, score) => sum + score, 0) / positiveScores.length)
    : 0
  const baseScore = totalScore || averageScore || ruleScore

  if (!baseScore) return null

  const dimensions = ABILITY_RADAR_DIMENSIONS.map(name => {
    const keywords = ABILITY_RADAR_KEYWORDS[name]
    const matchedScores = dimensionScores
      .filter(item => keywords.some(keyword => toText(item && item.name).includes(keyword)))
      .map(item => clampScore(item && item.score))
      .filter(score => score > 0)
    const score = matchedScores.length
      ? Math.round(matchedScores.reduce((sum, item) => sum + item, 0) / matchedScores.length)
      : baseScore

    return { name, score: clampScore(score) }
  })

  return { dimensions }
}

function hasForbiddenMetadataClaim(text) {
  return METADATA_ONLY_FORBIDDEN_PATTERNS.some(pattern => pattern.test(String(text || '')))
}

function sanitizeMetadataOnlyList(list, fallbackList) {
  const nextList = list.filter(item => !hasForbiddenMetadataClaim(item))
  return nextList.length ? nextList : fallbackList
}

function getTranscribeFailureCode(error = {}) {
  const code = String(error.code || error.errCode || error.name || '')
  const message = String(error.message || '')
  const text = `${code} ${message}`.toLowerCase()
  if (text.includes('timeout') || text.includes('timed out')) return 'ASR_TIMEOUT'
  if (text.includes('authfailure') || text.includes('unauthorized')) return 'AuthFailure'
  return code || 'TRANSCRIBE_FUNCTION_FAILED'
}

function createParseFallback(rawText, feedbackMode) {
  if (feedbackMode === 'no_valid_speech') {
    return {
      title: 'AI点评',
      summary: '本次未识别到有效表达内容，建议重新录制。',
      basis: '系统尝试识别语音内容，但没有得到足够可用于点评的表达文本。',
      contentReview: '暂无法判断内容是否围绕任务展开。',
      voiceStateReview: '暂无法判断声音状态。',
      strengths: [],
      improvements: ['重新录制时，开始后尽快朗读或表达，不要长时间空录。'],
      nextPractice: ['确认麦克风可用，保持适当距离，再完整录制一遍。'],
      totalScore: 0,
      level: 'C级 继续加油',
      dimensionScores: [],
      caution: '如果本次录音中没有实际朗读，请重新录制后再生成反馈。',
      teacherToneTip: rawText ? '反馈原文已保存，便于后续排查。' : ''
    }
  }

  return {
    title: 'AI点评',
    summary: '本次反馈已生成，但格式解析不完整。',
    basis: feedbackMode === 'metadata_only'
      ? '本次点评基于训练任务和作品信息生成。'
      : '本次点评基于训练任务、作品信息和训练内容生成。',
    contentReview: '',
    voiceStateReview: '',
    strengths: [],
    improvements: ['请重新生成一次，或稍后再试。'],
    nextPractice: [],
    totalScore: 0,
    level: 'C级 继续加油',
    dimensionScores: [],
    caution: '当前反馈格式解析不完整，请以实际训练体验为准。',
    teacherToneTip: rawText ? '反馈原文已保存，便于后续排查。' : ''
  }
}

function normalizeFeedback(feedback, speechContext) {
  if (!feedback || typeof feedback !== 'object') return null

  const feedbackMode = speechContext.feedbackMode
  const summary = toText(feedback.summary, '本次作品已提交，可以作为一次训练记录。')
  const defaultBasis = feedbackMode === 'metadata_only'
    ? '本次点评基于训练任务和提交信息生成，暂未分析真实语音内容。'
    : feedbackMode === 'no_valid_speech'
      ? '系统尝试识别语音内容，但没有得到足够可用于点评的表达文本。'
      : '本次点评基于训练任务、训练内容和基础表达分析生成。'
  const defaultCaution = feedbackMode === 'metadata_only'
    ? '当前系统暂未识别真实语音内容。如果本次录音中没有实际朗读，请重新录制后再生成反馈。'
    : feedbackMode === 'no_valid_speech'
      ? '请确认麦克风正常，录制开始后直接朗读或表达，录完后先回听一次。'
      : ''

  const normalized = {
    title: toText(feedback.title, 'AI点评') || 'AI点评',
    summary,
    basis: toText(feedback.basis, defaultBasis),
    contentReview: toText(feedback.contentReview),
    voiceStateReview: toText(feedback.voiceStateReview),
    strengths: toList(feedback.strengths, 3),
    improvements: toList(feedback.improvements, 3),
    nextPractice: toList(feedback.nextPractice, 3),
    dimensionScores: normalizeDimensionScores(feedback, speechContext),
    abilityRadar: null,
    totalScore: clampScore(feedback.totalScore || feedback.score),
    level: toText(feedback.level),
    caution: toText(feedback.caution, defaultCaution),
    teacherToneTip: toText(feedback.teacherToneTip || feedback.encouragement),
    encouragement: toText(feedback.encouragement || feedback.teacherToneTip)
  }

  normalized.summary = sanitizeDurationEvaluationText(normalized.summary, '本次训练已完成，可以继续围绕内容组织和表达方式进行复盘。')
  normalized.basis = sanitizeDurationEvaluationText(normalized.basis, defaultBasis)
  normalized.contentReview = sanitizeDurationEvaluationText(normalized.contentReview)
  normalized.voiceStateReview = sanitizeDurationEvaluationText(normalized.voiceStateReview)
  normalized.strengths = sanitizeDurationEvaluationList(normalized.strengths)
  normalized.improvements = sanitizeDurationEvaluationList(normalized.improvements, ['下一次可以继续围绕内容重点和结构衔接做针对性练习。'])
  normalized.nextPractice = sanitizeDurationEvaluationList(normalized.nextPractice, ['选择一个具体内容问题进行复练，并在回听时检查是否真正改进。'])
  normalized.caution = sanitizeDurationEvaluationText(normalized.caution, defaultCaution)
  normalized.teacherToneTip = sanitizeDurationEvaluationText(normalized.teacherToneTip)
  normalized.encouragement = sanitizeDurationEvaluationText(normalized.encouragement)
  normalized.dimensionScores = normalized.dimensionScores.map(item => ({
    ...item,
    comment: sanitizeDurationEvaluationText(item.comment, '请结合本次实际表达内容继续优化。')
  }))

  if (!normalized.totalScore && normalized.dimensionScores.length) {
    normalized.totalScore = Math.round(
      normalized.dimensionScores.reduce((sum, item) => sum + Number(item.score || 0), 0) / normalized.dimensionScores.length
    )
  }
  normalized.level = normalized.level || getLevelByScore(normalized.totalScore)
  normalized.abilityRadar = normalizeAbilityRadar(feedback.abilityRadar || feedback.ability_radar)
    || buildAbilityRadarFallback(normalized, speechContext)

  if (feedbackMode === 'metadata_only') {
    if (hasForbiddenMetadataClaim(normalized.summary)) {
      normalized.summary = '本次作品已完成提交，可以作为一次训练记录。'
    }

    normalized.basis = defaultBasis
    normalized.contentReview = normalized.contentReview || '暂未分析真实语音内容，不能判断内容完整度和材料匹配度。'
    normalized.voiceStateReview = '当前没有音量、音色或发音评测数据，不对声音质量作结论。'
    normalized.strengths = sanitizeMetadataOnlyList(normalized.strengths, [
      '完成了一次训练提交，说明你已经开始建立表达练习习惯。'
    ])
    normalized.improvements = sanitizeMetadataOnlyList(normalized.improvements, [
      '下次录制时，请确保全程真实朗读，不要空录或长时间停顿。',
      '朗读时可以放慢语速，在句号、逗号处自然停顿。'
    ])
    normalized.nextPractice = sanitizeMetadataOnlyList(normalized.nextPractice, [
      '重新录制一遍，目标是完整读完材料。',
      '录完后先自己回听一次，检查有没有漏读、卡顿或无声。'
    ])
    normalized.caution = defaultCaution
  }

  if (feedbackMode === 'no_valid_speech') {
    normalized.summary = '本次未识别到有效表达内容，建议重新录制。'
    normalized.basis = defaultBasis
    normalized.contentReview = '暂无法判断是否围绕题目或材料完成表达。'
    normalized.voiceStateReview = '未识别到有效表达，请先检查麦克风和录制距离。'
    normalized.strengths = []
    normalized.improvements = normalized.improvements.length ? normalized.improvements : [
      '开始录制后尽快朗读或表达，避免长时间空录。',
      '保持手机和嘴部适当距离，尽量在安静环境中完成。'
    ]
    normalized.nextPractice = normalized.nextPractice.length ? normalized.nextPractice : [
      '重新录制一遍，先慢一点读清楚，再提交作品。',
      '录完后先回听确认有声音和完整表达。'
    ]
    normalized.dimensionScores = normalizeDimensionScores(feedback, speechContext)
    normalized.totalScore = 0
    normalized.level = 'C级 继续加油'
    normalized.caution = defaultCaution
  }

  return normalized
}

async function tryTranscribeAudio(submission) {
  const cloudFileID = submission.cloudFileID || submission.fileID || submission.fileId || submission.audioFileID || submission.audioFileId || ''
  const audioUrl = submission.audioUrl || submission.audioURL || submission.audioFileUrl || submission.audioFileURL || ''
  const workType = submission.workType || submission.type || ''
  const traceId = String(submission.traceId || `video_asr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  const isSupportedMediaType = workType === 'audio' || workType === 'video'

  if (!isSupportedMediaType || (!cloudFileID && !audioUrl)) {
    return {
      success: false,
      hasTranscript: false,
      transcript: '',
      asrStatus: 'not_started',
      asrProvider: '',
      message: isSupportedMediaType ? '没有可识别的云端媒体文件或文件地址' : '该作品类型暂不支持训练内容识别',
      debugCode: isSupportedMediaType ? 'ASR_NO_FILE' : 'ASR_UNSUPPORTED_SOURCE_TYPE'
    }
  }

  try {
    console.log('[generateTrainingFeedback] will call ASR:', {
      workId: submission.workId || submission.id || '',
      hasCloudFileID: Boolean(cloudFileID),
      hasAudioUrl: Boolean(audioUrl),
      durationSeconds: Number(submission.durationSeconds || 0)
    })
    if (workType === 'video') {
      console.log(`[VIDEO_ASR][${traceId}][request]`, {
        caller: 'generateTrainingFeedback',
        hasCloudFileID: Boolean(cloudFileID),
        durationSeconds: Number(submission.durationSeconds || 0),
        fileSize: submission.fileSize == null ? null : Number(submission.fileSize),
        mimeType: submission.mimeType || '',
        fileName: submission.fileName || ''
      })
    }
    const res = await cloud.callFunction(
      {
        name: 'transcribeAudio',
        data: {
          cloudFileID,
          fileID: cloudFileID,
          audioFileID: submission.audioFileID || submission.audioFileId || '',
          audioUrl,
          workId: submission.workId || submission.id || '',
          durationSeconds: submission.durationSeconds || 0,
          sourceType: workType,
          workType,
          fileSize: submission.fileSize,
          mimeType: submission.mimeType || '',
          filePath: submission.filePath || submission.tempFilePath || submission.audioPath || '',
          fileName: submission.fileName || '',
          traceId
        }
      },
      {
        timeout: VIDEO_ASR_CALL_TIMEOUT_MS
      }
    )
    const result = res && res.result ? res.result : {}

    console.log('[generateTrainingFeedback] transcribeAudio result:', {
      success: result.success === true,
      asrStatus: result.success ? 'success' : (result.debugCode === 'ASR_NOT_CONFIGURED' ? 'not_configured' : 'failed'),
      debugCode: result.debugCode || '',
      message: result.message || '',
      transcriptLength: String(result.transcript || result.asrText || '').trim().length
    })
    if (workType === 'video') {
      console.log(`[VIDEO_ASR][${traceId}][response]`, {
        success: result.success === true,
        asrStatus: result.asrStatus || '',
        debugCode: result.debugCode || '',
        providerCode: result.providerCode || '',
        requestId: result.requestId || '',
        transcriptLength: String(result.transcript || result.asrText || '').trim().length,
        mediaInfo: result.mediaInfo || null
      })
    }

    if (result.success) {
      return {
        ...result,
        asrStatus: 'success',
        asrProvider: result.asrProvider || 'tencent-cloud-asr'
      }
    }

    return {
      ...result,
      success: false,
      hasTranscript: false,
      transcript: '',
      asrStatus: result.debugCode === 'ASR_NOT_CONFIGURED' ? 'not_configured' : 'failed',
      asrProvider: result.asrProvider || 'tencent-cloud-asr',
      message: result.message || '训练内容暂未识别'
    }
  } catch (error) {
    console.warn('[generateTrainingFeedback] transcribeAudio failed:', error)
    return {
      success: false,
      hasTranscript: false,
      transcript: '',
      asrStatus: 'failed',
      asrProvider: 'tencent-cloud-asr',
      message: error.message || '训练内容暂未识别',
      debugCode: getTranscribeFailureCode(error),
      rawError: error
    }
  }
}

async function prepareSpeechContext(submission) {
  let transcript = getSubmissionTranscript(submission)
  let asrStatus = transcript ? 'success' : 'not_started'
  let asrErrorMessage = ''
  let asrProvider = transcript ? (submission.asrProvider || 'provided') : ''
  let audioAnalysis = submission.audioAnalysis || null
  let debugCode = ''
  let providerCode = ''
  let requestId = ''
  let traceId = ''
  const originalText = getOriginalText(submission)

  if (!transcript && ['audio', 'video'].includes(submission.workType || submission.type)) {
    const asrResult = await tryTranscribeAudio(submission)
    transcript = getSubmissionTranscript(asrResult)
    asrStatus = asrResult.asrStatus || (transcript ? 'success' : 'failed')
    asrErrorMessage = asrResult.success ? '' : (asrResult.asrErrorMessage || asrResult.message || '')
    asrProvider = asrResult.asrProvider || ''
    audioAnalysis = asrResult.audioAnalysis || audioAnalysis
    debugCode = asrResult.debugCode || ''
    providerCode = asrResult.providerCode || ''
    requestId = asrResult.requestId || ''
    traceId = asrResult.traceId || ''
  }

  const speechAnalysis = analyzeSpeechForTraining({
    transcript,
    materialText: originalText,
    materialSummary: submission.materialSummary || '',
    taskTitle: submission.contentTitle || submission.taskTitle || '',
    moduleId: submission.moduleId || '',
    moduleTitle: submission.moduleTitle || submission.extraTitle || '',
    sourceType: submission.sourceType || '',
    extraType: submission.extraType || '',
    workType: submission.workType || submission.type || ''
  })
  let feedbackMode = 'metadata_only'
  const evaluationType = getEvaluationType(submission)
  const evaluationStandard = EVALUATION_STANDARDS[evaluationType] || EVALUATION_STANDARDS.reading

  if (transcript) {
    feedbackMode = speechAnalysis.possibleEmptyRecording ? 'no_valid_speech' : 'transcript_based'
    if (speechAnalysis.possibleEmptyRecording && !debugCode) debugCode = 'ASR_RESULT_FILTERED'
  } else {
    feedbackMode = 'no_valid_speech'
  }

  return {
    transcript,
    hasTranscript: Boolean(transcript),
    asrStatus,
    asrErrorMessage,
    asrProvider,
    debugCode,
    providerCode,
    requestId,
    traceId,
    transcriptLength: transcript.length,
    originalText,
    originalTextLength: originalText.length,
    audioAnalysis,
    speechAnalysis,
    feedbackMode,
    evaluationType,
    evaluationLabel: evaluationStandard.label,
    evaluationDimensions: evaluationStandard.dimensions
  }
}

function truncateTranscript(transcript, feedbackType) {
  const text = String(transcript || '').trim()
  const maxLength = feedbackType === 'deep' ? 1200 : 300

  if (text.length <= maxLength) return text
  if (feedbackType === 'deep') return `${text.slice(0, 800)}…${text.slice(-400)}`
  return `${text.slice(0, 200)}…${text.slice(-100)}`
}

function truncateOriginalText(originalText, feedbackType) {
  const text = String(originalText || '').trim()
  const maxLength = feedbackType === 'deep' ? 1200 : 420
  if (text.length <= maxLength) return text
  if (feedbackType === 'deep') return `${text.slice(0, 800)}…${text.slice(-400)}`
  return `${text.slice(0, 280)}…${text.slice(-140)}`
}

function getCompactRuleAnalysis(analysis = {}) {
  return {
    contentMatchScore: analysis.contentMatchScore,
    contentMatchLevel: analysis.contentMatchLevel || 'unknown',
    repetitionRiskLevel: analysis.repetitionRiskLevel || 'unknown',
    structureLevel: analysis.structureLevel || 'unknown',
    possibleEmptyRecording: Boolean(analysis.possibleEmptyRecording),
    possibleOffTopic: Boolean(analysis.possibleOffTopic),
    possibleIncomplete: Boolean(analysis.possibleIncomplete),
    overallRuleScore: Number(analysis.overallRuleScore || 0)
  }
}

function buildPrompt(submission, speechContext, feedbackType) {
  const isDeep = feedbackType === 'deep'
  const analysis = speechContext.speechAnalysis || {}
  const promptData = {
    feedbackType,
    feedbackMode: speechContext.feedbackMode,
    moduleTitle: submission.moduleTitle || submission.extraTitle || '',
    taskTitle: submission.contentTitle || submission.taskTitle || '',
    workType: submission.workType === 'video' ? '视频' : '音频',
    transcript: truncateTranscript(speechContext.transcript, feedbackType) || '无',
    transcriptLength: speechContext.transcriptLength,
    originalText: truncateOriginalText(speechContext.originalText, feedbackType) || '无',
    originalTextLength: speechContext.originalTextLength,
    ruleSummary: analysis.ruleSummary || '',
    ruleTags: Array.isArray(analysis.ruleTags) ? analysis.ruleTags.slice(0, 6) : [],
    metrics: isDeep
      ? getCompactRuleAnalysis(analysis)
      : {
        contentMatchLevel: analysis.contentMatchLevel || 'unknown',
        structureLevel: analysis.structureLevel || 'unknown',
        possibleEmptyRecording: Boolean(analysis.possibleEmptyRecording)
      },
    evaluationType: speechContext.evaluationType,
    evaluationLabel: speechContext.evaluationLabel,
    evaluationDimensions: speechContext.evaluationDimensions,
    evaluationFocus: EVALUATION_FOCUS[speechContext.evaluationType] || EVALUATION_FOCUS.reading
  }
  if (isDeep) {
    promptData.materialSummary = String(submission.materialSummary || '').slice(0, 300)
  }
  const detailRule = isDeep
    ? '可结合训练内容和规则指标做更细的结构分析，但仍不能超出已有数据做判断'
    : '基于训练内容和规则指标给出完整但克制的训练点评'

  return `你是一位有20年一线经验的口才与演讲教练，正在为“杨勤口才训练KEEP”的学员点评作品。${detailRule}。
要求：
0. 【最高优先级】不得评价、引用或推断用户作品总时长，不得判断作品过长或过短，不得建议压缩、缩短、延长或控制到任何秒数/分钟数。输入中的媒体时长属于技术元数据，不参与任何评分、标签、综合评价或改进建议；即使训练材料出现限时描述，也统一忽略时长，只依据用户实际表达内容评价。
1. 总字数控制在500-900个中文字符，语气温暖、专业、鼓励，避免套话；每条建议都要能在下一次练习中执行。
2. 不做心理或医学诊断，不夸大 AI 能力，不使用 Markdown；只输出 JSON。
3. transcript 是学员实际说出的内容；originalText 只是训练材料或参考原文，绝不能把 originalText 当成学员发言。
4. 点评、内容匹配、逻辑展开和建议必须围绕 transcript；originalText 仅用于判断训练任务背景和参考方向。
5. 必须按照 evaluationDimensions 对应维度评分，并针对当前 evaluationType 评价，不同训练类型不要混用标准。
6. 可结合已有训练内容和规则指标讨论表达清晰度、流畅度、语速、停顿、逻辑组织、叙事或说服表达；没有音量、音色、精细发音评测数据时，不得判断音量、音色、平翘舌或发音准确度。
7. 当 workType 为视频时，只能把肢体语言、眼神和姿态写成下一次可尝试的训练动作；没有视觉分析数据时，不能声称已经看见其表现。
8. summary 是“综合评价”，必须写120-220个中文字符、4-6句话，并自然包含：温暖且真实的整体肯定、本次做得较好的具体方面、1-2个可直接执行的改进动作、带期待感的鼓励结尾。使用第二人称“你”，先肯定已经做到的部分，再用成长型措辞说明下一步，不机械套模板，不重复凑字数。
9. 综合评价必须遵循输入中的 evaluationFocus，结合真实 transcript 和已有内容规则指标变化表达；不能用同一套话覆盖不同训练类型。
10. 内容还要在对应字段中自然包含以下部分，并以少量 emoji 引导：🌟 综合表现、😊 做得好的地方、🎯 可以提升的地方、📚 下一次练习目标、🌈 鼓励。
11. 不得编造未提供的录音事实；只能根据输入中的真实字段判断。没有音量、音色、视觉或精细发音数据时，使用“从训练内容来看”等克制表述；无有效语音内容会由系统在调用模型前直接返回重录提醒。
12. 所有用户可见评价统一称“本次训练内容”，不要向用户暴露内部识别流程或技术字段名。
13. 生成 abilityRadar 表达能力五维评分，固定包含“流畅度、逻辑性、表达感染力、完整度、说服力”，每项 0-100 分；分数必须与 summary、dimensionScores 和具体文字评价一致。
14. abilityRadar 只能根据真实 transcript、训练内容和已有规则指标生成；没有视觉分析数据时，不得声称检测到眼神、台风或气场。

输入：${JSON.stringify(promptData)}

输出结构：
{"title":"AI点评","summary":"🌟 120-220个中文字符、4-6句话的综合评价","totalScore":0,"level":"","dimensionScores":[{"name":"","score":0,"comment":""}],"abilityRadar":{"dimensions":[{"name":"流畅度","score":0},{"name":"逻辑性","score":0},{"name":"表达感染力","score":0},{"name":"完整度","score":0},{"name":"说服力","score":0}]},"contentReview":"","voiceStateReview":"","strengths":["😊 "],"improvements":["🎯 "],"nextPractice":["📚 "],"encouragement":"🌈 ","caution":""}`
}

function estimateTokenCount(text) {
  const value = String(text || '')
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length
  const asciiWordCount = (value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  const otherCount = Math.max(value.length - cjkCount, 0)
  return Math.max(1, Math.ceil(cjkCount / 1.5 + asciiWordCount * 1.3 + otherCount / 8))
}

function getAIResponseText(response) {
  if (!response) return ''
  if (typeof response === 'string') return response
  if (response.text) return response.text
  if (response.content) return response.content
  if (response.output_text) return response.output_text
  if (response.data && typeof response.data === 'string') return response.data
  if (response.data && response.data.text) return response.data.text
  if (response.data && response.data.content) return response.data.content
  if (response.data && response.data.output_text) return response.data.output_text
  if (response.result && typeof response.result === 'string') return response.result
  if (response.result && response.result.text) return response.result.text
  if (response.result && response.result.content) return response.result.content
  if (response.result && response.result.output_text) return response.result.output_text

  const candidates = [
    response.choices,
    response.data && response.data.choices,
    response.result && response.result.choices,
    response.rawResponse && response.rawResponse.choices
  ].filter(Boolean)

  for (const choices of candidates) {
    const content = choices && choices[0] && choices[0].message && choices[0].message.content
    if (content) return content
  }

  if (Array.isArray(response.rawResponses)) {
    for (const item of response.rawResponses) {
      const content = item && item.choices && item.choices[0] && item.choices[0].message && item.choices[0].message.content
      if (content) return content
    }
  }

  return ''
}

async function callCloudBaseAI(prompt, actualModel) {
  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')
  const messages = [
    {
      role: 'user',
      content: prompt
    }
  ]

  const result = await model.generateText({
    model: actualModel,
    messages
  })

  console.log('[generateTrainingFeedback] ai result raw:', result)
  console.log('[generateTrainingFeedback] cloudbase ai result:', {
    type: typeof result,
    hasText: Boolean(getAIResponseText(result)),
    hasUsage: Boolean(result && result.usage)
  })

  return {
    text: getAIResponseText(result),
    usage: result && result.usage ? result.usage : null
  }
}

function parseJsonOutput(outputText) {
  const text = String(outputText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  if (!text) {
    throw new Error('empty AI response')
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      return JSON.parse(match[0])
    }
    throw error
  }
}

function buildNoValidSpeechResponse(submission, speechContext, feedbackType) {
  const providerFailure = speechContext.asrStatus === 'failed' && ![
    'ASR_EMPTY_RESULT',
    'VIDEO_NO_AUDIO_TRACK',
    'ASR_NO_AUDIO_TRACK',
    'ASR_RESULT_FILTERED'
  ].includes(speechContext.debugCode)
  const code = providerFailure ? 'ASR_FAILED' : 'EMPTY_TRANSCRIPT'
  let message = '暂未识别到有效语音内容，请确认录音声音清晰后重试。'
  if (speechContext.debugCode === 'ASR_TIMEOUT') message = '语音识别处理超时，请稍后重试。'
  else if (providerFailure) message = '语音识别服务暂时失败，请稍后重试。'
  else if (['VIDEO_NO_AUDIO_TRACK', 'ASR_NO_AUDIO_TRACK'].includes(speechContext.debugCode)) {
    message = '视频文件未检测到音轨，请确认微信麦克风权限后重新录制。'
  }
  return {
    success: false,
    error: true,
    code,
    source: 'none',
    model: 'none',
    feedbackVersion: 'v4-cost-optimized',
    feedbackType,
    feedbackMode: 'no_valid_speech',
    evaluationType: speechContext.evaluationType,
    evaluationDimensions: speechContext.evaluationDimensions,
    transcript: '',
    speechText: '',
    recognizedText: '',
    asrText: '',
    hasTranscript: false,
    asrStatus: speechContext.asrStatus,
    debugCode: speechContext.debugCode || 'NO_VALID_SPEECH',
    providerCode: speechContext.providerCode || '',
    requestId: speechContext.requestId || '',
    traceId: speechContext.traceId || '',
    asrErrorMessage: speechContext.asrErrorMessage,
    transcriptLength: 0,
    originalTextLength: speechContext.originalTextLength,
    asrProvider: speechContext.asrProvider,
    audioAnalysis: speechContext.audioAnalysis,
    speechAnalysis: speechContext.speechAnalysis,
    ruleAnalysis: speechContext.speechAnalysis,
    feedback: null,
    rawText: '',
    usage: null,
    tokenUsage: null,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    message
  }
}

exports.main = async event => {
  const submission = {
    ...event,
    ...(event.submission || {})
  }
  const feedbackType = submission.feedbackType === 'deep' || event.feedbackType === 'deep'
    ? 'deep'
    : 'normal'
  const actualModel = feedbackType === 'deep' ? DEEP_AI_MODEL : NORMAL_AI_MODEL
  const willCallASR = ['audio', 'video'].includes(submission.workType || submission.type) && Boolean(submission.cloudFileID || submission.fileID)
  let speechContext = null

  console.log('[generateTrainingFeedback] start:', {
    workId: submission.workId || submission.id || '',
    feedbackType,
    model: actualModel,
    workType: submission.workType || submission.type || '',
    cloudFileID: submission.cloudFileID || '',
    fileID: submission.fileID || '',
    hasCloudFileID: Boolean(submission.cloudFileID),
    hasFileID: Boolean(submission.fileID),
    durationSeconds: Number(submission.durationSeconds || 0),
    targetSeconds: Number(submission.targetSeconds || 0),
    willCallASR
  })
  console.log('[generateTrainingFeedback] model:', actualModel)

  try {
    if (!(await hasBoundPhone())) {
      return {
        success: false,
        error: true,
        message: '生成 AI 点评需要先绑定手机号。',
        debugCode: 'phone_required',
        source: 'none',
        model: 'none'
      }
    }

    speechContext = await prepareSpeechContext(submission)
    if ((submission.workType || submission.type) === 'video') {
      const traceId = speechContext.traceId || submission.traceId || 'missing_trace_id'
      console.log(`[VIDEO_ASR][${traceId}][validate]`, {
        valid: speechContext.feedbackMode === 'transcript_based',
        feedbackMode: speechContext.feedbackMode,
        asrStatus: speechContext.asrStatus,
        debugCode: speechContext.debugCode,
        providerCode: speechContext.providerCode,
        requestId: speechContext.requestId,
        transcriptLength: speechContext.transcriptLength,
        validationReason: speechContext.speechAnalysis && speechContext.speechAnalysis.possibleEmptyRecording
          ? 'possible_empty_recording'
          : (speechContext.transcriptLength ? 'transcript_present' : 'transcript_empty')
      })
    }
    console.log('[AI Feedback] moduleType/category:', {
      moduleType: submission.moduleType || submission.moduleId || '',
      category: submission.category || '',
      trainingType: submission.trainingType || '',
      evaluationType: speechContext.evaluationType
    })
    console.log('[AI Feedback] transcript length:', speechContext.transcriptLength)
    console.log('[AI Feedback] originalText length:', speechContext.originalTextLength)
    console.log('[AI Feedback] dimensions:', speechContext.evaluationDimensions)

    const payloadSummary = {
      sourceType: submission.sourceType || '',
      moduleTitle: submission.moduleTitle || '',
      day: submission.day || '',
      taskTitle: submission.contentTitle || submission.taskTitle || '',
      workType: submission.workType || '',
      durationSeconds: submission.durationSeconds || 0,
      minRequiredSeconds: submission.minRequiredSeconds || 0,
      cloudFileID: submission.cloudFileID || submission.fileID || '',
      feedbackMode: speechContext.feedbackMode,
      hasTranscript: speechContext.hasTranscript,
      asrStatus: speechContext.asrStatus,
      debugCode: speechContext.debugCode,
      providerCode: speechContext.providerCode,
      requestId: speechContext.requestId,
      traceId: speechContext.traceId,
      asrErrorMessage: speechContext.asrErrorMessage,
      transcriptLength: speechContext.transcriptLength,
      originalTextLength: speechContext.originalTextLength
    }
    payloadSummary.feedbackType = feedbackType
    console.log('[generateTrainingFeedback] payload summary:', payloadSummary)

    if (!speechContext.transcript || speechContext.feedbackMode === 'no_valid_speech') {
      const response = buildNoValidSpeechResponse(submission, speechContext, feedbackType)
      console.log('[generateTrainingFeedback] no valid speech, skip model:', {
        workId: submission.workId || submission.id || '',
        asrStatus: speechContext.asrStatus,
        debugCode: response.debugCode,
        transcriptLength: 0
      })
      return response
    }

    const prompt = buildPrompt(submission, speechContext, feedbackType)
    const estimatedInputTokens = estimateTokenCount(prompt)
    console.log('[generateTrainingFeedback] token estimate:', {
      estimatedInputTokens,
      transcriptLength: speechContext.transcriptLength
    })
    const aiResult = await callCloudBaseAI(prompt, actualModel)
    const rawText = aiResult.text || ''
    const estimatedOutputTokens = estimateTokenCount(rawText)
    let parsedFeedback = null

    try {
      parsedFeedback = parseJsonOutput(rawText)
    } catch (parseError) {
      console.error('[generateTrainingFeedback] parse error:', parseError)
      parseError.code = 'AI_RESPONSE_PARSE_FAILED'
      throw parseError
    }

    const feedback = normalizeFeedback(parsedFeedback, speechContext)

    if (!feedback) {
      throw new Error('invalid feedback payload')
    }

    if (speechContext.feedbackMode === 'transcript_based' && feedback.summary.length < 80) {
      console.warn('[generateTrainingFeedback] summary shorter than expected:', {
        workId: submission.workId || submission.id || '',
        evaluationType: speechContext.evaluationType,
        summaryLength: feedback.summary.length
      })
    }

    const response = {
      success: true,
      source: 'cloudbase-ai',
      model: actualModel,
      feedbackVersion: 'v4-cost-optimized',
      feedbackType,
      feedbackMode: speechContext.feedbackMode,
      evaluationType: speechContext.evaluationType,
      evaluationDimensions: speechContext.evaluationDimensions,
      transcript: speechContext.transcript,
      speechText: speechContext.transcript,
      recognizedText: speechContext.transcript,
      asrText: speechContext.transcript,
      hasTranscript: speechContext.hasTranscript,
      asrStatus: speechContext.asrStatus,
      debugCode: speechContext.debugCode,
      providerCode: speechContext.providerCode,
      requestId: speechContext.requestId,
      traceId: speechContext.traceId,
      asrErrorMessage: speechContext.asrErrorMessage,
      transcriptLength: speechContext.transcriptLength,
      asrProvider: speechContext.asrProvider,
      audioAnalysis: speechContext.audioAnalysis,
      speechAnalysis: speechContext.speechAnalysis,
      ruleAnalysis: speechContext.speechAnalysis,
      feedback,
      rawText,
      usage: aiResult.usage,
      tokenUsage: aiResult.usage,
      estimatedInputTokens,
      estimatedOutputTokens
    }

    console.log('[generateTrainingFeedback] success:', {
      workId: submission.workId || submission.id || '',
      model: actualModel,
      feedbackMode: speechContext.feedbackMode,
      asrStatus: speechContext.asrStatus,
      debugCode: speechContext.debugCode,
      transcriptLength: speechContext.transcriptLength,
      tokenUsage: aiResult.usage || null,
      estimatedInputTokens,
      estimatedOutputTokens
    })

    return response
  } catch (error) {
    console.error('[generateTrainingFeedback] failed:', {
      workId: submission.workId || submission.id || '',
      model: actualModel,
      feedbackType,
      feedbackMode: speechContext && speechContext.feedbackMode,
      asrStatus: speechContext && speechContext.asrStatus,
      debugCode: error.code || error.errCode || error.name || 'generate_training_feedback_failed',
      message: error.message || 'AI反馈生成失败'
    })

    return {
      success: false,
      error: true,
      message: error.message || 'AI反馈生成失败',
      debugCode: error.code || error.errCode || error.name || 'generate_training_feedback_failed',
      feedbackMode: speechContext ? speechContext.feedbackMode : 'metadata_only',
      asrStatus: speechContext ? speechContext.asrStatus : 'not_started',
      asrErrorMessage: speechContext ? speechContext.asrErrorMessage : '',
      transcriptLength: speechContext ? speechContext.transcriptLength : 0,
      source: 'none',
      model: 'none'
    }
  }
}
