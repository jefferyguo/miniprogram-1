#!/usr/bin/env node

/*
 * 手机号即登录最终验收脚本。
 *
 * 仅做静态/单元验证，不连接微信开发者工具、不触发真实手机号授权、
 * 不访问云数据库，也不修改生产云。真机/体验版项目登记在 manualItems。
 */

const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const file = relative => path.join(ROOT, relative)

const CHECK_ITEMS = [
  ['01', 'unit', 'auth-state 只有 Guest 与手机号用户两态'],
  ['02', 'unit', '旧 Level 1 缓存回 Guest'],
  ['03', 'unit', '有效手机号用户为 Level 2'],
  ['04', 'unit', 'openid-only 缓存不算登录'],
  ['05', 'unit', '占位昵称不算登录'],
  ['06', 'unit', '非法手机号不算登录'],
  ['07', 'static', 'auth.js 注释声明两态模型'],
  ['08', 'unit', 'isLoggedIn 兼容接口等价手机号绑定'],
  ['09', 'unit', 'requireLogin 未登录打开 Level 2 流程'],
  ['10', 'unit', 'requirePhoneBound 默认 manual_retry'],
  ['11', 'unit', 'manual_retry 不保留高风险 callback'],
  ['12', 'unit', 'safe_navigation 才可执行 callback'],
  ['13', 'unit', '登录流程锁防双开'],
  ['14', 'unit', '关闭后可以重新打开'],
  ['15', 'unit', '旧隐藏 session 会释放'],
  ['16', 'static', 'login-gate 只呈现手机号登录'],
  ['17', 'static', 'login-gate 使用 getPhoneNumber'],
  ['18', 'static', 'login-gate 不再要求昵称步骤'],
  ['19', 'unit', '手机号授权缺 code 保持游客'],
  ['20', 'unit', '手机号授权成功关闭并回调'],
  ['21', 'unit', 'PHONE_ALREADY_BOUND 前端契约提示'],
  ['22', 'unit', '手机号绑定中禁止关闭'],
  ['23', 'static', 'phone-auth 只调用 bindPhoneByCode'],
  ['24', 'unit', 'applyPhoneBindingResult 写入 Level 2 缓存'],
  ['25', 'unit', 'applyPhoneBindingResult 不泄露完整手机号到 phoneMasked'],
  ['26', 'static', 'bindPhoneByCode 客户端 payload 只有 code/action'],
  ['27', 'static', '客户端绑定手机号不传 openid'],
  ['28', 'static', '客户端绑定手机号不传手机号'],
  ['29', 'static', 'updateMyProfile 客户端不传 openid'],
  ['30', 'static', 'updateMyProfile 客户端不传手机号'],
  ['31', 'static', 'cloudApi 使用 WXContext openid'],
  ['32', 'static', 'bindPhoneByCode 调微信 phonenumber openapi'],
  ['33', 'static', '旧明文手机号 action 被禁用'],
  ['34', 'static', '服务端手机号格式校验'],
  ['35', 'static', 'PHONE_ALREADY_BOUND 服务端冲突检测'],
  ['36', 'static', 'PHONE_ALREADY_BOUND 返回 debugCode'],
  ['37', 'static', '服务端手机号冲突日志只打 mask'],
  ['38', 'static', '服务端成功日志只打 mask'],
  ['39', 'static', '服务端随机用户名前缀正确'],
  ['40', 'static', '服务端随机用户名使用 6 位安全字母表'],
  ['41', 'static', '服务端唯一用户名查重'],
  ['42', 'static', '服务端随机用户名重试上限'],
  ['43', 'static', '服务端占位昵称集合完整'],
  ['44', 'static', '服务端保留有效昵称'],
  ['45', 'static', '服务端占位昵称替换为随机名'],
  ['46', 'static', '手机号登录写入 profileCompleted'],
  ['47', 'static', '手机号登录写入 phoneBound'],
  ['48', 'static', '手机号登录写入稳定文档 id'],
  ['49', 'static', 'login 云函数只从 WXContext 恢复身份'],
  ['50', 'static', 'login 云函数 Guest 返回 authenticated=false'],
  ['51', 'static', 'login 云函数只恢复 Level 2 用户'],
  ['52', 'unit', 'server 随机用户名格式单元验证'],
  ['53', 'unit', '迁移占位判断覆盖空/同学/微信用户/游客'],
  ['54', 'unit', '迁移脚本不改有效昵称'],
  ['55', 'unit', '迁移脚本对占位昵称生成 patch'],
  ['56', 'unit', '迁移 dry-run 幂等：已迁移随机名不再计划'],
  ['57', 'unit', '迁移计划对重复随机名做二次避让'],
  ['58', 'unit', '迁移日志脱敏 openid/_id/手机号'],
  ['59', 'unit', '迁移 --apply 要求 --env'],
  ['60', 'unit', '迁移 --apply 要求 --backup'],
  ['61', 'unit', '迁移 --apply 要求 confirm env 完全一致'],
  ['62', 'unit', '迁移 --apply 要求环境变量确认'],
  ['63', 'unit', '迁移默认 dry-run 不触云'],
  ['64', 'static', 'cloud-api 调用日志脱敏 code/openid/id/token'],
  ['65', 'static', 'cloud-api 结果日志脱敏手机号'],
  ['66', 'static', '云函数 catch 不返回 stack'],
  ['67', 'static', '高风险动作默认 manual_retry 文案存在'],
  ['68', 'static', 'requirePhoneBound manual_retry 不重放 callback'],
  ['69', 'static', 'safe_navigation 仅用于安全刷新'],
  ['70', 'static', 'Mine 登录状态 phoneBound 只在认证后有效'],
  ['71', 'static', 'app 启动清理旧 openid/token 缓存'],
  ['72', 'static', 'app 不在启动时强制登录'],
  ['73', 'static', '审计 README 明确真机未验证项'],
  ['74', 'static', '审计 README 明确未访问生产云']
]

