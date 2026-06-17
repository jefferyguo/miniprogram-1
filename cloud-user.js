// utils/cloud-user.js

// 获取当前微信用户 openId
function getCurrentOpenId() {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'cloudbase_module',
      data: {
        name: 'wx_user_get_open_id'
      },
      success: (res) => {
        console.log('openId 获取结果：', res)

        const openId =
          res.result?.openId ||
          res.result?.result?.openId ||
          ''

        resolve(openId)
      },
      fail: (err) => {
        console.warn('openId 获取失败：', err)
        resolve('')
      }
    })
  })
}

module.exports = {
  getCurrentOpenId
}