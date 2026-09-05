const assert = require('node:assert/strict')
const test = require('node:test')

const voiceConsent = require('./voice-consent')

function createWxMock(options = {}) {
  const storage = new Map()
  const calls = []
  const wxMock = {
    getStorageSync(key) {
      calls.push(`getStorage:${key}`)
      return storage.get(key)
    },
    setStorageSync(key, value) {
      calls.push(`setStorage:${key}`)
      storage.set(key, value)
    },
    removeStorageSync(key) {
      calls.push(`removeStorage:${key}`)
      storage.delete(key)
    },
    getSetting({ success }) {
      calls.push('getSetting')
      success({ authSetting: { 'scope.record': options.systemPermission === true } })
    },
    authorize({ scope, success, fail }) {
      calls.push(`authorize:${scope}`)
      if (options.authorizeSuccess === false) fail({ errMsg: 'authorize:fail auth deny' })
      else success()
    },
    showModal() {
      calls.push('showModal')
    },
    showToast() {
      calls.push('showToast')
    },
    openSetting() {
      calls.push('openSetting')
    }
  }
  return { wxMock, storage, calls }
}

function createPage(consentDecision, calls) {
  return {
    selectComponent(selector) {
      calls.push(`selectComponent:${selector}`)
      return {
        requestConsent() {
          calls.push(`consentDecision:${consentDecision}`)
          return Promise.resolve(consentDecision)
        }
      }
    }
  }
}

test.beforeEach(() => {
  delete global.wx
})

test.after(() => {
  delete global.wx
})

test('声音授权默认未同意，且版本不匹配时无效', () => {
  const { wxMock, storage } = createWxMock()
  global.wx = wxMock

  assert.equal(voiceConsent.hasValidVoiceConsent(), false)
  storage.set(voiceConsent.VOICE_CONSENT_STORAGE_KEY, {
    accepted: true,
    version: 'old-version',
    acceptedAt: Date.now()
  })
  assert.equal(voiceConsent.hasValidVoiceConsent(), false)
})

test('未同意时不会请求系统麦克风权限', async () => {
  const { wxMock, calls } = createWxMock()
  global.wx = wxMock

  const allowed = await voiceConsent.ensureVoiceConsentAndMicPermission(createPage(false, calls))

  assert.equal(allowed, false)
  assert.equal(calls.includes('getSetting'), false)
  assert.equal(calls.some(item => item.startsWith('authorize:')), false)
})

test('主动同意后才保存记录并请求系统麦克风权限', async () => {
  const { wxMock, calls, storage } = createWxMock({ authorizeSuccess: true })
  global.wx = wxMock

  const allowed = await voiceConsent.ensureVoiceConsentAndMicPermission(createPage(true, calls))
  const record = storage.get(voiceConsent.VOICE_CONSENT_STORAGE_KEY)

  assert.equal(allowed, true)
  assert.equal(record.accepted, true)
  assert.equal(record.version, voiceConsent.VOICE_CONSENT_VERSION)
  assert.ok(record.acceptedAt > 0)
  assert.ok(calls.indexOf(`consentDecision:true`) < calls.indexOf('getSetting'))
  assert.ok(calls.indexOf(`setStorage:${voiceConsent.VOICE_CONSENT_STORAGE_KEY}`) < calls.indexOf('getSetting'))
  assert.ok(calls.includes('authorize:scope.record'))
})

test('同意业务授权但拒绝系统权限时仍阻止录制', async () => {
  const { wxMock, calls } = createWxMock({ authorizeSuccess: false })
  global.wx = wxMock

  const allowed = await voiceConsent.ensureVoiceConsentAndMicPermission(createPage(true, calls))

  assert.equal(allowed, false)
  assert.ok(calls.includes('authorize:scope.record'))
  assert.ok(calls.includes('showModal'))
})

test('撤回后授权记录失效，下次必须重新确认', () => {
  const { wxMock } = createWxMock()
  global.wx = wxMock

  voiceConsent.acceptVoiceConsent()
  assert.equal(voiceConsent.hasValidVoiceConsent(), true)

  voiceConsent.withdrawVoiceConsent()
  assert.equal(voiceConsent.hasValidVoiceConsent(), false)
})