const MANUAL_ITEMS = [
  ['M01', '真机微信昵称建议条不再作为必需入口'],
  ['M02', '真机 getPhoneNumber 同意授权获得 code'],
  ['M03', '真机 getPhoneNumber 拒绝/取消保持游客态'],
  ['M04', '全新微信账号冷启动首次点登录的真实云身份'],
  ['M05', '真实手机号已绑定其他微信账号的端到端冲突'],
  ['M06', '体验版手机号授权后会员权益真实匹配'],
  ['M07', '弱网下原生授权面板返回时序'],
  ['M08', 'iOS 微信键盘和弹层遮挡'],
  ['M09', 'Android 微信授权弹层返回状态'],
  ['M10', '正式环境 users 迁移实际 apply 演练'],
  ['M11', '生产云数据只读抽样审计']
]

const tests = []

function test(id, name, fn) {
  tests.push({ id, name, fn })
}

function source(relative) {
  return fs.readFileSync(file(relative), 'utf8')
}

function between(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle)
  assert(start >= 0, `missing start: ${startNeedle}`)
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : text.length
  assert(end >= 0, `missing end: ${endNeedle}`)
  return text.slice(start, end)
}

function freshRequire(relative) {
  const target = file(relative)
  delete require.cache[require.resolve(target)]
  return require(target)
}

function makeWx(initialStorage = {}, overrides = {}) {
  const storage = { ...initialStorage }
  const calls = {
    toast: [],
    loading: [],
    callFunction: []
  }
  const wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
    removeStorageSync(key) { delete storage[key] },
    showToast(options) { calls.toast.push(options) },
    showLoading(options) { calls.loading.push(options) },
    hideLoading() {},
    navigateTo() {},
    cloud: {
      callFunction(options) {
        calls.callFunction.push(options)
        return Promise.resolve({ result: { success: true } })
      },
      uploadFile() {
        return Promise.resolve({ fileID: 'cloud://avatar' })
      }
    },
    ...overrides
  }
  return { wx, storage, calls }
}

