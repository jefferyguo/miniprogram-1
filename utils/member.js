const { formatDateTime, getUserInfo } = require('./local-data')
const { getCurrentUser, getUserPackages } = require('./access-control')

const MEMBER_PROFILE_KEY = 'memberProfile'
const MEMBER_WHITELIST_KEY = 'memberWhitelist'

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + Number(days || 365))
  return formatDate(date)
}

function normalizeProfile(profile = {}) {
  return {
    isMember: Boolean(profile.isMember),
    memberType: profile.memberType || 'free',
    expireAt: profile.expireAt || '',
    activatedAt: profile.activatedAt || '',
    source: profile.source || 'local',
    remark: profile.remark || ''
  }
}

function getMemberProfile() {
  return normalizeProfile(wx.getStorageSync(MEMBER_PROFILE_KEY) || {})
}

function setMemberProfile(profile) {
  const nextProfile = normalizeProfile(profile)
  wx.setStorageSync(MEMBER_PROFILE_KEY, nextProfile)
  return nextProfile
}

function getMemberWhitelist() {
  const list = wx.getStorageSync(MEMBER_WHITELIST_KEY) || []
  return Array.isArray(list) ? list : []
}

function setMemberWhitelist(list) {
  const nextList = Array.isArray(list) ? list : []
  wx.setStorageSync(MEMBER_WHITELIST_KEY, nextList)
  return nextList
}

function isExpired(expireAt) {
  if (!expireAt) return false

  const expireDate = new Date(`${expireAt} 23:59:59`.replace(/-/g, '/'))
  if (!expireDate.getTime()) return false

  return expireDate.getTime() < Date.now()
}

function isOpenidInWhitelist(openid) {
  if (!openid) return false

  return getMemberWhitelist().some(item => (
    item.openid === openid && !isExpired(item.expireAt)
  ))
}

function getWhitelistItem(openid) {
  if (!openid) return null

  return getMemberWhitelist().find(item => (
    item.openid === openid && !isExpired(item.expireAt)
  )) || null
}

function formatMemberExpireText(expireAt) {
  if (!expireAt) return '长期有效'
  if (isExpired(expireAt)) return `已于 ${expireAt} 到期`
  return `${expireAt} 到期`
}

function getCurrentMemberStatus() {
  const storageUserInfo = getCurrentUser() || {}
  const userInfo = storageUserInfo.openid ? storageUserInfo : (getUserInfo() || {})
  const packages = getUserPackages(userInfo.phone, userInfo.openid || userInfo.openId || '')
  const hasVipPackage = packages.some(item => item.packageCode === 'vip_all')
  const hasAdvancedPackage = packages.some(item => item.packageCode === 'advanced_all')
  const whitelistItem = getWhitelistItem(userInfo.openid || '')

  if (hasVipPackage || hasAdvancedPackage) {
    return {
      isMember: true,
      memberType: hasVipPackage ? 'vip' : 'advanced',
      source: 'entitlement',
      expireAt: '',
      expireText: '以权限包有效期为准',
      canAccessPaid: true
    }
  }

  if (whitelistItem) {
    return {
      isMember: true,
      memberType: 'whitelist',
      source: 'whitelist',
      expireAt: whitelistItem.expireAt || '',
      expireText: formatMemberExpireText(whitelistItem.expireAt),
      canAccessPaid: true
    }
  }

  const profile = getMemberProfile()

  if (profile.isMember === true && !isExpired(profile.expireAt)) {
    return {
      isMember: true,
      memberType: profile.memberType || 'vip',
      source: 'local',
      expireAt: profile.expireAt || '',
      expireText: formatMemberExpireText(profile.expireAt),
      canAccessPaid: true
    }
  }

  return {
    isMember: false,
    memberType: 'free',
    source: 'none',
    expireAt: '',
    expireText: '未开通',
    canAccessPaid: false
  }
}

function activateLocalMember(days = 365) {
  return setMemberProfile({
    isMember: true,
    memberType: 'vip',
    activatedAt: formatDateTime(),
    expireAt: addDays(days),
    source: 'local',
    remark: '本地测试会员'
  })
}

function deactivateLocalMember() {
  return setMemberProfile({
    isMember: false,
    memberType: 'free',
    expireAt: '',
    activatedAt: '',
    source: 'local',
    remark: ''
  })
}

module.exports = {
  MEMBER_PROFILE_KEY,
  MEMBER_WHITELIST_KEY,
  getMemberProfile,
  setMemberProfile,
  getMemberWhitelist,
  setMemberWhitelist,
  isOpenidInWhitelist,
  getCurrentMemberStatus,
  activateLocalMember,
  deactivateLocalMember,
  formatMemberExpireText
}
