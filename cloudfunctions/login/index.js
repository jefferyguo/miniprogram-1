const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function now() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'
  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

async function upsertUser(openid, profile = {}) {
  const existed = await db.collection('users').where({ openid }).limit(1).get()
  const oldUser = existed.data && existed.data[0]
  const incomingNickname = String(profile.nickname || profile.nickName || '').trim()
  const incomingSource = profile.nicknameSource || (incomingNickname ? 'wechat' : 'default')
  const keepManual = oldUser && oldUser.nicknameSource === 'manual' && incomingSource !== 'manual'
  const nickname = keepManual
    ? oldUser.nickname
    : (incomingNickname || (oldUser && oldUser.nickname) || '同学')
  const nicknameSource = keepManual
    ? 'manual'
    : (incomingNickname ? incomingSource : ((oldUser && oldUser.nicknameSource) || 'default'))
  const incomingAvatar = String(profile.avatarUrl || '').trim()
  const incomingAvatarSource = profile.avatarSource || (incomingAvatar ? 'wechat' : 'default')
  const keepManualAvatar = oldUser && oldUser.avatarSource === 'manual' && incomingAvatarSource !== 'manual'
  const avatarUrl = keepManualAvatar
    ? oldUser.avatarUrl
    : (incomingAvatar || (oldUser && oldUser.avatarUrl) || '')
  const avatarSource = keepManualAvatar
    ? 'manual'
    : (incomingAvatar ? incomingAvatarSource : ((oldUser && oldUser.avatarSource) || 'default'))
  const loginTime = now()
  const phoneBound = Boolean(oldUser && oldUser.phoneBound === true && /^1\d{10}$/.test(String(oldUser.phone || '')))
  const payload = {
    openid,
    nickname,
    nicknameSource,
    avatarUrl,
    avatarSource,
    avatarText: getAvatarText(nickname),
    profileCompleted: typeof profile.profileCompleted === 'boolean'
      ? profile.profileCompleted
      : (nickname !== '同学' || Boolean(avatarUrl)),
    skippedProfileAuth: profile.skippedProfileAuth === true,
    isLogin: phoneBound,
    phone: (oldUser && oldUser.phone) || '',
    phoneMasked: (oldUser && oldUser.phoneMasked) || '',
    phoneBound,
    phoneBoundAt: (oldUser && oldUser.phoneBoundAt) || '',
    membershipType: (oldUser && oldUser.membershipType) || 'free',
    membershipStatus: (oldUser && oldUser.membershipStatus) || 'active',
    membershipStartAt: (oldUser && oldUser.membershipStartAt) || '',
    membershipEndAt: oldUser && oldUser.membershipEndAt != null ? oldUser.membershipEndAt : null,
    role: (oldUser && oldUser.role) || 'user',
    isAdmin: oldUser && oldUser.isAdmin === true,
    aiDailyLimit: oldUser && oldUser.aiDailyLimit != null ? oldUser.aiDailyLimit : 1,
    aiMonthlyLimit: oldUser && oldUser.aiMonthlyLimit != null ? oldUser.aiMonthlyLimit : 10,
    status: 'active',
    loginAt: loginTime,
    lastLoginAt: loginTime,
    updatedAt: loginTime
  }

  if (oldUser) {
    await db.collection('users').doc(oldUser._id).update({
      data: {
        ...payload,
        loginCount: _.inc(1)
      }
    })

    return {
      ...oldUser,
      ...payload,
      loginCount: Number(oldUser.loginCount || 0) + 1
    }
  }

  const created = {
    ...payload,
    firstLoginAt: now(),
    loginCount: 1,
    createdAt: now()
  }
  const addRes = await db.collection('users').add({
    data: created
  })

  return {
    _id: addRes._id,
    ...created
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const profile = event.profile || {}
  const user = await upsertUser(wxContext.OPENID, profile)

  return {
    success: true,
    user: {
      ...user,
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID || '',
      role: user.role || 'user',
      isLoggedIn: user.phoneBound === true,
      loginAt: Date.now()
    }
  }
}
