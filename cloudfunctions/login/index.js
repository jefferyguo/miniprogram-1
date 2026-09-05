const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const INVALID_NICKNAMES = new Set(['', '同学', '微信用户', '默认用户', '游客', '未登录用户'])

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function maskPhone(value) {
  const phone = normalizePhone(value)
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
}

function isRestorableUser(user) {
  if (!user || !user._id) return false
  const phone = normalizePhone(user.phone)
  const nickname = String(user.nickname || '').trim()
  return user.phoneBound === true &&
    /^1\d{10}$/.test(phone) &&
    user.profileCompleted === true &&
    !INVALID_NICKNAMES.has(nickname)
}

function sanitizeUser(user) {
  const phone = normalizePhone(user.phone)
  return {
    _id: user._id,
    serverUserId: user._id,
    nickname: user.nickname,
    nicknameSource: user.nicknameSource || 'random',
    avatarUrl: user.avatarUrl || '',
    avatarSource: user.avatarSource || '',
    avatarText: user.avatarText || String(user.nickname || '').slice(0, 1) || '同',
    phone,
    phoneMasked: user.phoneMasked || maskPhone(phone),
    phoneBound: true,
    phoneBoundAt: user.phoneBoundAt || '',
    phoneAuthorizedAt: user.phoneAuthorizedAt || '',
    profileCompleted: true,
    membershipType: user.membershipType || 'free',
    membershipStatus: user.membershipStatus || 'active',
    membershipStartAt: user.membershipStartAt || '',
    membershipEndAt: user.membershipEndAt == null ? null : user.membershipEndAt,
    role: user.role || 'user',
    isAdmin: user.isAdmin === true,
    aiDailyLimit: user.aiDailyLimit,
    aiMonthlyLimit: user.aiMonthlyLimit,
    isLogin: true,
    isLoggedIn: true
  }
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = String(wxContext.OPENID || '')
  if (!openid) {
    return {
      success: false,
      authenticated: false,
      code: 'OPENID_UNAVAILABLE',
      message: '暂时无法恢复登录状态。'
    }
  }

  const result = await db.collection('users').where({ openid }).limit(1).get()
  const user = result.data && result.data[0] || null
  if (!isRestorableUser(user)) {
    return {
      success: true,
      authenticated: false,
      code: 'GUEST',
      user: null
    }
  }

  return {
    success: true,
    authenticated: true,
    user: sanitizeUser(user)
  }
}
