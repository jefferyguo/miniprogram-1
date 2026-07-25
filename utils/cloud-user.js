const { callCloudBaseModule } = require('./cloudbase-module')

function getCurrentOpenId() {
  return new Promise((resolve) => {
    if (!wx.cloud) {
      console.warn('[cloud-user] openId 获取失败：当前基础库不支持 wx.cloud')
      resolve('')
      return
    }

    console.log('[cloud-user] 开始获取 openId')

    callCloudBaseModule({
      featureName: 'openId',
      moduleName: 'wx_user_get_open_id',
      timeoutMs: 15000
    }).then(res => {
      const openId =
        res.result?.openId ||
        res.result?.openid ||
        res.result?.result?.openId ||
        res.result?.result?.openid ||
        res.result?.result?.result?.openId ||
        res.result?.result?.result?.openid ||
        ''

      console.log('[cloud-user] openId 获取成功：', openId, res)
      resolve(openId)
    }).catch(err => {
      console.warn('[cloud-user] openId 获取失败：', err)
      resolve('')
    })
  })
}

function getPhoneNumberByCode(code) {
  return new Promise((resolve) => {
    if (!code || !wx.cloud) {
      resolve('')
      return
    }

    callCloudBaseModule({
      featureName: 'phoneNumber',
      moduleName: 'wx_user_get_phone_number',
      data: { code },
      timeoutMs: 15000
    }).then(res => {
      const phoneNumber =
        res.result?.phoneNumber ||
        res.result?.purePhoneNumber ||
        res.result?.result?.phoneNumber ||
        res.result?.result?.purePhoneNumber ||
        res.result?.result?.result?.phoneNumber ||
        res.result?.result?.result?.purePhoneNumber ||
        ''

      console.log('[cloud-user] 手机号获取结果：', phoneNumber ? `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}` : 'empty')
      resolve(phoneNumber)
    }).catch(err => {
      console.warn('[cloud-user] 手机号获取失败：', err)
      resolve('')
    })
  })
}

module.exports = {
  getCurrentOpenId,
  getPhoneNumberByCode
}
