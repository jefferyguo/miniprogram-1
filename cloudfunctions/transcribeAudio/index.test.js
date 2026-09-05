const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')
const path = require('node:path')

function loadTranscriber(options = {}) {
  const taskData = options.taskData || {
    Status: 2,
    StatusStr: 'success',
    Result: '正常识别结果',
    AudioDuration: 10
  }
  class FakeClient {
    async CreateRecTask(request) {
      if (typeof options.onCreate === 'function') options.onCreate(request)
      if (options.createError) throw options.createError
      assert.equal(request.SourceType, 0)
      return { Data: { TaskId: 42 }, RequestId: 'create-request' }
    }

    async DescribeTaskStatus() {
      if (typeof options.onDescribe === 'function') options.onDescribe()
      if (typeof options.taskAtTime === 'function') {
        return { Data: options.taskAtTime(Number(global.__videoAsrTestClock || 0)), RequestId: 'poll-request' }
      }
      if (Array.isArray(options.taskSequence) && options.taskSequence.length) {
        return { Data: options.taskSequence.shift(), RequestId: 'poll-request' }
      }
      return { Data: taskData, RequestId: 'poll-request' }
    }
  }

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    async getTempFileURL() {
      return {
        fileList: [{ status: 0, tempFileURL: 'https://example.test/media' }]
      }
    },
    async downloadFile() {
      return { fileContent: options.cloudFileBuffer || Buffer.from('unparseable test media') }
    }
  }
  const filename = path.join(__dirname, 'index.js')
  let source = options.skipWait || options.fakeClock ? require('node:fs').readFileSync(filename, 'utf8') : null
  if (source && options.skipWait) {
    source = source.replace(
      'function wait(milliseconds) {\n  return new Promise(resolve => setTimeout(resolve, milliseconds))\n}',
      'function wait() { return Promise.resolve() }'
    )
  }
  if (source && options.fakeClock) {
    source = source
      .replaceAll('Date.now()', 'Number(global.__videoAsrTestClock || 0)')
      .replace(
        'function wait(milliseconds) {\n  return new Promise(resolve => setTimeout(resolve, milliseconds))\n}',
        'function wait(milliseconds) { global.__videoAsrTestClock += milliseconds; return Promise.resolve() }'
      )
  }
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(__dirname)
  instance.require = request => {
    if (request === 'wx-server-sdk') return cloud
    if (request === 'tencentcloud-sdk-nodejs-asr') {
      return { asr: { v20190614: { Client: FakeClient } } }
    }
    return Module.prototype.require.call(instance, request)
  }
  if (source) instance._compile(source, filename)
  else instance.load(filename)
  return instance.exports.main
}

function mp4Box(type, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + payload.length)
  result.writeUInt32BE(result.length, 0)
  result.write(type, 4, 4, 'ascii')
  payload.copy(result, 8)
  return result
}

function makeVideoOnlyMp4() {
  const hdlr = Buffer.alloc(12)
  hdlr.write('vide', 8, 4, 'ascii')
  return mp4Box('moov', mp4Box('trak', mp4Box('mdia', mp4Box('hdlr', hdlr))))
}

function withAsrEnv(run) {
  const before = {
    id: process.env.ASR_SECRET_ID,
    key: process.env.ASR_SECRET_KEY,
    interval: process.env.ASR_POLL_INTERVAL_MS
  }
  process.env.ASR_SECRET_ID = 'test-id'
  process.env.ASR_SECRET_KEY = 'test-key'
  process.env.ASR_POLL_INTERVAL_MS = '1'
  return Promise.resolve(run()).finally(() => {
    if (before.id === undefined) delete process.env.ASR_SECRET_ID
    else process.env.ASR_SECRET_ID = before.id
    if (before.key === undefined) delete process.env.ASR_SECRET_KEY
    else process.env.ASR_SECRET_KEY = before.key
    if (before.interval === undefined) delete process.env.ASR_POLL_INTERVAL_MS
    else process.env.ASR_POLL_INTERVAL_MS = before.interval
  })
}

function withFakeClock(run) {
  const previous = global.__videoAsrTestClock
  global.__videoAsrTestClock = 1000
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete global.__videoAsrTestClock
    else global.__videoAsrTestClock = previous
  })
}

test('recognizes a normal audio cloud file', () => withAsrEnv(async () => {
  const result = await loadTranscriber()({
    cloudFileID: 'cloud://env/recordings/sample.mp3',
    sourceType: 'audio',
    fileSize: 1024
  })
  assert.equal(result.success, true)
  assert.equal(result.transcript, '正常识别结果')
}))

test('recognizes a supported MP4 video source', () => withAsrEnv(async () => {
  const result = await loadTranscriber()({
    cloudFileID: 'cloud://env/videos/sample.mp4',
    sourceType: 'video',
    fileSize: 4096
  })
  assert.equal(result.success, true)
  assert.equal(result.sourceType, 'video')
  assert.equal(result.fileExtension, 'mp4')
}))

test('64-second video can finish after more than 30 asynchronous status polls', () => withAsrEnv(async () => {
  const waiting = Array.from({ length: 31 }, () => ({ Status: 1, StatusStr: 'doing' }))
  const result = await loadTranscriber({
    skipWait: true,
    taskSequence: [...waiting, {
      Status: 2,
      StatusStr: 'success',
      Result: '六十四秒视频中的有效发言',
      AudioDuration: 64
    }]
  })({
    cloudFileID: 'cloud://env/videos/iphone-64s.mp4',
    sourceType: 'video',
    durationSeconds: 64,
    fileSize: 1024 * 1024,
    traceId: 'video-asr-64s'
  })

  assert.equal(result.success, true)
  assert.equal(result.transcript, '六十四秒视频中的有效发言')
  assert.equal(result.traceId, 'video-asr-64s')
}))

