const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async () => {
  const wxContext = cloud.getWXContext()

  return {
    success: true,
    user: {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID || '',
      nickname: '同学',
      role: 'student',
      isLoggedIn: true,
      loginAt: Date.now()
    }
  }
}
