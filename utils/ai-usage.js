const { getActiveMemberAccess, getCurrentUser, isPhoneBound } = require('./access-control')
const { showPhoneLoginPrompt } = require('./phone-auth')
const {
  checkAiUsage: cloudCheckAiUsage,
  recordAiUsage: cloudRecordAiUsage
} = require('./cloud-api')
const {
  FREE_DAILY_AI_LIMIT,
  FREE_MONTHLY_AI_LIMIT,
  MONTHLY_MEMBER_DAILY_AI_LIMIT,
  MONTHLY_MEMBER_MONTHLY_AI_LIMIT,
  YEARLY_MEMBER_DAILY_AI_LIMIT,
  YEARLY_MEMBER_MONTHLY_AI_LIMIT,
  MEMBER_DAILY_AI_LIMIT
} = require('./membership-config')

const AI_DAILY_USAGE_KEY = 'aiDailyUsage'
const AI_MONTHLY_USAGE_KEY = 'aiMonthlyUsage'
const ANONYMOUS_ID_KEY = 'anonymousId'

function pad(value) {
  return String(value).padStart(2, '0')
}

function getTodayText() {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function getMonthText() {
  return getTodayText().slice(0, 7)
}

function createAnonymousId() {
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getAnonymousId() {
  const existed = wx.getStorageSync(ANONYMOUS_ID_KEY)
  if (existed) return existed

  const anonymousId = createAnonymousId()
  wx.setStorageSync(ANONYMOUS_ID_KEY, anonymousId)
  return anonymousId
}

function getUsageIdentity() {
  const user = getCurrentUser()
  const openid = user.openid || user.openId || ''

  if (openid) {
    return {
      openid,
      anonymousId: '',
      identityKey: `openid:${openid}`
    }
  }

  const anonymousId = getAnonymousId()
  return {
    openid: '',
    anonymousId,
    identityKey: `anonymous:${anonymousId}`
  }
}

function normalizeUsage() {
  const today = getTodayText()
  const identity = getUsageIdentity()
  const usage = wx.getStorageSync(AI_DAILY_USAGE_KEY) || {}

  if (usage.date !== today || usage.identityKey !== identity.identityKey) {
    return {
      date: today,
      openid: identity.openid,
      anonymousId: identity.anonymousId,
      identityKey: identity.identityKey,
      count: 0,
      records: []
    }
  }

  return {
    date: today,
    openid: identity.openid,
    anonymousId: identity.anonymousId,
    identityKey: identity.identityKey,
    count: Number(usage.count || 0),
    records: Array.isArray(usage.records) ? usage.records : []
  }
}

function normalizeMonthlyUsage() {
  const month = getMonthText()
  const identity = getUsageIdentity()
  const usage = wx.getStorageSync(AI_MONTHLY_USAGE_KEY) || {}
  if (usage.month !== month || usage.identityKey !== identity.identityKey) {
    return {
      month,
      identityKey: identity.identityKey,
      count: 0
    }
  }
  return {
    month,
    identityKey: identity.identityKey,
    count: Number(usage.count || 0)
  }
}

function getAiDailyLimit() {
  const access = getActiveMemberAccess()
  const membershipType = access.membershipType || access.type || 'free'
  console.log('[ai-usage] 当前用户类型:', membershipType)

  if (membershipType === 'admin') return -1
  if (membershipType === 'yearly') return YEARLY_MEMBER_DAILY_AI_LIMIT
  if (membershipType === 'monthly') return MONTHLY_MEMBER_DAILY_AI_LIMIT
  if (access.isMember) return MEMBER_DAILY_AI_LIMIT
  return FREE_DAILY_AI_LIMIT
}

function getAiMonthlyLimit() {
  const access = getActiveMemberAccess()
  const membershipType = access.membershipType || access.type || 'free'
  if (membershipType === 'admin') return -1
  if (membershipType === 'yearly') return YEARLY_MEMBER_MONTHLY_AI_LIMIT
  if (membershipType === 'monthly') return MONTHLY_MEMBER_MONTHLY_AI_LIMIT
  if (access.isMember) return MONTHLY_MEMBER_MONTHLY_AI_LIMIT
  return FREE_MONTHLY_AI_LIMIT
}

function buildLocalAiUsageResult(type) {
  const usage = normalizeUsage()
  const access = getActiveMemberAccess()
  const limit = getAiDailyLimit()
  const monthlyLimit = getAiMonthlyLimit()
  const monthlyUsage = normalizeMonthlyUsage()
  const used = usage.count
  const monthlyUsed = monthlyUsage.count
  const unlimited = limit === -1
  const monthlyUnlimited = monthlyLimit === -1
  const remaining = unlimited ? -1 : Math.max(limit - used, 0)

  console.log('[ai-usage] 今日已用:', used, '上限:', limit)

  return {
    allowed: (unlimited || used < limit) && (monthlyUnlimited || monthlyUsed < monthlyLimit),
    limit,
    used,
    remaining,
    reason: !monthlyUnlimited && monthlyUsed >= monthlyLimit
      ? 'monthly_limit_reached'
      : (unlimited || used < limit ? 'ok' : 'daily_limit_reached'),
    monthlyLimit,
    monthlyUsed,
    monthlyRemaining: monthlyUnlimited ? -1 : Math.max(monthlyLimit - monthlyUsed, 0),
    type,
    isMember: access.isMember,
    membershipType: access.membershipType || 'free',
    source: 'local'
  }
}

async function canUseAi(type) {
  if (!isPhoneBound()) {
    return {
      allowed: false,
      reason: 'phone_required',
      limit: 0,
      used: 0,
      remaining: 0,
      type,
      membershipType: 'free',
      source: 'local'
    }
  }

  const identity = getUsageIdentity()

  try {
    const cloudResult = await cloudCheckAiUsage(type, {
      anonymousId: identity.anonymousId
    })
    const result = {
      allowed: cloudResult.allowed !== false,
      limit: Number(cloudResult.limit || 1),
      used: Number(cloudResult.used || 0),
      remaining: Number(cloudResult.remaining || 0),
      reason: cloudResult.allowed === false ? (cloudResult.reason || cloudResult.code || 'daily_limit_reached') : 'ok',
      type,
      isMember: cloudResult.isMember === true,
      membershipType: cloudResult.membershipType || (Number(cloudResult.limit || 1) > FREE_DAILY_AI_LIMIT ? 'monthly' : 'free'),
      source: 'cloud'
    }

    console.log('[ai-usage] 当前用户类型:', result.limit > 1 ? 'member' : 'free')
    console.log('[ai-usage] 今日已用:', result.used, '上限:', result.limit)
    console.log('[ai-usage] canUseAi:', result)
    return result
  } catch (err) {
    console.warn('[ai-usage] 云端 AI 次数检查失败，使用本地 fallback:', err)
  }

  const result = buildLocalAiUsageResult(type)

  console.log('[ai-usage] canUseAi:', result)
  return result
}

function recordLocalAiUsage(type, extra = {}) {
  const usage = normalizeUsage()
  const access = getActiveMemberAccess()
  const nextRecord = {
    type,
    createdAt: new Date().toISOString(),
    workId: extra.workId || '',
    reportId: extra.reportId || '',
    isMember: access.isMember,
    membershipType: access.membershipType || 'free',
    ...extra
  }
  const nextUsage = {
    ...usage,
    count: usage.count + 1,
    records: [nextRecord].concat(usage.records || [])
  }

  wx.setStorageSync(AI_DAILY_USAGE_KEY, nextUsage)
  const monthlyUsage = normalizeMonthlyUsage()
  wx.setStorageSync(AI_MONTHLY_USAGE_KEY, {
    ...monthlyUsage,
    count: monthlyUsage.count + 1
  })
  return nextUsage
}

async function recordAiUsage(type, extra = {}) {
  if (!isPhoneBound()) {
    return {
      success: false,
      reason: 'phone_required',
      membershipType: 'free'
    }
  }
  const identity = getUsageIdentity()

  try {
    const result = await cloudRecordAiUsage(type, {
      anonymousId: identity.anonymousId,
      ...extra
    })
    console.log('[ai-usage] 记录AI使用:', type, extra)
    return {
      ...result,
      source: 'cloud'
    }
  } catch (err) {
    console.warn('[ai-usage] 云端 AI 次数记录失败，使用本地 fallback:', err)
  }

  const result = recordLocalAiUsage(type, extra)
  console.log('[ai-usage] 记录AI使用:', type, extra)
  return {
    ...result,
    source: 'local'
  }
}

function showAiLimitModal(usage) {
  if (usage && usage.reason === 'phone_required') {
    showPhoneLoginPrompt('生成 AI 点评')
    return
  }

  if (usage && usage.membershipType === 'admin') return
  const isMemberLimit = usage && usage.isMember === true
  const isMonthlyLimit = usage && usage.reason === 'monthly_limit_reached'

  if (!isMemberLimit && typeof getCurrentPages === 'function') {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const modal = currentPage && typeof currentPage.selectComponent === 'function'
      ? currentPage.selectComponent('#memberBenefitModal')
      : null

    if (modal && typeof modal.open === 'function') {
      modal.open({
        reason: 'ai_limit',
        limit: usage && usage.limit,
        used: usage && usage.used
      })
      return
    }
  }

  wx.showModal({
    title: isMonthlyLimit
      ? '本月 AI 次数已用完'
      : (isMemberLimit ? '今日 AI 次数已用完' : '今日免费 AI 次数已用完'),
    content: isMonthlyLimit
      ? '本月 AI 使用次数已达到上限，请下月再试。'
      : isMemberLimit
        ? `会员用户每天可使用 ${MEMBER_DAILY_AI_LIMIT} 次 AI 点评/测评，今日次数已用完，请明天再试。`
        : `普通用户每天可免费生成 ${FREE_DAILY_AI_LIMIT} 次 AI 点评。进入会员中心后，可通过小程序虚拟支付购买会员，每天可生成 ${MEMBER_DAILY_AI_LIMIT} 次 AI 点评。`,
    confirmText: isMemberLimit ? '我知道了' : '了解权益',
    cancelText: '先不使用',
    success: res => {
      if (!isMemberLimit && res.confirm) {
        wx.navigateTo({
          url: '/pages/member-center/member-center'
        })
      }
    }
  })
}

module.exports = {
  AI_DAILY_USAGE_KEY,
  AI_MONTHLY_USAGE_KEY,
  ANONYMOUS_ID_KEY,
  getAiDailyLimit,
  getAiMonthlyLimit,
  canUseAi,
  recordAiUsage,
  showAiLimitModal
}
