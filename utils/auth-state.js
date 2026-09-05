const INVALID_NICKNAMES = ['同学', '微信用户', '游客', '未登录用户']

function normalizeNickname(value) {
  return String(value || '').trim()
}

function isValidNickname(value, maxLength = 16) {
  const nickname = normalizeNickname(value)
  if (!nickname || INVALID_NICKNAMES.includes(nickname)) return false
  return Array.from(nickname).length <= maxLength
}

function hasStableServerUserId(user = null) {
  if (!user || typeof user !== 'object') return false
  // openid 缓存不作为可信的服务端用户记录凭据。
  return Boolean(user._id || user.userId || user.serverUserId)
}

function isAuthenticatedUser(user = null) {
  if (!user || typeof user !== 'object') return false
  if (!hasStableServerUserId(user)) return false
  if (user.profileCompleted !== true) return false
  if (!isValidNickname(user.nickname || user.nickName)) return false
  const source = String(user.nicknameSource || '').trim()
  if (!source || source === 'default') return false
  const phone = String(user.phone || '').replace(/\D/g, '')
  return user.phoneBound === true && /^1\d{10}$/.test(phone)
}

function isPhoneBoundUser(user = null) {
  return isAuthenticatedUser(user)
}

function getAuthLevel(user = null) {
  return isAuthenticatedUser(user) ? 2 : 0
}

module.exports = {
  INVALID_NICKNAMES,
  getAuthLevel,
  hasStableServerUserId,
  isAuthenticatedUser,
  isPhoneBoundUser,
  isValidNickname,
  normalizeNickname
}