function withGlobals(env, fn) {
  const oldWx = global.wx
  const oldGetApp = global.getApp
  const oldGetCurrentPages = global.getCurrentPages
  const restore = () => {
    global.wx = oldWx
    global.getApp = oldGetApp
    global.getCurrentPages = oldGetCurrentPages
  }
  global.wx = env.wx
  global.getApp = env.getApp || env.wx.getApp || (() => ({ globalData: {} }))
  global.getCurrentPages = env.getCurrentPages || env.wx.getCurrentPages || (() => [])
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function createGateComponent() {
  const opens = []
  const component = {
    data: { visible: false },
    open(options) {
      this.data.visible = true
      opens.push(options)
    },
    abortSession() {
      this.data.visible = false
    }
  }
  return { component, opens }
}

function loadLoginGate(options = {}) {
  const gatePath = file('components/login-gate/login-gate.js')
  const originalLoad = Module._load
  let captured = null
  global.Component = config => { captured = config }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === gatePath) {
      if (request === '../../utils/phone-auth') {
        return {
          bindPhoneWithCode: options.bindPhoneWithCode || (async () => ({}))
        }
      }
      if (request === '../../utils/access-control') {
        return {
          getCurrentUser: options.getCurrentUser || (() => ({ _id: 'server-user', nickname: '口才学员ABC234', phone: '13800000000', phoneBound: true }))
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(gatePath)]
    require(gatePath)
  } finally {
    Module._load = originalLoad
    delete global.Component
  }
  assert(captured, 'login-gate 未注册 Component')
  const instance = {
    data: { ...captured.data },
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
  Object.keys(captured.methods).forEach(name => {
    instance[name] = captured.methods[name].bind(instance)
  })
  return instance
}

function loadPhoneAuthWithStubs(options = {}) {
  const phoneAuthPath = file('utils/phone-auth.js')
  const originalLoad = Module._load
  const currentUser = options.currentUser || {}
  const storage = options.storage || {}
  const accessStub = {
    getCurrentUser: () => currentUser,
    maskPhone: phone => {
      const digits = String(phone || '').replace(/\D/g, '')
      return digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : ''
    },
    saveCurrentUser: user => {
      Object.assign(storage, { userInfo: user })
      return user
    }
  }
  const authStub = {
    setUserInfo: user => {
      storage.authUserInfo = user
    },
    isPhoneBound: () => false,
    requirePhoneBound: () => false
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === phoneAuthPath) {
      if (request === './cloud-api') {
        return {
          bindPhoneByCode: async () => ({}),
          getMe: async () => ({})
        }
      }
      if (request === './access-control') return accessStub
      if (request === './auth') return authStub
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(phoneAuthPath)]
    return require(phoneAuthPath)
  } finally {
    Module._load = originalLoad
  }
}

function assertNoRawSecrets(text, secrets) {
  secrets.forEach(secret => {
    assert(!String(text).includes(secret), `日志泄露敏感值：${secret}`)
  })
}

test('01', 'auth-state 只有 Guest 与手机号用户两态', () => {
  const authState = freshRequire('utils/auth-state.js')
  assert.strictEqual(authState.getAuthLevel(null), 0)
  assert.strictEqual(authState.getAuthLevel({ _id: 'u1', nickname: '张同学', nicknameSource: 'custom', profileCompleted: true }), 0)
  assert.strictEqual(authState.getAuthLevel({ _id: 'u1', nickname: '张同学', nicknameSource: 'custom', profileCompleted: true, phoneBound: true, phone: '13800000000' }), 2)
})

test('02', '旧 Level 1 缓存回 Guest', () => {
  const authState = freshRequire('utils/auth-state.js')
  const oldLevel1 = { _id: 'legacy-user', nickname: '老用户', nicknameSource: 'custom', profileCompleted: true, isLogin: true }
  assert.strictEqual(authState.isAuthenticatedUser(oldLevel1), false)
  assert.strictEqual(authState.getAuthLevel(oldLevel1), 0)
})

test('03', '有效手机号用户为 Level 2', () => {
  const authState = freshRequire('utils/auth-state.js')
  assert.strictEqual(authState.getAuthLevel({ _id: 'u', nickname: '有效用户', nicknameSource: 'random', profileCompleted: true, phoneBound: true, phone: '13812345678' }), 2)
})

test('04', 'openid-only 缓存不算登录', () => {
  const authState = freshRequire('utils/auth-state.js')
  assert.strictEqual(authState.getAuthLevel({ openid: 'openid-raw', nickname: '有效用户', nicknameSource: 'custom', profileCompleted: true, phoneBound: true, phone: '13812345678' }), 0)
})

test('05', '占位昵称不算登录', () => {
  const authState = freshRequire('utils/auth-state.js')
  assert.strictEqual(authState.getAuthLevel({ _id: 'u', nickname: '同学', nicknameSource: 'default', profileCompleted: true, phoneBound: true, phone: '13812345678' }), 0)
})

test('06', '非法手机号不算登录', () => {
  const authState = freshRequire('utils/auth-state.js')
  assert.strictEqual(authState.getAuthLevel({ _id: 'u', nickname: '有效用户', nicknameSource: 'custom', profileCompleted: true, phoneBound: true, phone: '12345' }), 0)
})

test('07', 'auth.js 注释声明两态模型', () => {
  assert(source('utils/auth.js').includes('只有两种对外状态：游客（Level 0）与手机号已验证用户（Level 2）'))
})

test('08', 'isLoggedIn 兼容接口等价手机号绑定', () => {
  const env = makeWx({ userInfo: { _id: 'u', nickname: '有效用户', nicknameSource: 'custom', profileCompleted: true, phoneBound: true, phone: '13812345678' } })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    assert.strictEqual(auth.isLoggedIn(), true)
    assert.strictEqual(auth.isPhoneBound(), true)
  })
})

test('09', 'requireLogin 未登录打开 Level 2 流程', () => {
  const gate = createGateComponent()
  const page = { route: 'pages/test/test', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    assert.strictEqual(auth.requireLogin(() => {}), false)
    assert.strictEqual(gate.opens[0].targetLevel, 2)
    assert.strictEqual(gate.opens[0].requirePhone, true)
  })
})

