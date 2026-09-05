const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs-asr')
const { inspectMp4 } = require('./media-inspector')

const VIDEO_ASR_FUNCTION_TIMEOUT_MS = 300000
const VIDEO_ASR_POLL_DEADLINE_MS = 270000
const AUDIO_ASR_POLL_DEADLINE_MS = 50000
const VIDEO_ASR_FAST_POLL_WINDOW_MS = 30000
const DEFAULT_POLL_INTERVAL_MS = 1500
const VIDEO_ASR_SLOW_POLL_INTERVAL_MS = 2500

// 平台执行时限仍需在云开发控制台手动设置为 300 秒。
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: VIDEO_ASR_FUNCTION_TIMEOUT_MS
})

const AsrClient = tencentcloud.asr.v20190614.Client
const SUPPORTED_FILE_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'flv', 'mp4', 'wma', '3gp', 'amr', 'aac', 'ogg', 'flac'])
const MIME_BY_EXTENSION = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', flv: 'video/x-flv',
  mp4: 'video/mp4', wma: 'audio/x-ms-wma', '3gp': 'video/3gpp', amr: 'audio/amr',
  aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac'
}

function getAsrConfig() {
  const configuredInterval = Number(process.env.ASR_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS)

  return {
    secretId: process.env.ASR_SECRET_ID || '',
    secretKey: process.env.ASR_SECRET_KEY || '',
    token: process.env.ASR_TOKEN || '',
    region: process.env.ASR_REGION || 'ap-shanghai',
    engineModelType: process.env.ASR_ENGINE_MODEL_TYPE || '16k_zh',
    pollIntervalMs: Math.min(2500, Math.max(1000, configuredInterval))
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function getVoiceFormat(event = {}, cloudFileID = '') {
  const source = String(event.fileName || event.filePath || cloudFileID || event.audioUrl || event.audioURL || '').split('?')[0].toLowerCase()
  const match = source.match(/\.([a-z0-9]+)$/)
  return String(event.voiceFormat || event.fileExtension || (match && match[1]) || 'unknown').toLowerCase()
}

function getSourceType(event = {}, extension = '') {
  const value = String(event.workType || event.sourceType || '').toLowerCase()
  if (value === 'audio' || value === 'video') return value
  return ['flv', 'mp4', '3gp'].includes(extension) ? 'video' : 'audio'
}

function maskCloudFileID(value = '') {
  const text = String(value)
  if (!text) return ''
  return `${text.slice(0, 12)}…${text.slice(-10)}`
}

function buildDiagnostics(event = {}, cloudFileID = '') {
  const fileExtension = getVoiceFormat(event, cloudFileID)
  const explicitFileSize = Object.prototype.hasOwnProperty.call(event, 'fileSize') &&
    event.fileSize !== undefined && event.fileSize !== null && event.fileSize !== ''
  return {
    traceId: String(event.traceId || `asr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    sourceType: getSourceType(event, fileExtension),
    cloudFileIdMasked: maskCloudFileID(cloudFileID),
    fileSize: explicitFileSize ? Number(event.fileSize) : null,
    fileExtension,
    mimeType: String(event.mimeType || MIME_BY_EXTENSION[fileExtension] || 'application/octet-stream'),
    durationSeconds: Number(event.durationSeconds || 0),
    conversion: 'not_required_provider_accepts_container'
  }
}

function videoAsrLog(diagnostics, stage, payload = {}, level = 'log') {
  if (diagnostics.sourceType !== 'video') return
  const logger = console[level] || console.log
  logger(`[VIDEO_ASR][${diagnostics.traceId}][${stage}]`, payload)
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

async function inspectCloudVideo(cloudFileID, diagnostics) {
  if (!cloudFileID || diagnostics.sourceType !== 'video' || diagnostics.fileExtension !== 'mp4') return null
  try {
    const downloaded = await cloud.downloadFile({ fileID: cloudFileID })
    const buffer = downloaded && downloaded.fileContent
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      const error = new Error('CloudBase 下载的视频 Buffer 为空')
      error.code = 'VIDEO_CLOUD_FILE_EMPTY'
      throw error
    }
    const mediaInfo = {
      ...inspectMp4(buffer),
      fileSize: buffer.length,
      extension: diagnostics.fileExtension,
      mimeType: diagnostics.mimeType
    }
    videoAsrLog(diagnostics, 'download', { bufferSize: buffer.length, success: true })
    videoAsrLog(diagnostics, 'media_info', { VIDEO_ASR_MEDIA_INFO: mediaInfo })
    return mediaInfo
  } catch (error) {
    videoAsrLog(diagnostics, 'download', {
      success: false,
      code: error.code || '',
      message: error.message || 'video probe failed'
    }, 'warn')
    return {
      probeStatus: 'download_or_probe_failed',
      hasAudioStream: null,
      errorCode: error.code || '',
      fileSize: diagnostics.fileSize,
      extension: diagnostics.fileExtension,
      mimeType: diagnostics.mimeType
    }
  }
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

function buildFailure(event, message, debugCode, extra = {}, diagnostics = {}) {
  console.error('[transcribeAudio] failed:', {
    debugCode,
    message,
    taskId: extra.taskId || '',
    pollCount: Number(extra.pollCount || 0),
    providerCode: extra.providerCode || '',
    requestId: extra.requestId || '',
    traceId: diagnostics.traceId || '',
    sourceType: diagnostics.sourceType || '',
    fileSize: diagnostics.fileSize === undefined ? null : diagnostics.fileSize,
    fileExtension: diagnostics.fileExtension || '',
    mimeType: diagnostics.mimeType || ''
  })
  videoAsrLog(diagnostics, 'validate', {
    valid: false,
    debugCode,
    providerCode: extra.providerCode || '',
    requestId: extra.requestId || '',
    transcriptLength: 0
  }, 'error')

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
    providerCode: extra.providerCode || '',
    requestId: extra.requestId || '',
    mediaInfo: extra.mediaInfo || null,
    ...diagnostics
  }
}

function classifyAsrError(error = {}) {
  const providerCode = String(error.code || error.name || '')
  const message = String(error.message || '')
  const text = `${providerCode} ${message}`.toLowerCase()

  if (text.includes('no audio') || text.includes('audio decode') || text.includes('audio stream')) return 'ASR_NO_AUDIO_TRACK'
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

  const request = {
    EngineModelType: config.engineModelType,
    ChannelNum: 1,
    ResTextFormat: 1,
    SourceType: 0,
    Url: audioUrl
  }
  const response = await client.CreateRecTask(request)
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

  return { taskId, requestId: response.RequestId || '', request }
}

function getPollIntervalMs(elapsedMs, baseIntervalMs, sourceType) {
  if (sourceType === 'video') {
    return elapsedMs < VIDEO_ASR_FAST_POLL_WINDOW_MS
      ? DEFAULT_POLL_INTERVAL_MS
      : VIDEO_ASR_SLOW_POLL_INTERVAL_MS
  }
  return elapsedMs < VIDEO_ASR_FAST_POLL_WINDOW_MS
    ? Math.max(DEFAULT_POLL_INTERVAL_MS, baseIntervalMs)
    : Math.max(VIDEO_ASR_SLOW_POLL_INTERVAL_MS, baseIntervalMs)
}

async function pollRecognitionTask(client, taskId, intervalMs, diagnostics, recognitionStartedAt) {
  let transientFailureCount = 0
  let attempt = 0
  const startedAt = diagnostics.sourceType === 'video' ? recognitionStartedAt : Date.now()
  const deadlineMs = diagnostics.sourceType === 'video'
    ? VIDEO_ASR_POLL_DEADLINE_MS
    : AUDIO_ASR_POLL_DEADLINE_MS

  while (Date.now() - startedAt < deadlineMs) {
    attempt += 1
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
      const elapsedMs = Date.now() - startedAt
      const remainingMs = deadlineMs - elapsedMs
      if (remainingMs <= 0) break
      await wait(Math.min(getPollIntervalMs(elapsedMs, intervalMs, diagnostics.sourceType), remainingMs))
      continue
    }

    // DescribeTaskStatus 本身也会耗时；返回后再次校验，避免越过总预算才按成功处理。
    if (Date.now() - startedAt >= deadlineMs) break

    const taskData = response && response.Data ? response.Data : {}
    const status = Number(taskData.Status)
    const statusText = taskData.StatusStr || ''

    if (attempt === 1 || attempt % 10 === 0 || status === 2 || status === 3) {
      console.log('[transcribeAudio] poll status:', { taskId, attempt, status, statusText })
      videoAsrLog(diagnostics, 'response', {
        httpStatus: null,
        taskId,
        attempt,
        status,
        statusText,
        providerCode: taskData.ErrorCode || '',
        providerMessage: taskData.ErrorMsg || '',
        requestId: response.RequestId || '',
        resultKeys: Object.keys(taskData),
        resultLength: typeof taskData.Result === 'string' ? taskData.Result.length : 0,
        resultDetailCount: Array.isArray(taskData.ResultDetail) ? taskData.ResultDetail.length : 0
      })
    }

    if (status === 2 || statusText === 'success') {
      return {
        taskData,
        pollCount: attempt,
        requestId: response.RequestId || ''
      }
    }

    if (status === 3 || statusText === 'failed') {
      const error = new Error(taskData.ErrorMsg || 'ASR 识别任务失败')
      error.code = taskData.ErrorCode || 'ASR_TASK_FAILED'
      error.debugCode = classifyAsrError({ code: error.code, message: error.message })
      error.taskId = taskId
      error.pollCount = attempt
      throw error
    }

    const elapsedMs = Date.now() - startedAt
    const remainingMs = deadlineMs - elapsedMs
    if (remainingMs <= 0) break
    await wait(Math.min(getPollIntervalMs(elapsedMs, intervalMs, diagnostics.sourceType), remainingMs))
  }

  const error = new Error(diagnostics.sourceType === 'video'
    ? '语音识别处理时间超过 5 分钟，请稍后重新识别。'
    : 'ASR 识别等待超时')
  error.code = 'ASR_TIMEOUT'
  error.taskId = taskId
  error.pollCount = attempt
  throw error
}

exports.main = async event => {
  // VIDEO 的 270 秒预算从入口开始，包含下载/探测、临时 URL 与 CreateRecTask，
  // 给 300 秒平台执行时限保留约 30 秒用于错误封装和返回。
  const recognitionStartedAt = Date.now()
  const cloudFileID = event.cloudFileID || event.fileID || event.fileId || event.audioFileID || event.audioFileId || ''
  const audioUrl = event.audioUrl || event.audioURL || event.audioFileUrl || event.audioFileURL || ''
  const config = getAsrConfig()
  const durationSeconds = Number(event.durationSeconds || 0)
  const diagnostics = buildDiagnostics(event, cloudFileID)
  const voiceFormat = diagnostics.fileExtension
  let taskId = ''
  let pollCount = 0
  let mediaInfo = null

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
    voiceFormat,
    sourceType: diagnostics.sourceType,
    cloudFileIdMasked: diagnostics.cloudFileIdMasked,
    fileSize: diagnostics.fileSize,
    mimeType: diagnostics.mimeType,
    traceId: diagnostics.traceId
  })

  if (!cloudFileID && !audioUrl) {
    console.log('[transcribeAudio] no cloudFileID or audioUrl, input keys:', Object.keys(event || {}))
    return buildFailure(event, '缺少录音文件标识（cloudFileID 或 audioUrl）', 'ASR_NO_FILE', {}, diagnostics)
  }

  if (diagnostics.fileSize !== null && (!Number.isFinite(diagnostics.fileSize) || diagnostics.fileSize <= 0)) {
    return buildFailure(event, '媒体文件为空，未提交语音识别', 'ASR_EMPTY_FILE', {}, diagnostics)
  }

  if (voiceFormat !== 'unknown' && !SUPPORTED_FILE_EXTENSIONS.has(voiceFormat)) {
    return buildFailure(event, `ASR 不支持该媒体格式：${voiceFormat}`, 'ASR_UNSUPPORTED_FORMAT', {}, diagnostics)
  }

  if (!config.secretId || !config.secretKey) {
    return buildFailure(event, 'ASR 环境变量未配置', 'ASR_NOT_CONFIGURED', {}, diagnostics)
  }

  try {
    let effectiveAudioUrl = audioUrl

    mediaInfo = await inspectCloudVideo(cloudFileID, diagnostics)
    if (mediaInfo && mediaInfo.probeStatus === 'ok' && mediaInfo.hasAudioStream === false) {
      return buildFailure(event, '视频文件中没有音轨', 'VIDEO_NO_AUDIO_TRACK', { mediaInfo }, diagnostics)
    }
    videoAsrLog(diagnostics, 'extract', {
      performed: false,
      conversionResult: 'not_required',
      reason: 'Tencent CreateRecTask accepts MP4 URL input',
      inputSize: mediaInfo && mediaInfo.fileSize || diagnostics.fileSize,
      outputSize: null,
      hasAudioStream: mediaInfo && mediaInfo.hasAudioStream,
      audioCodec: mediaInfo && mediaInfo.audioCodec || null
    })

    if (!effectiveAudioUrl && cloudFileID) {
      console.log('[transcribeAudio] getting temp url for cloudFileID:', Boolean(cloudFileID))
      effectiveAudioUrl = await getTemporaryAudioUrl(cloudFileID)
    }

    console.log('[transcribeAudio] effective audioUrl:', {
      success: Boolean(effectiveAudioUrl),
      length: effectiveAudioUrl ? effectiveAudioUrl.length : 0
    })

    if (!effectiveAudioUrl) {
      return buildFailure(event, '录音文件临时地址获取失败', 'ASR_FILE_URL_UNAVAILABLE', {}, diagnostics)
    }

    const client = createAsrClient(config)
    const createResult = await createRecognitionTask(client, effectiveAudioUrl, config)
    taskId = createResult.taskId
    videoAsrLog(diagnostics, 'request', {
      source: 'original_mp4_url',
      sourceType: diagnostics.sourceType,
      extension: diagnostics.fileExtension,
      mimeType: diagnostics.mimeType,
      bufferSize: mediaInfo && mediaInfo.fileSize || diagnostics.fileSize,
      asrFormatParameter: 'none_provider_infers_from_url_content',
      engineModelType: createResult.request.EngineModelType,
      channelNum: createResult.request.ChannelNum,
      sourceMode: createResult.request.SourceType,
      requestId: createResult.requestId,
      pollDeadlineMs: diagnostics.sourceType === 'video' ? VIDEO_ASR_POLL_DEADLINE_MS : AUDIO_ASR_POLL_DEADLINE_MS,
      fastPollIntervalMs: diagnostics.sourceType === 'video' ? DEFAULT_POLL_INTERVAL_MS : Math.max(DEFAULT_POLL_INTERVAL_MS, config.pollIntervalMs),
      slowPollIntervalMs: diagnostics.sourceType === 'video' ? VIDEO_ASR_SLOW_POLL_INTERVAL_MS : Math.max(VIDEO_ASR_SLOW_POLL_INTERVAL_MS, config.pollIntervalMs)
    })
    const pollResult = await pollRecognitionTask(client, taskId, config.pollIntervalMs, diagnostics, recognitionStartedAt)
    pollCount = pollResult.pollCount

    const transcript = getTranscript(pollResult.taskData)
    const audioAnalysis = buildAudioAnalysis(pollResult.taskData, durationSeconds)
    const debugCode = transcript ? '' : 'ASR_EMPTY_RESULT'

    console.log('[transcribeAudio] success:', {
      taskId,
      pollCount,
      transcriptLength: transcript.length,
      debugCode
    })
    console.log('[ASR] result text length:', transcript.length)
    videoAsrLog(diagnostics, 'parse', {
      ASR_RAW_RESULT: {
        keys: Object.keys(pollResult.taskData || {}),
        status: pollResult.taskData.Status,
        statusText: pollResult.taskData.StatusStr || '',
        resultPresent: typeof pollResult.taskData.Result === 'string',
        resultDetailCount: Array.isArray(pollResult.taskData.ResultDetail) ? pollResult.taskData.ResultDetail.length : 0
      },
      ASR_PARSED_TRANSCRIPT: transcript ? '[present]' : '',
      ASR_TRANSCRIPT_LENGTH: transcript.length
    })

    if (!transcript) {
      return buildFailure(event, 'ASR 请求成功但未返回有效识别文字', debugCode, {
        taskId,
        pollCount,
        requestId: pollResult.requestId || createResult.requestId,
        mediaInfo
      }, diagnostics)
    }

    videoAsrLog(diagnostics, 'validate', {
      valid: true,
      debugCode: '',
      requestId: pollResult.requestId || createResult.requestId,
      transcriptLength: transcript.length
    })

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
      mediaInfo,
      message: '语音转写成功',
      ...diagnostics
    }
  } catch (error) {
    const debugCode = error.debugCode || classifyAsrError(error)
    return buildFailure(
      event,
      error.message || '语音转写失败',
      debugCode,
      {
        taskId: error.taskId || taskId,
        pollCount: error.pollCount || pollCount,
        providerCode: error.code || '',
        requestId: error.requestId || '',
        mediaInfo
      },
      diagnostics
    )
  }
}
