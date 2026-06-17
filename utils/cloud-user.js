const { callCloudBaseModule } = require('./cloudbase-module')

function getCurrentOpenId() {
  return new Promise((resolve) => {
    if (!wx.cloud) {
      console.warn('当前基础库不支持 wx.cloud')
      resolve('')
      return
    }

    callCloudBaseModule({
      featureName: 'openId',
      moduleName: 'wx_user_get_open_id',
      timeoutMs: 15000
    }).then(res => {
      console.log('openId 获取结果：', res)

      const openId =
        res.result?.openId ||
        res.result?.result?.openId ||
        res.result?.result?.result?.openId ||
        ''

      resolve(openId)
    }).catch(err => {
      console.warn('openId 获取失败：', err)
      resolve('')
    })
  })
}

module.exports = {
  getCurrentOpenId
}