test('10', 'requirePhoneBound 默认 manual_retry', () => {
  const gate = createGateComponent()
  const page = { route: 'pages/test/test', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    auth.requirePhoneBound(() => { throw new Error('must not be captured') }, { actionName: '生成 AI 点评' })
    assert.strictEqual(gate.opens[0].targetLevel, 2)
  })
})

test('11', 'manual_retry 不保留高风险 callback', async () => {
  const gate = createGateComponent()
  let replayed = 0
  const page = { route: 'pages/test/test', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  await withGlobals(env, async () => {
    const auth = freshRequire('utils/auth.js')
    auth.requirePhoneBound(() => { replayed += 1 }, { actionName: '发布广场' })
    gate.opens[0].onPhoneBound({ _id: 'u', phoneBound: true, phone: '13812345678' })
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.strictEqual(replayed, 0)
  })
})

test('12', 'safe_navigation 才可执行 callback', async () => {
  const gate = createGateComponent()
  let replayed = 0
  const page = { route: 'pages/mine/mine', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  await withGlobals(env, async () => {
    const auth = freshRequire('utils/auth.js')
    auth.requirePhoneBound(() => { replayed += 1 }, { resumePolicy: 'safe_navigation' })
    gate.opens[0].onPhoneBound({ _id: 'u', phoneBound: true, phone: '13812345678' })
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.strictEqual(replayed, 1)
  })
})

test('13', '登录流程锁防双开', () => {
  const gate = createGateComponent()
  const page = { route: 'pages/test/test', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    auth.startUnifiedAuthFlow()
    const second = auth.startUnifiedAuthFlow()
    assert.strictEqual(second.code, 'ALREADY_OPEN')
    assert.strictEqual(gate.opens.length, 1)
  })
})

test('14', '关闭后可以重新打开', () => {
  const gate = createGateComponent()
  const page = { route: 'pages/test/test', selectComponent: () => gate.component }
  const env = makeWx({}, {
    getCurrentPages: () => [page]
  })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    auth.startUnifiedAuthFlow()
    gate.opens[0].onClose({ phoneBound: false, cancelled: true })
    gate.component.data.visible = false
    const second = auth.startUnifiedAuthFlow()
    assert.strictEqual(second.opened, true)
  })
})

test('15', '旧隐藏 session 会释放', () => {
  const first = createGateComponent()
  let pages = [{ route: 'first', selectComponent: () => first.component }]
  const env = makeWx({}, { getCurrentPages: () => pages })
  withGlobals(env, () => {
    const auth = freshRequire('utils/auth.js')
    auth.startUnifiedAuthFlow()
    first.component.data.visible = false
    const second = createGateComponent()
    pages = [{ route: 'second', selectComponent: () => second.component }]
    const result = auth.startUnifiedAuthFlow()
    assert.strictEqual(result.opened, true)
    assert.strictEqual(second.opens.length, 1)
  })
})

test('16', 'login-gate 只呈现手机号登录', () => {
  const js = source('components/login-gate/login-gate.js')
  assert(js.includes("const { bindPhoneWithCode } = require('../../utils/phone-auth')"))
  assert(!js.includes('loginWithProfile'))
})

test('17', 'login-gate 使用 getPhoneNumber', () => {
  assert(source('components/login-gate/login-gate.wxml').includes('open-type="getPhoneNumber"'))
})

test('18', 'login-gate 不再要求昵称步骤', () => {
  const js = source('components/login-gate/login-gate.js')
  assert(!/chooseWechatNickname|confirmUsername|nicknameDraft|customNickname/.test(js))
})

test('19', '手机号授权缺 code 保持游客并明确提示', async () => {
  const env = makeWx()
  await withGlobals(env, async () => {
    const gate = loadLoginGate()
    gate.open({})
    gate.setData({ privacyAgreed: true })
    await gate.onGetPhoneNumber({ detail: {} })
    assert.strictEqual(gate.data.visible, true)
    assert.strictEqual(env.calls.toast[0].title, '手机号授权失败，请重试')
  })
})

test('20', '手机号授权成功关闭并回调', async () => {
  const env = makeWx()
  let bound = 0
  let closed = 0
  await withGlobals(env, async () => {
    const gate = loadLoginGate({
      bindPhoneWithCode: async code => {
        assert.strictEqual(code, 'phone-code')
        return {}
      }
    })
    gate.open({
      onPhoneBound: () => { bound += 1 },
      onClose: result => {
        closed += 1
        assert.strictEqual(result.phoneBound, true)
      }
    })
    gate.setData({ privacyAgreed: true })
    await gate.onGetPhoneNumber({ detail: { code: 'phone-code' } })
    assert.strictEqual(gate.data.visible, false)
    assert.strictEqual(bound, 1)
    assert.strictEqual(closed, 1)
  })
})

