const VOICE_CONSENT_STORAGE_KEY = 'voiceConsentRecord'
const VOICE_CONSENT_VERSION = '2026-08-10'

function getWxApi() {
  return typeof wx !== 'undefined' ? wx : null
}

function getVoiceConsentRecord() {
  const wxApi = getWxApi()
  if (!wxApi || typeof wxApi.getStorageSync !== 'function') return null

  try {
    const record = wxApi.getStorageSync(VOICE_CONSENT_STORAGE_KEY)
    return record && typeof record === 'object' ? record : null
  } catch (error) {
    console.warn('[voice-consent] 读取授权记录失败:', error)
    return null
  }
}

function hasValidVoiceConsent() {
  const record = getVoiceConsentRecord()
  return Boolean(
    record &&
    record.accepted === true &&
    record.version === VOICE_CONSENT_VERSION &&
    Number(record.acceptedAt) > 0
  )
}

function acceptVoiceConsent() {
  const wxApi = getWxApi()
  if (!wxApi || typeof wxApi.setStorageSync !== 'function') return null

  const record = {
    accepted: true,
    version: VOICE_CONSENT_VERSION,
    acceptedAt: Date.now()
  }
  wxApi.setStorageSync(VOICE_CONSENT_STORAGE_KEY, record)
  return record
}

function withdrawVoiceConsent() {
  const wxApi = getWxApi()
  if (!wxApi || typeof wxApi.removeStorageSync !== 'function') return
  wxApi.removeStorageSync(VOICE_CONSENT_STORAGE_KEY)
}

function requestVoiceConsent(page) {
  if (hasValidVoiceConsent()) return Promise.resolve(true)

  const wxApi = getWxApi()
  const modal = page && typeof page.selectComponent === 'function'
    ? page.selectComponent('#voice-consent-modal')
    : null

  if (!modal || typeof modal.requestConsent !== 'function') {
    console.error('[voice-consent] 未找到声音授权组件，已阻止采集声音')
    if (wxApi && typeof wxApi.showToast === 'function') {
      wxApi.showToast({ title: '声音授权组件暂不可用，请稍后重试', icon: 'none' })
    }
    return Promise.resolve(false)
  }

  return modal.requestConsent()
    .then(accepted => {
      if (accepted !== true) return false
      acceptVoiceConsent()
      return hasValidVoiceConsent()
    })
    .catch(error => {
      console.error('[voice-consent] 声音授权确认失败:', error)
      return false
    })
}

function ensureMicrophonePermission() {
  const wxApi = getWxApi()
  if (!wxApi || typeof wxApi.getSetting !== 'function' || typeof wxApi.authorize !== 'function') {
    return Promise.resolve(false)
  }

  return new Promise(resolve => {
    wxApi.getSetting({
      success: setting => {
        const authSetting = setting && setting.authSetting || {}
        if (authSetting['scope.record'] === true) {
          resolve(true)
          return
        }

        wxApi.authorize({
          scope: 'scope.record',
          success: () => resolve(true),
          fail: () => {
            resolve(false)
            wxApi.showModal({
              title: '需要麦克风权限',
              content: '需要开启麦克风权限后才能录制训练声音。',
              confirmText: '去设置',
              success: result => {
                if (result.confirm && typeof wxApi.openSetting === 'function') wxApi.openSetting()
              }
            })
          }
        })
      },
      fail: () => {
        resolve(false)
        wxApi.showToast({ title: '麦克风权限检查失败，请重试', icon: 'none' })
      }
    })
  })
}

async function ensureVoiceConsentAndMicPermission(page) {
  const consentAccepted = await requestVoiceConsent(page)
  if (!consentAccepted) return false
  return ensureMicrophonePermission()
}

module.exports = {
  VOICE_CONSENT_STORAGE_KEY,
  VOICE_CONSENT_VERSION,
  acceptVoiceConsent,
  ensureMicrophonePermission,
  ensureVoiceConsentAndMicPermission,
  getVoiceConsentRecord,
  hasValidVoiceConsent,
  requestVoiceConsent,
  withdrawVoiceConsent
}