test('video ASR can succeed after the old 50-second window', () => withAsrEnv(() => withFakeClock(async () => {
  const result = await loadTranscriber({
    fakeClock: true,
    taskAtTime: now => now >= 61000
      ? { Status: 2, StatusStr: 'success', Result: '超过旧窗口后识别成功', AudioDuration: 64 }
      : { Status: 1, StatusStr: 'doing' }
  })({
    cloudFileID: 'cloud://env/videos/after-50s.mp4',
    sourceType: 'video',
    durationSeconds: 64,
    fileSize: 1024 * 1024,
    traceId: 'video-after-50s'
  })
  assert.equal(result.success, true)
  assert.equal(result.transcript, '超过旧窗口后识别成功')
})))

test('video ASR can succeed close to four minutes without real waiting', () => withAsrEnv(() => withFakeClock(async () => {
  const result = await loadTranscriber({
    fakeClock: true,
    taskAtTime: now => now >= 241000
      ? { Status: 2, StatusStr: 'success', Result: '接近四分钟识别成功', AudioDuration: 240 }
      : { Status: 1, StatusStr: 'doing' }
  })({
    cloudFileID: 'cloud://env/videos/four-minutes.mp4',
    sourceType: 'video',
    durationSeconds: 240,
    fileSize: 4 * 1024 * 1024,
    traceId: 'video-four-minutes'
  })
  assert.equal(result.success, true)
  assert.equal(result.transcript, '接近四分钟识别成功')
})))

test('video ASR returns ASR_TIMEOUT after the 270-second deadline', () => withAsrEnv(() => withFakeClock(async () => {
  const result = await loadTranscriber({
    fakeClock: true,
    taskAtTime: () => ({ Status: 1, StatusStr: 'doing' })
  })({
    cloudFileID: 'cloud://env/videos/deadline.mp4',
    sourceType: 'video',
    durationSeconds: 240,
    fileSize: 4 * 1024 * 1024,
    traceId: 'video-deadline'
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'ASR_TIMEOUT')
  assert.match(result.message, /5 分钟/)
  assert.equal(global.__videoAsrTestClock, 271000)
})))

test('rejects an explicitly empty file before ASR', () => withAsrEnv(async () => {
  const result = await loadTranscriber()({
    cloudFileID: 'cloud://env/videos/empty.mp4',
    sourceType: 'video',
    fileSize: 0
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'ASR_EMPTY_FILE')
}))

test('reports an undecodable or no-audio-track video as a structured failure', () => withAsrEnv(async () => {
  let describeCalls = 0
  const result = await loadTranscriber({
    onDescribe: () => { describeCalls += 1 },
    taskData: {
      Status: 3,
      StatusStr: 'failed',
      ErrorMsg: 'Audio decode failed: no audio stream',
      ErrorCode: 'FailedOperation.AudioDecodeFailed'
    }
  })({
    cloudFileID: 'cloud://env/videos/no-audio.mp4',
    sourceType: 'video',
    fileSize: 4096
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'ASR_NO_AUDIO_TRACK')
  assert.equal(result.providerCode, 'FailedOperation.AudioDecodeFailed')
  assert.equal(describeCalls, 1)
}))

test('stops before ASR when the downloaded MP4 definitively has no audio track', () => withAsrEnv(async () => {
  let createCalls = 0
  const result = await loadTranscriber({
    cloudFileBuffer: makeVideoOnlyMp4(),
    onCreate: () => { createCalls += 1 }
  })({
    cloudFileID: 'cloud://env/videos/video-only.mp4',
    sourceType: 'video',
    fileSize: 4096,
    traceId: 'video-no-track'
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'VIDEO_NO_AUDIO_TRACK')
  assert.equal(result.mediaInfo.hasAudioStream, false)
  assert.equal(createCalls, 0)
}))

test('does not report an empty ASR result as success', () => withAsrEnv(async () => {
  const result = await loadTranscriber({
    taskData: { Status: 2, StatusStr: 'success', Result: '', ResultDetail: [] }
  })({
    cloudFileID: 'cloud://env/recordings/silence.mp3',
    sourceType: 'audio',
    fileSize: 1024
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'ASR_EMPTY_RESULT')
}))

test('preserves ASR API errors', () => withAsrEnv(async () => {
  const error = new Error('provider rejected request')
  error.code = 'InvalidParameterValue.Url'
  const result = await loadTranscriber({ createError: error })({
    cloudFileID: 'cloud://env/recordings/sample.mp3',
    sourceType: 'audio',
    fileSize: 1024
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'InvalidParameterValue.Url')
  assert.equal(result.providerCode, 'InvalidParameterValue.Url')
  assert.match(result.asrErrorMessage, /provider rejected request/)
}))

test('rejects a known unsupported MOV container instead of submitting it blindly', () => withAsrEnv(async () => {
  const result = await loadTranscriber()({
    cloudFileID: 'cloud://env/videos/ios-device.mov',
    sourceType: 'video',
    fileSize: 4096
  })
  assert.equal(result.success, false)
  assert.equal(result.debugCode, 'ASR_UNSUPPORTED_FORMAT')
  assert.equal(result.fileExtension, 'mov')
}))
