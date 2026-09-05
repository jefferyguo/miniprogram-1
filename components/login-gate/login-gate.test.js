'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const GATE_PATH = path.join(__dirname, 'login-gate.js')

function createWx() {
  const calls = { hideLoading: 0, loading: [], toast: [] }
  return {
    calls,
    wx: {
      hideLoading() { calls.hideLoading += 1 },
      navigateTo() {},
      showLoading(options) { calls.loading.push(options) },
      showToast(options) { calls.toast.push(options) }
    }
  }
}

function loadGate(options = {}) {
  const originalLoad = Module._load
  const originalComponent = global.Component
  let definition = null
  global.Component = config => { definition = config }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === GATE_PATH) {
      if (request === '../../utils/phone-auth') {
        return { bindPhoneWithCode: options.bindPhoneWithCode || (async () => ({})) }
      }
      if (request === '../../utils/access-control') {
        return { getCurrentUser: options.getCurrentUser || (() => options.user || {}) }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(GATE_PATH)]
    require(GATE_PATH)
  } finally {
    Module._load = originalLoad
    global.Component = originalComponent
  }

  assert.ok(definition, 'login-gate component should register')
  const instance = {
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch) }
  }
  Object.entries(definition.methods).forEach(([name, method]) => {
    instance[name] = method.bind(instance)
  })
  return instance
}

async function withWx(fn) {
  const originalWx = global.wx
  const env = createWx()
  global.wx = env.wx
  try {
    await fn(env)
  } finally {
    global.wx = originalWx
  }
}

test('A 未勾选协议点击登录会明确提示', async () => {
  await withWx(async env => {
    const gate = loadGate()
    gate.open({})
    gate.onPrivacyRequired()
    assert.equal(env.calls.toast.at(-1).title, '请先阅读并同意用户服务协议和隐私政策')
  })
})

test('唯一 getPhoneNumber 按钮只绑定原生回调，不混绑普通 tap', () => {
  const wxml = fs.readFileSync(path.join(__dirname, 'login-gate.wxml'), 'utf8')
  const nativeButton = (wxml.match(/<button[\s\S]*?<\/button>/g) || [])
    .find(block => block.includes('open-type="getPhoneNumber"'))
  assert.ok(nativeButton, 'getPhoneNumber button should exist')
  assert.match(nativeButton, /bind(?::)?getphonenumber="onGetPhoneNumber"/)
  assert.doesNotMatch(nativeButton, /bindtap=/, 'native phone button must not mutate state in a competing tap handler')
})

test('B 拒绝手机号会恢复状态、提示并允许再次点击', async () => {
  await withWx(async env => {
    let attempts = 0
    const gate = loadGate({ bindPhoneWithCode: async () => { attempts += 1 } })
    gate.open({})
    gate.setData({ privacyAgreed: true, waitingNativePhoneAuth: true })

    await gate.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
    assert.equal(gate.data.waitingNativePhoneAuth, false)
    assert.equal(gate.data.phoneBinding, false)
    assert.equal(env.calls.toast.at(-1).title, '已取消手机号授权，请重试')

    await gate.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-code' } })
    assert.equal(attempts, 1)
  })
})

test('C getPhoneNumber 成功会继续真实登录调用', async () => {
  await withWx(async () => {
    const codes = []
    const gate = loadGate({ bindPhoneWithCode: async code => { codes.push(code) } })
    gate.open({})
    gate.setData({ privacyAgreed: true })
    await gate.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'one-time-phone-code' } })
    assert.deepEqual(codes, ['one-time-phone-code'])
  })
})

test('D 云函数 reject 后结束 loading、提示并可重试', async () => {
  await withWx(async env => {
    let attempts = 0
    const gate = loadGate({
      bindPhoneWithCode: async () => {
        attempts += 1
        if (attempts === 1) throw Object.assign(new Error('internal stack detail'), { code: 'CLOUD_CALL_FAILED' })
      }
    })
    gate.open({})
    gate.setData({ privacyAgreed: true })

    await gate.onGetPhoneNumber({ detail: { code: 'first-code' } })
    assert.equal(gate.data.phoneBinding, false)
    assert.equal(env.calls.hideLoading, 1)
    assert.equal(env.calls.toast.at(-1).title, '登录失败，请重试')

    await gate.onGetPhoneNumber({ detail: { code: 'second-code' } })
    assert.equal(attempts, 2)
    assert.equal(gate.data.visible, false)
  })
})

test('E 登录成功会关闭 gate 并发布最新用户状态', async () => {
  await withWx(async () => {
    const user = { _id: 'new-user', phoneBound: true, profileCompleted: true }
    let callbackUser = null
    let closeResult = null
    const gate = loadGate({ user, bindPhoneWithCode: async () => ({ user }) })
    gate.open({
      onPhoneBound(value) { callbackUser = value },
      onClose(value) { closeResult = value }
    })
    gate.setData({ privacyAgreed: true })
    await gate.onGetPhoneNumber({ detail: { code: 'success-code' } })
    assert.equal(gate.data.visible, false)
    assert.equal(callbackUser, user)
    assert.deepEqual(closeResult, { phoneBound: true, cancelled: false })
  })
})

test('F 全新用户云调用悬挂会超时恢复，而不是永久 loading', async () => {
  const phoneAuthPath = path.join(ROOT, 'utils/phone-auth.js')
  const originalLoad = Module._load
  const originalWx = global.wx
  global.wx = createWx().wx
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === phoneAuthPath) {
      if (request === './cloud-api') {
        return { bindPhoneByCode: () => new Promise(() => {}), getMe: async () => ({}) }
      }
      if (request === './access-control') {
        return {
          getCurrentUser: () => ({}),
          maskPhone: value => value,
          saveCurrentUser: value => value
        }
      }
      if (request === './auth') {
        return { isPhoneBound: () => false, setUserInfo() {} }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(phoneAuthPath)]
    const { bindPhoneWithCode } = require(phoneAuthPath)
    const outcome = await Promise.race([
      bindPhoneWithCode('fresh-user-code', { timeoutMs: 5 }).then(
        () => 'resolved',
        error => error && error.code
      ),
      new Promise(resolve => setTimeout(() => resolve('still-pending'), 50))
    ])
    assert.equal(outcome, 'PHONE_LOGIN_TIMEOUT')
  } finally {
    Module._load = originalLoad
    global.wx = originalWx
    delete require.cache[require.resolve(phoneAuthPath)]
  }
})