test('21', 'PHONE_ALREADY_BOUND 前端契约提示', async () => {
  const env = makeWx()
  await withGlobals(env, async () => {
    const gate = loadLoginGate({
      bindPhoneWithCode: async () => {
        const error = new Error('该手机号已绑定其他账号。')
        error.code = 'PHONE_ALREADY_BOUND'
        throw error
      }
    })
    gate.open({})
    gate.setData({ privacyAgreed: true })
    await gate.onGetPhoneNumber({ detail: { code: 'phone-code' } })
    assert.strictEqual(env.calls.toast.at(-1).title, '该手机号已绑定其他账号')
  })
})

test('22', '手机号绑定中禁止关闭', () => {
  const env = makeWx()
  withGlobals(env, () => {
    const gate = loadLoginGate()
    gate.open({ onClose: () => { throw new Error('must not close') } })
    gate.setData({ phoneBinding: true })
    gate.close()
    assert.strictEqual(gate.data.visible, true)
  })
})

test('23', 'phone-auth 只调用 bindPhoneByCode', () => {
  const js = source('utils/phone-auth.js')
  assert(js.includes('const { bindPhoneByCode, getMe }'))
  assert(!/bindPhoneAndGetAccess\(/.test(js))
})

test('24', 'applyPhoneBindingResult 写入 Level 2 缓存', () => {
  const env = makeWx({ userInfo: { _id: 'u', nickname: '旧名' } })
  withGlobals(env, () => {
    const stubStorage = {}
    const phoneAuth = loadPhoneAuthWithStubs({
      currentUser: { _id: 'u', nickname: '旧名' },
      storage: stubStorage
    })
    const user = phoneAuth.applyPhoneBindingResult({
      userProfile: { _id: 'u', nickname: '口才学员ABC234', nicknameSource: 'random', profileCompleted: true, phone: '13812345678', phoneBound: true },
      membershipProfile: { membershipType: 'free', membershipStatus: 'active' }
    })
    assert.strictEqual(user.phoneBound, true)
    assert.strictEqual(env.storage.loginState.phoneBound, true)
    assert.strictEqual(stubStorage.authUserInfo.phoneBound, true)
  })
})

test('25', 'applyPhoneBindingResult 不泄露完整手机号到 phoneMasked', () => {
  const env = makeWx()
  withGlobals(env, () => {
    const phoneAuth = loadPhoneAuthWithStubs()
    const user = phoneAuth.applyPhoneBindingResult({
      userProfile: { _id: 'u', nickname: '口才学员ABC234', nicknameSource: 'random', profileCompleted: true, phone: '13812345678', phoneBound: true }
    })
    assert.strictEqual(user.phoneMasked, '138****5678')
  })
})

test('26', 'bindPhoneByCode 客户端 payload 只有 code/action', () => {
  const js = source('utils/cloud-api.js')
  const block = between(js, 'function bindPhoneByCode(code)', 'function updateMyProfile')
  assert(block.includes("callCloudApi('bindPhoneByCode', { code }"))
})

test('27', '客户端绑定手机号不传 openid', () => {
  const block = between(source('utils/cloud-api.js'), 'function bindPhoneByCode(code)', 'function updateMyProfile')
  assert(!/openid|openId/.test(block))
})

test('28', '客户端绑定手机号不传手机号', () => {
  const block = between(source('utils/cloud-api.js'), 'function bindPhoneByCode(code)', 'function updateMyProfile')
  assert(!/\b(phone|mobile|phoneNumber)\b/.test(block.replace(/bindPhoneByCode/g, '')))
})

test('29', 'updateMyProfile 客户端不传 openid', () => {
  const block = between(source('utils/cloud-api.js'), 'function updateMyProfile(profile = {})', 'function adminCreateStudent')
  assert(!/openid|openId/.test(block))
})

test('30', 'updateMyProfile 客户端不传手机号', () => {
  const block = between(source('utils/cloud-api.js'), 'function updateMyProfile(profile = {})', 'function adminCreateStudent')
  assert(!/\b(phone|mobile|phoneNumber)\b/.test(block))
})

test('31', 'cloudApi 使用 WXContext openid', () => {
  const js = source('cloudfunctions/cloudApi/index.js')
  assert(js.includes('const wxContext = cloud.getWXContext()'))
  assert(js.includes('wxContext.OPENID'))
})

test('32', 'bindPhoneByCode 调微信 phonenumber openapi', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function bindPhoneByCode', 'async function bindPhoneAndGetAccess')
  assert(block.includes('cloud.openapi.phonenumber.getPhoneNumber'))
})

