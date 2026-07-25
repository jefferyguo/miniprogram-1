const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs-asr')

// 云函数控制台执行超时需设置为 60 秒或更长。
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000
})

const AsrClient = tencentcloud.asr.v20190614.Client
const MAX_POLL_ATTEMPTS = 30
const DEFAULT_POLL_INTERVAL_MS = 1200

function getAsrConfig() {
  const configuredInterval = Number(process.env.ASR_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS)

  return {
    secretId: process.env.ASR_SECRET_ID || '',
    secretKey: process.env.ASR_SECRET_KEY || '',
    token: process.env.ASR_TOKEN || '',
    region: process.env.ASR_REGION || 'ap-shanghai',
    engineModelType: process.env.ASR_ENGINE_MODEL_TYPE || '16k_zh',
    pollIntervalMs: Math.min(2000, Math.max(1000, configuredInterval))
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function getVoiceFormat(event = {}, cloudFileID = '') {
  const source = String(event.fileName || event.filePath || cloudFileID || '').split('?')[0].toLowerCase()
  const match = source.match(/\.([a-z0-9]+)$/)
  return String(event.voiceFormat || event.fileExtension || (match && match[1]) || 'unknown').toLowerCase()
}

function createAsrClient(config) {
  return new AsrClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
      token: config.token || undefined
    },
    region: config.region,
    profile: {
      httpProfile: {
        endpoint: 'asr.tencentcloudapi.com',
        reqTimeout: 10
      }
    }
  })
}

async function getTemporaryAudioUrl(cloudFileID) {
  const res = await cloud.getTempFileURL({ fileList: [cloudFileID] })
  const item = res.fileList && res.fileList[0]

  if (!item || item.status !== 0 || !item.tempFileURL) {
    const error = new Error((item && item.errMsg) || '录音文件临时地址获取失败')
    error.code = 'ASR_FILE_URL_UNAVAILABLE'
    throw error
  }

  return item.tempFileURL
}

