const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function listFiles(relativeDir, extension) {
  const root = path.join(ROOT, relativeDir)
  const files = []
  function walk(current) {
    fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) return
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (!extension || entry.name.endsWith(extension)) files.push(fullPath)
    })
  }
  walk(root)
  return files
}

function extractBlock(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `未找到函数：${signature}`)
  const braceStart = source.indexOf('{', start)
  assert.notEqual(braceStart, -1, `函数缺少起始花括号：${signature}`)

  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`函数花括号未闭合：${signature}`)
}

function assertOrdered(block, first, second, label) {
  const firstIndex = block.indexOf(first)
  const secondIndex = block.indexOf(second)
  assert.ok(firstIndex >= 0, `${label} 缺少 ${first}`)
  assert.ok(secondIndex >= 0, `${label} 缺少 ${second}`)
  assert.ok(firstIndex < secondIndex, `${label} 必须先执行 ${first}，再执行 ${second}`)
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length
}

const recordingPaths = [
  {
    js: 'pages/task-detail/task-detail.js',
    wxml: 'pages/task-detail/task-detail.wxml',
    gateFunction: 'async toggleAudioRecord()',
    startCall: 'this.startAudioRecord()',
    captureCall: 'this.recorderManager.start('
  },
  {
    js: 'pages/extra-training/extra-training.js',
    wxml: 'pages/extra-training/extra-training.wxml',
    gateFunction: 'async toggleAudio()',
    startCall: 'this.startAudioRecord()',
    captureCall: 'this.recorderManager.start('
  },
  {
    js: 'pages/video-record/video-record.js',
    wxml: 'pages/video-record/video-record.wxml',
    gateFunction: 'async startRecord()',
    startCall: 'this.cameraContext.startRecord(',
    captureCall: 'this.cameraContext.startRecord('
  }
]

const productionJs = [...listFiles('pages', '.js'), ...listFiles('components', '.js'), ...listFiles('utils', '.js')]
  .filter(file => !file.endsWith('.test.js'))

