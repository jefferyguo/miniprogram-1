const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

function loadFeedbackWithCloud(cloud) {
  const filename = path.join(__dirname, 'index.js')
  const source = `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__test = { tryTranscribeAudio, prepareSpeechContext, buildNoValidSpeechResponse };`
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(__dirname)
  instance.require = request => request === 'wx-server-sdk'
    ? cloud
    : Module.prototype.require.call(instance, request)
  instance._compile(source, filename)
  return instance.exports.__test
}

function makeCloud(asrResult) {
  return {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database() {
      return {}
    },
    async callFunction(request, options) {
      assert.equal(request.name, 'transcribeAudio')
      assert.equal(options.timeout, 280000)
      return { result: asrResult }
    }
  }
}

test('video cloud file is sent to transcribeAudio and its transcript reaches speech context', async () => {
  const api = loadFeedbackWithCloud(makeCloud({
    success: true,
    transcript: '视频里的有效发言',
    hasTranscript: true,
    asrStatus: 'success',
    asrProvider: 'tencent-cloud-asr'
  }))

  const context = await api.prepareSpeechContext({
    workType: 'video',
    cloudFileID: 'cloud://env/videos/device.mp4',
    fileName: 'device.mp4',
    durationSeconds: 10
  })

  assert.equal(context.transcript, '视频里的有效发言')
  assert.equal(context.asrStatus, 'success')
  assert.equal(context.feedbackMode, 'transcript_based')
})

test('ASR error details propagate through video speech context', async () => {
  const api = loadFeedbackWithCloud(makeCloud({
    success: false,
    transcript: '',
    asrStatus: 'failed',
    debugCode: 'ASR_NO_AUDIO_TRACK',
    asrErrorMessage: '视频中没有可识别音轨',
    providerCode: 'FailedOperation.AudioDecodeFailed',
    requestId: 'provider-request',
    traceId: 'trace-device-test'
  }))

  const context = await api.prepareSpeechContext({
    workType: 'video',
    cloudFileID: 'cloud://env/videos/no-audio.mp4',
    durationSeconds: 10
  })

  assert.equal(context.transcript, '')
  assert.equal(context.asrStatus, 'failed')
  assert.equal(context.debugCode, 'ASR_NO_AUDIO_TRACK')
  assert.equal(context.asrErrorMessage, '视频中没有可识别音轨')
  assert.equal(context.providerCode, 'FailedOperation.AudioDecodeFailed')
  assert.equal(context.requestId, 'provider-request')
  assert.equal(context.traceId, 'trace-device-test')
})

test('ASR timeout is not converted into an empty-speech business error', async () => {
  const api = loadFeedbackWithCloud(makeCloud({
    success: false,
    transcript: '',
    asrStatus: 'failed',
    debugCode: 'ASR_TIMEOUT',
    asrErrorMessage: 'ASR 识别等待超时',
    providerCode: 'ASR_TIMEOUT',
    requestId: 'timeout-request',
    traceId: 'trace-timeout'
  }))
  const context = await api.prepareSpeechContext({
    workType: 'video',
    cloudFileID: 'cloud://env/videos/iphone-64s.mp4',
    durationSeconds: 64,
    traceId: 'trace-timeout'
  })
  const response = api.buildNoValidSpeechResponse({}, context, 'normal')

  assert.equal(response.code, 'ASR_FAILED')
  assert.equal(response.debugCode, 'ASR_TIMEOUT')
  assert.match(response.message, /超时/)
})