function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[\d+:[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getTranscript(taskData = {}) {
  const result = taskData.Result

  if (typeof result === 'string') return cleanTranscript(result)
  if (result && typeof result.Text === 'string') return cleanTranscript(result.Text)

  const details = Array.isArray(taskData.ResultDetail) ? taskData.ResultDetail : []
  return cleanTranscript(details.map(item => item.FinalSentence || item.SliceSentence || '').filter(Boolean).join(' '))
}

function buildAudioAnalysis(taskData = {}, fallbackDurationSeconds = 0) {
  const details = Array.isArray(taskData.ResultDetail) ? taskData.ResultDetail : []
  const durationSeconds = Number(taskData.AudioDuration || fallbackDurationSeconds || 0)
  const firstSentence = details[0]
  const lastSentence = details[details.length - 1]
  const effectiveSpeechSeconds = firstSentence && lastSentence
    ? Math.max((Number(lastSentence.EndMs || 0) - Number(firstSentence.StartMs || 0)) / 1000, 0)
    : null
  const silenceRatio = durationSeconds > 0 && effectiveSpeechSeconds !== null
    ? Math.max(0, Math.min(1, Number(((durationSeconds - effectiveSpeechSeconds) / durationSeconds).toFixed(3))))
    : null
  const wordCount = details.reduce((count, item) => (
    count + Number(item.WordsNum || (Array.isArray(item.Words) ? item.Words.length : 0) || 0)
  ), 0)

  return {
    durationSeconds,
    effectiveSpeechSeconds,
    silenceRatio,
    wordCount,
    sentenceCount: details.length
  }
}

function getFailureStatus(debugCode) {
  return debugCode === 'ASR_NOT_CONFIGURED' ? 'not_configured' : 'failed'
}

function buildFailure(event, message, debugCode, extra = {}) {
  console.error('[transcribeAudio] failed:', {
    debugCode,
    message,
    taskId: extra.taskId || '',
    pollCount: Number(extra.pollCount || 0)
  })

  return {
    success: false,
    transcript: '',
    hasTranscript: false,
    asrStatus: getFailureStatus(debugCode),
    debugCode,
    asrErrorMessage: message,
    asrText: '',
    asrProvider: 'tencent-cloud-asr',
    durationSeconds: Number(event.durationSeconds || 0),
    taskId: extra.taskId || '',
    pollCount: Number(extra.pollCount || 0),
    message,
    providerCode: extra.providerCode || ''
  }
}

function classifyAsrError(error = {}) {
  const providerCode = String(error.code || error.name || '')
  const message = String(error.message || '')
  const text = `${providerCode} ${message}`.toLowerCase()

  if (text.includes('authfailure') || text.includes('unauthorized') || text.includes('credential')) return 'AuthFailure'
  if (text.includes('timeout') || text.includes('timed out') || text.includes('etimedout')) return 'ASR_TIMEOUT'
  if (text.includes('econnreset') || text.includes('socket hang up') || text.includes('connection reset')) return 'ASR_CONNECTION_RESET'
  return providerCode || 'ASR_REQUEST_FAILED'
}

async function createRecognitionTask(client, audioUrl, config) {
  console.log('[transcribeAudio] create task start:', {
    hasAudioUrl: Boolean(audioUrl),
    engineModelType: config.engineModelType
  })

  if (!audioUrl) {
    const error = new Error('ASR 音频临时地址为空')
    error.code = 'ASR_FILE_URL_UNAVAILABLE'
    throw error
  }

  const response = await client.CreateRecTask({
    EngineModelType: config.engineModelType,
    ChannelNum: 1,
    ResTextFormat: 1,
    SourceType: 0,
    Url: audioUrl
  })
  const taskId = response && response.Data && response.Data.TaskId

  if (taskId === undefined || taskId === null || taskId === '') {
    const error = new Error('ASR 创建任务未返回 TaskId')
    error.code = 'ASR_TASK_CREATE_FAILED'
    throw error
  }

  console.log('[transcribeAudio] task created:', {
    taskId,
    requestId: response.RequestId || ''
  })

  return taskId
}

async function pollRecognitionTask(client, taskId, intervalMs) {
  let transientFailureCount = 0

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await wait(intervalMs)

    let response
    try {
      response = await client.DescribeTaskStatus({ TaskId: taskId })
      transientFailureCount = 0
    } catch (error) {
      const debugCode = classifyAsrError(error)
      const canRetry = ['ASR_CONNECTION_RESET', 'ASR_TIMEOUT'].includes(debugCode) && transientFailureCount < 2

      if (!canRetry) {
        error.taskId = taskId
        error.pollCount = attempt
        throw error
      }

      transientFailureCount += 1
      console.warn('[transcribeAudio] poll transient error, retry:', {
        taskId,
        attempt,
        transientFailureCount,
        debugCode
      })
      continue
    }

    const taskData = response && response.Data ? response.Data : {}
    const status = Number(taskData.Status)
    const statusText = taskData.StatusStr || ''

    console.log('[transcribeAudio] poll status:', {
      taskId,
      attempt,
      status,
      statusText
    })

    if (status === 2 || statusText === 'success') {
      return {
        taskData,
        pollCount: attempt,
        requestId: response.RequestId || ''
      }
    }

    if (status === 3 || statusText === 'failed') {
      const error = new Error(taskData.ErrorMsg || 'ASR 识别任务失败')
      error.code = 'ASR_TASK_FAILED'
      error.taskId = taskId
      error.pollCount = attempt
      throw error
    }
  }

  const error = new Error('ASR 识别等待超时')
  error.code = 'ASR_TIMEOUT'
  error.taskId = taskId
  error.pollCount = MAX_POLL_ATTEMPTS
  throw error
}

exports.main = async event => {
  const cloudFileID = event.cloudFileID || event.fileID || event.fileId || event.audioFileID || event.audioFileId || ''
  const audioUrl = event.audioUrl || event.audioURL || event.audioFileUrl || event.audioFileURL || ''
  const config = getAsrConfig()
  const durationSeconds = Number(event.durationSeconds || 0)
  const voiceFormat = getVoiceFormat(event, cloudFileID)
  let taskId = ''
  let pollCount = 0

  console.log('[transcribeAudio] input keys:', Object.keys(event || {}))
  console.log('[transcribeAudio] fileID exists:', Boolean(cloudFileID))
  console.log('[transcribeAudio] audioUrl exists:', Boolean(audioUrl))
  console.log('[transcribeAudio] start:', {
    hasSecretId: Boolean(config.secretId),
    hasSecretKey: Boolean(config.secretKey),
    region: config.region,
    engineModelType: config.engineModelType,
    hasCloudFileID: Boolean(cloudFileID),
    hasAudioUrl: Boolean(audioUrl),
    workId: event.workId || '',
    durationSeconds,
    voiceFormat
  })

  if (!cloudFileID && !audioUrl) {
    console.log('[transcribeAudio] no cloudFileID or audioUrl, input keys:', Object.keys(event || {}))
    return buildFailure(event, '缺少录音文件标识（cloudFileID 或 audioUrl）', 'ASR_NO_FILE')
  }

  if (!config.secretId || !config.secretKey) {
    return buildFailure(event, 'ASR 环境变量未配置', 'ASR_NOT_CONFIGURED')
  }

  try {
    let effectiveAudioUrl = audioUrl

    if (!effectiveAudioUrl && cloudFileID) {
      console.log('[transcribeAudio] getting temp url for cloudFileID:', Boolean(cloudFileID))
      effectiveAudioUrl = await getTemporaryAudioUrl(cloudFileID)
    }

    console.log('[transcribeAudio] effective audioUrl:', {
      success: Boolean(effectiveAudioUrl),
      length: effectiveAudioUrl ? effectiveAudioUrl.length : 0
    })

    if (!effectiveAudioUrl) {
      return buildFailure(event, '录音文件临时地址获取失败', 'ASR_FILE_URL_UNAVAILABLE')
    }

    const client = createAsrClient(config)
    taskId = await createRecognitionTask(client, effectiveAudioUrl, config)
    const pollResult = await pollRecognitionTask(client, taskId, config.pollIntervalMs)
    pollCount = pollResult.pollCount

    const transcript = getTranscript(pollResult.taskData)
    const audioAnalysis = buildAudioAnalysis(pollResult.taskData, durationSeconds)
    const debugCode = transcript ? '' : 'NO_VALID_SPEECH'

    console.log('[transcribeAudio] success:', {
      taskId,
      pollCount,
      transcriptLength: transcript.length,
      debugCode
    })
    console.log('[ASR] result text length:', transcript.length)

    return {
      success: true,
      transcript,
      hasTranscript: Boolean(transcript),
      asrStatus: 'success',
      debugCode,
      asrErrorMessage: '',
      asrText: transcript,
      asrProvider: 'tencent-cloud-asr',
      durationSeconds: audioAnalysis.durationSeconds,
      effectiveSpeechSeconds: audioAnalysis.effectiveSpeechSeconds,
      silenceRatio: audioAnalysis.silenceRatio,
      audioAnalysis,
      taskId,
      pollCount,
      requestId: pollResult.requestId,
      message: transcript ? '语音转写成功' : '未识别到有效文字'
    }
  } catch (error) {
    const debugCode = classifyAsrError(error)
    return buildFailure(
      event,
      error.message || '语音转写失败',
      debugCode,
      {
        taskId: error.taskId || taskId,
        pollCount: error.pollCount || pollCount,
        providerCode: error.code || ''
      }
    )
  }
}