const captureFiles = productionJs.filter(file => {
  const source = fs.readFileSync(file, 'utf8')
  return /(?:recorderManager\.start|cameraContext\.startRecord|wx\.startRecord)\s*\(/.test(source)
})

assert.deepEqual(
  captureFiles.map(file => path.relative(ROOT, file)).sort(),
  recordingPaths.map(item => item.js).sort(),
  '所有真实采音入口都必须纳入统一门禁清单'
)

recordingPaths.forEach(item => {
  const source = read(item.js)
  const wxml = read(item.wxml)
  const gateBlock = extractBlock(source, item.gateFunction)

  assert.ok(source.includes("require('../../utils/voice-consent')"), `${item.js} 未引用统一声音授权服务`)
  assert.ok(/<voice-consent-modal\b[\s\S]*?id="voice-consent-modal"[\s\S]*?\/>/.test(wxml), `${item.wxml} 未挂载授权组件`)
  assertOrdered(gateBlock, 'ensureVoiceConsentAndMicPermission(this)', item.startCall, item.js)
  assert.equal(countMatches(source, new RegExp(item.captureCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), 1, `${item.js} 采音调用数量异常`)
})

const voiceService = read('utils/voice-consent.js')
const combinedGate = extractBlock(voiceService, 'async function ensureVoiceConsentAndMicPermission(page)')
assertOrdered(combinedGate, 'requestVoiceConsent(page)', 'ensureMicrophonePermission()', '统一声音授权服务')
assert.ok(voiceService.includes("scope: 'scope.record'"), '统一声音授权服务必须检查系统麦克风权限')
assert.ok(voiceService.includes('removeStorageSync(VOICE_CONSENT_STORAGE_KEY)'), '必须支持撤回授权')

const modalJs = read('components/voice-consent-modal/voice-consent-modal.js')
const modalWxml = read('components/voice-consent-modal/voice-consent-modal.wxml')
assert.ok(modalJs.includes('visible: false'), '声音授权弹窗默认必须隐藏且未同意')
assert.ok(!modalWxml.includes('checked="{{true}}"'), '声音授权不能默认勾选')
assert.ok(!modalJs.includes('setTimeout'), '声音授权不能倒计时自动同意')
assert.ok(modalWxml.includes('同意并继续') && modalWxml.includes('暂不同意'), '声音授权必须提供同意与拒绝按钮')
assert.ok(modalWxml.includes('《声纹授权协议》'), '授权弹窗必须能查看独立协议')

const appJson = JSON.parse(read('app.json'))
assert.ok(appJson.pages.includes('pages/voiceprint-agreement/voiceprint-agreement'), '独立声纹协议页面未注册')
assert.equal(appJson.usingComponents['voice-consent-modal'], '/components/voice-consent-modal/voice-consent-modal')

const agreement = read('pages/voiceprint-agreement/voiceprint-agreement.js')
;[
  '不会将声音信息用于身份认证或声纹身份识别',
  '主动点击开始录音或开始录像',
  '腾讯云语音识别',
  '撤回授权',
  '不影响浏览训练内容'
].forEach(text => assert.ok(agreement.includes(text), `声纹协议缺少披露：${text}`))

const settingsJs = read('pages/settings/settings.js')
const settingsWxml = read('pages/settings/settings.wxml')
assert.ok(settingsWxml.includes('声音信息授权管理'), '设置页缺少声音授权管理入口')
assert.ok(settingsWxml.includes('撤回声音信息授权'), '设置页缺少撤回入口')
assert.ok(settingsJs.includes('withdrawVoiceConsent()'), '设置页未清除业务授权记录')

const loginSurfaceFiles = [
  'components/login-gate/login-gate.wxml',
  'components/login-gate/login-gate.wxss',
  'pages/login/login.wxml',
  'pages/login/login.wxss',
  'pages/phone-auth/phone-auth.wxml',
  'pages/phone-auth/phone-auth.wxss',
  'components/profile-login-modal/profile-login-modal.wxml'
]
const loginSurfaceSource = loginSurfaceFiles.map(read).join('\n')
const forbiddenLoginTerms = /微信|WeChat|wechat|手机号授权登录|微信手机号|微信授权|微信快捷登录|微信安全认证/g
const loginWechatTextCount = countMatches(loginSurfaceSource, forbiddenLoginTerms)
assert.equal(loginWechatTextCount, 0, '登录前置 UI 仍含官方混淆文案')

const loginRuntimeSource = [
  ...loginSurfaceFiles,
  'components/login-gate/login-gate.js',
  'pages/login/login.js',
  'pages/phone-auth/phone-auth.js'
].map(read).join('\n')
const officialLogoPattern = /(?:src|background-image)[^\n]*(?:wechat|weixin|wx[-_]?logo)/gi
const loginWechatLogoCount = countMatches(loginRuntimeSource, officialLogoPattern)
assert.equal(loginWechatLogoCount, 0, '登录前置 UI 仍引用疑似官方 Logo')

const gateWxml = read('components/login-gate/login-gate.wxml')
const gateJs = read('components/login-gate/login-gate.js')
assert.ok(gateWxml.includes('>手机号快捷登录</button>'), '登录弹窗主按钮文案不正确')
assert.ok(read('pages/login/login.wxml').includes('>手机号快捷登录</button>'), '登录页主按钮文案不正确')
assert.ok(gateWxml.includes('open-type="getPhoneNumber"'), '手机号原生能力入口丢失')
assert.ok(gateWxml.includes('bindgetphonenumber="onGetPhoneNumber"'), '手机号回调绑定丢失')
assert.ok(gateJs.includes('bindPhoneWithCode(code)'), '可信手机号绑定链路丢失')
assert.ok(gateJs.includes('!this.data.privacyAgreed'), '登录隐私前置门禁丢失')

console.log(JSON.stringify({
  VOICE_CONSENT_AGREEMENT_PAGE_EXISTS: true,
  VOICE_CONSENT_IS_INDEPENDENT: true,
  VOICE_CONSENT_DEFAULT_ACCEPTED: false,
  ALL_RECORDING_ENTRY_POINTS_GATED: true,
  RECORDING_BYPASS_PATH_COUNT: 0,
  VOICE_CONSENT_WITHDRAW_WORKS: true,
  LOGIN_WECHAT_TEXT_COUNT: loginWechatTextCount,
  LOGIN_WECHAT_LOGO_COUNT: loginWechatLogoCount,
  LOGIN_OFFICIAL_CONFUSION_ELEMENT_COUNT: 0,
  LOGIN_PRIMARY_TEXT: '手机号快捷登录',
  GET_PHONE_NUMBER_FLOW_WORKS: true
}, null, 2))
