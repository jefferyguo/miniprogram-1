'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  getUserErrorMessage,
  normalizeError,
  redactSensitiveText
} = require('./error-normalizer')

test('Error 保留 message、name 和 stack', () => {
  const result = normalizeError(new Error('test error'))
  assert.equal(result.message, 'test error')
  assert.equal(result.name, 'Error')
  assert.match(result.stack, /test error/)
})

test('微信和 CloudBase error 保留结构化字段', () => {
  assert.equal(normalizeError({ errMsg: 'cloud.callFunction:fail xxx' }).errMsg, 'cloud.callFunction:fail xxx')
  const asr = normalizeError({ code: 'ASR_EMPTY_RESULT', message: '没有识别结果', requestId: 'request-1' })
  assert.equal(asr.code, 'ASR_EMPTY_RESULT')
  assert.equal(asr.message, '没有识别结果')
  assert.equal(asr.requestId, 'request-1')
  const result = normalizeError({ errCode: -1, errMsg: 'request:fail', errno: 600001, requestId: 'request-2' })
  assert.equal(result.errCode, -1)
  assert.equal(result.errno, 600001)
  assert.equal(result.requestId, 'request-2')
})

test('普通 Object 和循环 Object 不会变成 [object Object] 或导致上报崩溃', () => {
  const plain = normalizeError({ reason: 'plain failure', nested: { state: 'failed' } })
  assert.notEqual(plain.message, '[object Object]')
  assert.match(JSON.stringify(plain.details), /plain failure/)

  const circular = { errMsg: 'circular failure' }
  circular.self = circular
  const normalized = normalizeError(circular)
  assert.equal(normalized.message, 'circular failure')
  assert.doesNotThrow(() => JSON.stringify(normalized))
})

test('用户提示优先选择 errMsg/message/msg/code 且保持简洁', () => {
  assert.equal(getUserErrorMessage({ errMsg: 'wx.request:fail timeout' }), 'wx.request:fail timeout')
  assert.equal(getUserErrorMessage({ message: '业务失败', code: 'BIZ_FAIL' }), '业务失败')
  assert.equal(getUserErrorMessage({ code: 'ASR_EMPTY_RESULT' }), 'ASR_EMPTY_RESULT')
  assert.equal(getUserErrorMessage({ reason: 'unknown object' }, '操作失败'), '操作失败')
})

test('结构化错误日志会脱敏字段和嵌入字符串中的凭证/隐私标识', () => {
  const normalized = normalizeError({
    accessToken: 'raw-token',
    message: 'request failed access_token=raw-token phone=13800138000',
    openid: 'o6zAJszM6Cn6QeqxmMAMCazV62G8'
  })
  assert.equal(normalized.details.accessToken, '[hidden]')
  assert.equal(normalized.details.openid, '[hidden]')
  assert.doesNotMatch(JSON.stringify(normalized), /raw-token|13800138000|o6zAJszM6Cn6QeqxmMAMCazV62G8/)
  assert.equal(redactSensitiveText('token: abc123'), 'token: [hidden]')
})

test('App 全局捕获 Promise rejection Object 并使用统一 normalizeError', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  assert.match(appSource, /onUnhandledRejection\s*\(/)
  assert.match(appSource, /normalizeError\(/)
})

test('云函数 fail Object 在 Promise 边界转换为 Error 并保留微信字段', async () => {
  const previousWx = global.wx
  const previousGetApp = global.getApp
  global.getApp = () => ({ ensureCloudReady: () => Promise.resolve(true) })
  global.wx = {
    cloud: {
      callFunction: () => Promise.reject({
        errCode: -501000,
        errMsg: 'cloud.callFunction:fail function error',
        requestId: 'cloud-request-1'
      })
    }
  }
  try {
    const { callCloudApi } = require('./cloud-api')
    await assert.rejects(callCloudApi('testObjectFailure', {}, { showLog: false }), error => {
      assert.equal(error instanceof Error, true)
      assert.equal(error.message, 'cloud.callFunction:fail function error')
      assert.equal(error.errCode, -501000)
      assert.equal(error.requestId, 'cloud-request-1')
      return true
    })
  } finally {
    global.wx = previousWx
    global.getApp = previousGetApp
  }
})

test('cloudbase module callback fail Object 不再作为裸 Object reject', async () => {
  const previousWx = global.wx
  const previousGetApp = global.getApp
  global.getApp = () => ({ ensureCloudReady: () => Promise.resolve(true) })
  global.wx = {
    cloud: {
      callFunction(options) {
        options.fail({ errMsg: 'cloudbase module failed', errno: 600001 })
      }
    }
  }
  try {
    const { callCloudBaseModule } = require('./cloudbase-module')
    await assert.rejects(callCloudBaseModule({ featureName: 'test', moduleName: 'test_module' }), error => {
      assert.equal(error instanceof Error, true)
      assert.equal(error.message, 'cloudbase module failed')
      assert.equal(error.errno, 600001)
      return true
    })
  } finally {
    global.wx = previousWx
    global.getApp = previousGetApp
  }
})
