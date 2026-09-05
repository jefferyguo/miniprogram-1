const { normalizeError, toError } = require('./error-normalizer')

function callCloudBaseModule({ featureName, moduleName, data = {}, timeoutMs = 15000 }) {
  const app = typeof getApp === 'function' ? getApp() : null
  const ready = app && typeof app.ensureCloudReady === 'function'
    ? app.ensureCloudReady()
    : Promise.resolve(true)

  return ready.then(() => new Promise((resolve, reject) => {
    if (!wx.cloud) {
      const err = new Error('当前基础库不支持 wx.cloud')
      console.warn(`[cloudbase_module][${moduleName}]`, err.message)
      reject(err)
      return
    }

    const startedAt = Date.now()
    let settled = false
    const dataKeys = data && typeof data === 'object' ? Object.keys(data) : []

    const finish = (type, payload) => {
      if (settled) return false
      settled = true
      clearTimeout(timer)

      const cost = Date.now() - startedAt
      const logPayload = {
        featureName,
        moduleName,
        costMs: cost,
        timeoutMs,
        dataKeys
      }

      if (type === 'success') {
        console.log(`[cloudbase_module][success] ${moduleName}`, {
          ...logPayload,
          hasResult: Boolean(payload)
        })
        resolve(payload)
      } else if (type === 'timeout') {
        console.error(`[cloudbase_module][timeout] ${moduleName}`, logPayload)
        reject(new Error(`${moduleName} timeout`))
      } else {
        const normalized = normalizeError(payload, 'cloud module failed')
        console.error(`[cloudbase_module][fail] ${moduleName}`, {
          ...logPayload,
          code: normalized.code || normalized.errCode,
          message: normalized.message,
          errMsg: normalized.errMsg,
          requestId: normalized.requestId
        })
        reject(toError(payload, normalized.message))
      }

      return true
    }

    console.log(`[cloudbase_module][start] ${moduleName}`, {
      featureName,
      moduleName,
      timeoutMs,
      dataKeys
    })

    const timer = setTimeout(() => {
      finish('timeout')
    }, timeoutMs)

    wx.cloud.callFunction({
      name: 'cloudbase_module',
      data: {
        name: moduleName,
        data
      },
      success: res => {
        finish('success', res)
      },
      fail: err => {
        finish('fail', err)
      }
    })
  }))
}

module.exports = {
  callCloudBaseModule
}
