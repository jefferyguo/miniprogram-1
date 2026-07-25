const { formatDateTime } = require('./local-data')

const STUDENT_USERS_KEY = 'studentUsers'

function getStorageList() {
  const list = wx.getStorageSync(STUDENT_USERS_KEY) || []
  return Array.isArray(list) ? list : []
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'

  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function buildMemberFields(memberStatus = {}) {
  return {
    isMember: Boolean(memberStatus.isMember),
    memberType: memberStatus.memberType || 'free',
    memberExpireAt: memberStatus.expireAt || '',
    memberSource: memberStatus.source || 'none'
  }
}

function getStudentUsers() {
  return getStorageList()
}

function setStudentUsers(list) {
  const nextList = Array.isArray(list) ? list : []
  wx.setStorageSync(STUDENT_USERS_KEY, nextList)
  return nextList
}

function getStudentUserByOpenid(openid) {
  if (!openid) return null
  return getStudentUsers().find(item => item.openid === openid) || null
}

function upsertStudentUser(userInfo = {}, memberStatus = {}) {
  const openid = userInfo.openid || ''
  if (!openid) return null

  const now = formatDateTime()
  const nickname = userInfo.nickname || userInfo.nickName || '同学'
  const avatarText = userInfo.avatarText || getAvatarText(nickname)
  const list = getStudentUsers()
  const current = list.find(item => item.openid === openid)
  const memberFields = buildMemberFields(memberStatus)

  if (!current) {
    const nextUser = {
      openid,
      nickname,
      avatarText,
      avatarUrl: userInfo.avatarUrl || '',
      nicknameSource: userInfo.nicknameSource || 'default',
      role: 'student',
      currentClass: userInfo.currentClass || null,
      firstLoginAt: now,
      lastLoginAt: now,
      loginCount: 1,
      source: userInfo.loginType || 'wechat-openid',
      ...memberFields
    }

    setStudentUsers([nextUser].concat(list))
    return nextUser
  }

  const nextList = list.map(item => (
    item.openid === openid
      ? {
        ...item,
        nickname,
        avatarText,
        avatarUrl: userInfo.avatarUrl || item.avatarUrl || '',
        nicknameSource: userInfo.nicknameSource || item.nicknameSource || 'default',
        role: 'student',
        currentClass: userInfo.currentClass || null,
        firstLoginAt: item.firstLoginAt || now,
        lastLoginAt: now,
        loginCount: Number(item.loginCount || 0) + 1,
        source: userInfo.loginType || item.source || 'wechat-openid',
        ...memberFields
      }
      : item
  ))
  const nextUser = nextList.find(item => item.openid === openid) || null

  setStudentUsers(nextList)
  return nextUser
}

function updateStudentUserMemberStatus(openid, memberStatus = {}) {
  if (!openid) return null

  const list = getStudentUsers()
  const memberFields = buildMemberFields(memberStatus)
  let nextUser = null
  const nextList = list.map(item => {
    if (item.openid !== openid) return item

    nextUser = {
      ...item,
      ...memberFields
    }
    return nextUser
  })

  setStudentUsers(nextList)
  return nextUser
}

module.exports = {
  STUDENT_USERS_KEY,
  getStudentUsers,
  setStudentUsers,
  upsertStudentUser,
  getStudentUserByOpenid,
  updateStudentUserMemberStatus,
  getAvatarText
}