test('33', '旧明文手机号 action 被禁用', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function bindPhoneAndGetAccess', 'async function adminCreateStudent')
  assert(block.includes("fail('PHONE_CODE_REQUIRED'"))
  assert(!block.includes('bindPhoneInternal(event.phone'))
})

test('34', '服务端手机号格式校验', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function bindPhoneInternal', 'async function updateMyProfile')
  assert(block.includes("!/^1\\d{10}$/.test(phone)"))
})

test('35', 'PHONE_ALREADY_BOUND 服务端冲突检测', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function upsertPhoneAuthenticatedUser', 'async function syncAdminMembershipForUser')
  assert(block.includes(".where(_.or([{ phone }, { phoneNormalized: phone }]))"))
  assert(block.includes('item.openid !== openid'))
  assert(block.includes("code: 'PHONE_ALREADY_BOUND'"))
})

test('36', 'PHONE_ALREADY_BOUND 返回 debugCode', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function bindPhoneInternal', 'async function updateMyProfile')
  assert(block.includes("fail('PHONE_ALREADY_BOUND'"))
  assert(block.includes("debugCode: 'PHONE_ALREADY_BOUND'"))
})

test('37', '服务端手机号冲突日志只打 mask', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), "console.warn('[cloudApi] phone login conflict:'", "return fail('PHONE_ALREADY_BOUND'")
  assert(block.includes('phoneMasked: maskPhone(phone)'))
  assert(!/[\s,{]phone\s*:/.test(block))
})

test('38', '服务端成功日志只打 mask', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), "console.log('[cloudApi] phone bound:'", 'return success({')
  assert(block.includes('phoneMasked: maskPhone(phone)'))
})

test('39', '服务端随机用户名前缀正确', () => {
  assert(source('cloudfunctions/cloudApi/index.js').includes("const SERVER_USERNAME_PREFIX = '口才学员'"))
})

test('40', '服务端随机用户名使用 6 位安全字母表', () => {
  const js = source('cloudfunctions/cloudApi/index.js')
  assert(js.includes("const SERVER_USERNAME_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'"))
  assert(js.includes('crypto.randomBytes(6)'))
})

test('41', '服务端唯一用户名查重', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function createUniqueServerUsername', 'function getStableUserDocumentId')
  assert(block.includes('.where({ nickname })'))
  assert(block.includes('return nickname'))
})

test('42', '服务端随机用户名重试上限', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function createUniqueServerUsername', 'function getStableUserDocumentId')
  assert(block.includes('attempt < 20'))
  assert(block.includes('USERNAME_GENERATION_FAILED'))
})

test('43', '服务端占位昵称集合完整', () => {
  const js = source('cloudfunctions/cloudApi/index.js')
  ;['同学', '微信用户', '默认用户', '游客', '未登录用户'].forEach(name => assert(js.includes(name)))
})

test('44', '服务端保留有效昵称', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function upsertPhoneAuthenticatedUser', 'async function syncAdminMembershipForUser')
  assert(block.includes('keepNickname'))
  assert(block.includes('currentUser.nicknameSource'))
})

test('45', '服务端占位昵称替换为随机名', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'async function upsertPhoneAuthenticatedUser', 'async function syncAdminMembershipForUser')
  assert(block.includes('await createUniqueServerUsername(transaction)'))
  assert(block.includes("nicknameSource = keepNickname"))
})

test('46', '手机号登录写入 profileCompleted', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'const payload = {', 'if (currentUser && currentUser._id)')
  assert(block.includes('profileCompleted: true'))
})

test('47', '手机号登录写入 phoneBound', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'const payload = {', 'if (currentUser && currentUser._id)')
  assert(block.includes('phoneBound: true'))
})

test('48', '手机号登录写入稳定文档 id', () => {
  const block = between(source('cloudfunctions/cloudApi/index.js'), 'const documentId = currentUser && currentUser._id || getStableUserDocumentId(openid)', 'return {\n      user: { _id: documentId')
  assert(block.includes('users.doc(documentId).set'))
})

test('49', 'login 云函数只从 WXContext 恢复身份', () => {
  const js = source('cloudfunctions/login/index.js')
  assert(js.includes('cloud.getWXContext()'))
  assert(!/event\.(openid|openId)/.test(js))
})

test('50', 'login 云函数 Guest 返回 authenticated=false', () => {
  const js = source('cloudfunctions/login/index.js')
  assert(js.includes("code: 'GUEST'"))
  assert(js.includes('authenticated: false'))
})

