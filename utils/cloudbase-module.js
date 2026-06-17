function callCloudBaseModule({ featureName, moduleName, data = {}, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      const err = new Error('当前基础库不支持 wx.cloud')
      console.warn(`[cloudbase_module][${moduleName}]`, err.message)
      reject(err)
      return
    }

    const startedAt = Date.now()
    let settled = false

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
        data
      }

      if (type === 'success') {
        console.log(`[cloudbase_module][success] ${moduleName}`, logPayload, payload)
        resolve(payload)
      } else if (type === 'timeout') {
        console.error(`[cloudbase_module][timeout] ${moduleName}`, logPayload)
        reject(new Error(`${moduleName} timeout`))
      } else {
        console.error(`[cloudbase_module][fail] ${moduleName}`, logPayload, payload)
        reject(payload)
      }

      return true
    }

    console.log(`[cloudbase_module][start] ${moduleName}`, {
      featureName,
      moduleName,
      timeoutMs,
      data
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
  })
}

module.exports = {
  callCloudBaseModule
}
