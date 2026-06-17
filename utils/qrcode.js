const { callCloudBaseModule } = require('./cloudbase-module')

function extractQrUrl(res) {
  const raw =
    res.result?.result?.buffer ||
    res.result?.result?.url ||
    res.result?.buffer ||
    res.result?.url ||
    res.result?.result ||
    ''

  if (!raw) return ''

  if (typeof raw === 'string') {
    return raw
  }

  function bytesToBase64(bytes) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let result = ''

    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i]
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0
      const hasB = i + 1 < bytes.length
      const hasC = i + 2 < bytes.length
      const triple = (a << 16) | (b << 8) | c

      result += chars[(triple >> 18) & 63]
      result += chars[(triple >> 12) & 63]
      result += hasB ? chars[(triple >> 6) & 63] : '='
      result += hasC ? chars[triple & 63] : '='
    }

    return result
  }

  const arrayBufferToBase64 = (buffer) => {
    if (!buffer) return ''

    if (typeof wx.arrayBufferToBase64 === 'function') {
      return wx.arrayBufferToBase64(buffer)
    }

    const bytes = new Uint8Array(buffer)
    return bytesToBase64(bytes)
  }

  if (raw instanceof ArrayBuffer) {
    const base64 = arrayBufferToBase64(raw)
    return base64 ? `data:image/png;base64,${base64}` : ''
  }

  if (ArrayBuffer.isView(raw)) {
    const base64 = arrayBufferToBase64(raw.buffer)
    return base64 ? `data:image/png;base64,${base64}` : ''
  }

  return raw
}

function generateTeacherLoginQr() {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持 wx.cloud'))
      return
    }

    callCloudBaseModule({
      featureName: 'teacher-login-qrcode',
      moduleName: 'wx_qrcode_get_qrcode',
      timeoutMs: 20000,
      data: {
        path: 'pages/teacher-login/teacher-login?from=teacher_qr',
        width: 430,
        auto_color: false,
        line_color: { r: 0, g: 0, b: 0 },
        is_hyaline: false,
        env_version: 'trial'
      }
    }).then(res => {
      console.log('老师端入口二维码生成结果：', res)
      const qrUrl = extractQrUrl(res)
      if (qrUrl) {
        resolve(qrUrl)
      } else {
        reject(new Error('二维码结果为空'))
      }
    }).catch(err => {
      console.error('老师端入口二维码生成失败：', err)
      reject(err)
    })
  })
}

function generateClassJoinQr(classCode) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持 wx.cloud'))
      return
    }

    if (!classCode) {
      reject(new Error('缺少班级码'))
      return
    }

    callCloudBaseModule({
      featureName: 'class-join-qrcode',
      moduleName: 'wx_qrcode_get_unlimited_qrcode',
      timeoutMs: 20000,
      data: {
        scene: `c_${classCode}`,
        page: 'pages/join-class/join-class',
        check_path: false,
        env_version: 'trial',
        width: 430,
        auto_color: false,
        line_color: { r: 0, g: 0, b: 0 },
        is_hyaline: false
      }
    }).then(res => {
      console.log('班级二维码生成结果：', res)
      const qrUrl = extractQrUrl(res)
      if (qrUrl) {
        resolve(qrUrl)
      } else {
        reject(new Error('二维码结果为空'))
      }
    }).catch(err => {
      console.error('班级二维码生成失败：', err)
      reject(err)
    })
  })
}

module.exports = {
  generateTeacherLoginQr,
  generateClassJoinQr
}