test('51', 'login 云函数只恢复 Level 2 用户', () => {
  const block = between(source('cloudfunctions/login/index.js'), 'function isRestorableUser', 'function sanitizeUser')
  assert(block.includes('user.phoneBound === true'))
  assert(block.includes('user.profileCompleted === true'))
  assert(block.includes('!INVALID_NICKNAMES.has(nickname)'))
})

test('52', 'server 随机用户名格式单元验证', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const username = migration.createServerRandomUsername(() => Buffer.from([0, 1, 2, 3, 4, 5]))
  assert(/^口才学员[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(username))
})

test('53', '迁移占位判断覆盖空/同学/微信用户/游客', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  ;['', '同学', '微信用户', '微信用户123', '游客', '游客9', '未登录用户'].forEach(name => {
    assert.strictEqual(migration.isPlaceholderNickname(name), true)
  })
  assert.strictEqual(migration.isPlaceholderNickname('真实用户'), false)
})

test('54', '迁移脚本不改有效昵称', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  assert.strictEqual(migration.buildNicknamePatch({ nickname: '真实用户' }), null)
})

test('55', '迁移脚本对占位昵称生成 patch', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const patch = migration.buildNicknamePatch({
    nickname: '同学'
  }, {
    now: '2026-07-29T00:00:00.000Z',
    nextNickname: '口才学员ABC234'
  })
  assert.strictEqual(patch.nickname, '口才学员ABC234')
  assert.strictEqual(patch.nicknameSource, 'random')
  assert.strictEqual(patch.nicknameMigratedFromPlaceholder, true)
  assert.strictEqual(migration.auditUsers([{ nickname: '同学', phoneBound: false }]).plannedCount, 0)
  assert.strictEqual(migration.auditUsers([{ nickname: '同学', phoneBound: true, phone: '13812345678', role: 'admin' }]).plannedCount, 0)
})

test('56', '迁移 dry-run 幂等：已迁移随机名不再计划', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const first = migration.auditUsers([{ _id: 'id-1', openid: 'openid-1', phone: '13812345678', phoneBound: true, nickname: '同学' }], {
    nextNickname: '口才学员ABC234',
    now: '2026-07-29T00:00:00.000Z'
  })
  const second = migration.auditUsers([{ _id: 'id-1', openid: 'openid-1', phone: '13812345678', phoneBound: true, nickname: first.planned[0].patch.nickname }])
  assert.strictEqual(second.plannedCount, 0)
})

test('57', '迁移计划对重复随机名做二次避让', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const values = [Buffer.from([0, 1, 2, 3, 4, 5]), Buffer.from([6, 7, 8, 9, 10, 11])]
  const plan = migration.auditUsers([
    { _id: 'id-0', nickname: '口才学员ABCDEF' },
    { _id: 'id-1', phone: '13812345678', phoneBound: true, nickname: '同学' }
  ], {
    randomBytes: () => values.shift() || Buffer.from([12, 13, 14, 15, 16, 17])
  })
  assert.strictEqual(plan.plannedCount, 1)
  assert.notStrictEqual(plan.planned[0].patch.nickname, '口才学员ABCDEF')
})

test('58', '迁移日志脱敏 openid/_id/手机号', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const raw = { _id: 'full-user-id-123456', openid: 'full-openid-abcdef', phone: '13812345678', phoneBound: true, nickname: '同学' }
  const log = JSON.stringify(migration.auditUsers([raw], { nextNickname: '口才学员ABC234' }))
  assertNoRawSecrets(log, ['full-user-id-123456', 'full-openid-abcdef', '13812345678'])
  assert(log.includes('138****5678'))
  assert(!log.includes('full-user-id-'))
  assert(!log.includes('full-openid-'))
})

test('59', '迁移 --apply 要求 --env', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  assert.throws(() => migration.assertApplyGuards({ apply: true, backup: 'x.json', confirmEnv: 'dev' }), /--env/)
})

test('60', '迁移 --apply 要求 --backup', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  assert.throws(() => migration.assertApplyGuards({ apply: true, env: 'dev', confirmEnv: 'dev' }), /--backup/)
})

test('61', '迁移 --apply 要求 confirm env 完全一致', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  assert.throws(() => migration.assertApplyGuards({ apply: true, env: 'dev-a', confirmEnv: 'dev-b', backup: 'x.json' }), /完全一致/)
})

test('62', '迁移 --apply 要求环境变量确认', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const old = process.env.USERS_NICKNAME_MIGRATION_CONFIRM
  delete process.env.USERS_NICKNAME_MIGRATION_CONFIRM
  try {
    assert.throws(() => migration.assertApplyGuards({ apply: true, env: 'dev', confirmEnv: 'dev', backup: 'x.json' }), /USERS_NICKNAME_MIGRATION_CONFIRM/)
  } finally {
    if (old === undefined) delete process.env.USERS_NICKNAME_MIGRATION_CONFIRM
    else process.env.USERS_NICKNAME_MIGRATION_CONFIRM = old
  }
})

test('63', '迁移默认 dry-run 不触云', () => {
  const migration = freshRequire('scripts/audit-users-placeholder-nicknames.js')
  const args = migration.parseArgs([])
  assert.strictEqual(args.apply, false)
})

test('64', 'cloud-api 调用日志脱敏 code/openid/id/token', () => {
  const js = source('utils/cloud-api.js')
  const block = between(js, 'function sanitizeLogData', 'function callCloudApi')
  ;['code', 'openid', '_id', 'userid', 'token'].forEach(key => assert(block.toLowerCase().includes(key)))
})

test('65', 'cloud-api 结果日志脱敏手机号', () => {
  const block = between(source('utils/cloud-api.js'), 'function sanitizeLogData', 'function callCloudApi')
  assert(block.includes("lowerKey.includes('phone')"))
  assert(block.includes("`${phone.slice(0, 3)}****${phone.slice(-4)}`"))
})

test('66', '云函数 catch 不返回 stack', () => {
  const js = source('cloudfunctions/cloudApi/index.js')
  const tail = js.slice(js.lastIndexOf("console.error('[cloudApi] error:"))
  assert(!/stack\s*:/.test(tail))
})

test('67', '高风险动作默认 manual_retry 文案存在', () => {
  assert(source('utils/auth.js').includes('登录成功，请再次点击原操作'))
})

test('68', 'requirePhoneBound manual_retry 不重放 callback', () => {
  const block = between(source('utils/auth.js'), 'function requirePhoneBound', 'function resetLoginGate')
  assert(block.includes("resumePolicy === 'safe_navigation' ? callback : null"))
})

test('69', 'safe_navigation 仅用于安全刷新', () => {
  const block = between(source('utils/auth.js'), 'function runSafeAction', 'function finishSession')
  assert(block.includes("session.resumePolicy !== 'safe_navigation'"))
})

test('70', 'Mine 登录状态 phoneBound 只在认证后有效', () => {
  const js = source('pages/mine/mine.js')
  assert(js.includes('phoneBound 只在 isAuthenticated=true 时有效'))
  assert(js.includes('const phoneBound = isAuthenticated && rawPhoneBound'))
})

test('71', 'app 启动清理旧 openid/token 缓存', () => {
  const js = source('app.js')
  ;['token', 'sessionToken', 'openid', 'openId'].forEach(key => assert(js.includes(`'${key}'`)))
})

test('72', 'app 不在启动时强制登录', () => {
  assert(source('app.js').includes('登录只在用户点击功能入口后触发，不在启动时强制登录'))
})

test('73', '审计 README 明确真机未验证项', () => {
  const readme = source('data/audit/phone-login-final-20260729/README.md')
  assert(readme.includes('未能静态/单元验证'))
  assert(readme.includes('真机'))
})

test('74', '审计 README 明确未访问生产云', () => {
  const readme = source('data/audit/phone-login-final-20260729/README.md')
  assert(readme.includes('未访问生产云'))
})

function validateManifest() {
  assert.strictEqual(CHECK_ITEMS.length, 74)
  const ids = new Set(CHECK_ITEMS.map(item => item[0]))
  assert.strictEqual(ids.size, 74)
  tests.forEach(item => {
    assert(ids.has(item.id), `测试 ${item.id} 未登记在 CHECK_ITEMS`)
  })
}

async function main() {
  validateManifest()
  const startedAt = Date.now()
  const failures = []
  let passed = 0

  for (const item of tests) {
    try {
      await item.fn()
      passed += 1
      console.log(`PASS ${item.id} ${item.name}`)
    } catch (error) {
      failures.push({ item, error })
      console.error(`FAIL ${item.id} ${item.name}`)
      console.error(error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : error)
    }
  }

  const executableItems = CHECK_ITEMS.filter(item => item[1] !== 'manual')
  console.log('')
  console.log(`手机号即登录 final 静态/单元验证：${passed}/${tests.length} 通过，耗时 ${Date.now() - startedAt}ms`)
  console.log(`登记项目：${CHECK_ITEMS.length} 项；本脚本可执行 ${executableItems.length} 项；真机/体验版待验证 ${MANUAL_ITEMS.length} 项。`)
  console.log('MANUAL_ITEMS ' + JSON.stringify(MANUAL_ITEMS.map(item => ({ id: item[0], title: item[1] }))))

  if (failures.length) {
    console.error(`失败 ${failures.length} 项：`)
    failures.forEach(({ item }) => console.error(`- ${item.id} ${item.name}`))
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}

module.exports = {
  CHECK_ITEMS,
  MANUAL_ITEMS
}
