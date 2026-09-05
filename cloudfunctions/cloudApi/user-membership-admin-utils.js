'use strict'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const MEMBER_TYPES = new Set(['monthly', 'yearly'])
const CONFIRMED_PAYMENT_STATUSES = new Set(['paid', 'fulfilled'])
const REFUNDED_STATUSES = new Set(['refunded', 'partial_refund', 'partially_refunded'])

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseTimestamp(value, options = {}) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 100000000000 ? value * 1000 : value
  }

  const text = String(value || '').trim()
  if (!text) return NaN
  if (/^\d{10,13}$/.test(text)) return parseTimestamp(Number(text), options)

  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const suffix = options.endOfDay ? '23:59:59.999' : '00:00:00.000'
    const timestamp = Date.parse(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T${suffix}+08:00`)
    const expected = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
    return formatShanghaiDateRaw(timestamp) === expected ? timestamp : NaN
  }

  const localDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (localDateTime) {
    return Date.parse(
      `${localDateTime[1]}-${localDateTime[2]}-${localDateTime[3]}T` +
      `${localDateTime[4]}:${localDateTime[5]}:${localDateTime[6] || '00'}+08:00`
    )
  }

  return Date.parse(text)
}

function formatShanghaiDateRaw(timestamp) {
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp + SHANGHAI_OFFSET_MS)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function getShanghaiParts(value = Date.now()) {
  const timestamp = parseTimestamp(value)
  const date = new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + SHANGHAI_OFFSET_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay()
  }
}

function formatShanghaiDate(value, includeTime = false) {
  const timestamp = parseTimestamp(value)
  if (!Number.isFinite(timestamp)) return ''
  const parts = getShanghaiParts(timestamp)
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  if (!includeTime) return date
  return `${date} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

function dateKeyToTimestamp(dateKey) {
  return parseTimestamp(dateKey)
}

function addShanghaiDays(dateKey, days) {
  const timestamp = dateKeyToTimestamp(dateKey)
  if (!Number.isFinite(timestamp)) return ''
  return formatShanghaiDate(timestamp + Number(days || 0) * 86400000)
}

function getShanghaiDateRange(startDate, endDate) {
  const startAt = parseTimestamp(startDate)
  const endAt = parseTimestamp(endDate, { endOfDay: true })
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
    throw new Error('日期范围无效')
  }
  return { startAt, endAt: endAt + 1 }
}

function getShanghaiPeriods(value = Date.now()) {
  const timestamp = parseTimestamp(value)
  const current = Number.isFinite(timestamp) ? timestamp : Date.now()
  const today = formatShanghaiDate(current)
  const parts = getShanghaiParts(current)
  const mondayOffset = (parts.weekday + 6) % 7
  const weekStart = addShanghaiDays(today, -mondayOffset)
  const monthStart = `${parts.year}-${pad(parts.month)}-01`
  const yearStart = `${parts.year}-01-01`

  return {
    now: current,
    today: getShanghaiDateRange(today, today),
    week: getShanghaiDateRange(weekStart, today),
    month: getShanghaiDateRange(monthStart, today),
    year: getShanghaiDateRange(yearStart, today),
    labels: { today, weekStart, monthStart, yearStart }
  }
}

function normalizeMembershipType(value) {
  const type = String(value || '').toLowerCase()
  if (type === 'monthly' || type === 'month') return 'monthly'
  if (type === 'yearly' || type === 'year' || type === 'annual') return 'yearly'
  if (type === 'admin') return 'admin'
  return 'free'
}

function getMembershipLabel(value) {
  const type = normalizeMembershipType(value)
  if (type === 'monthly') return '季度会员'
  if (type === 'yearly') return '年度会员'
  if (type === 'admin') return '管理员'
  return '普通用户'
}

function classifyMembership(record = {}, nowValue = Date.now()) {
  const membershipType = normalizeMembershipType(record.membershipType)
  const nowTimestamp = parseTimestamp(nowValue)
  const startTimestamp = parseTimestamp(record.membershipStartAt)
  const endTimestamp = parseTimestamp(record.membershipEndAt, { endOfDay: true })
  const memberType = MEMBER_TYPES.has(membershipType)
  const status = String(record.membershipStatus || 'active')
  const activeFlag = ['active', 'scheduled'].includes(status) &&
    !['disabled', 'deleted', 'inactive'].includes(String(record.status || 'active'))
  const started = !Number.isFinite(startTimestamp) || startTimestamp <= nowTimestamp
  const notExpired = Number.isFinite(endTimestamp) && endTimestamp >= nowTimestamp
  const scheduled = memberType && activeFlag && !started && notExpired
  const active = memberType && activeFlag && started && notExpired
  const daysUntilExpiry = active
    ? Math.max(0, Math.ceil((endTimestamp - nowTimestamp) / 86400000))
    : null

  return {
    membershipType,
    membershipLabel: getMembershipLabel(membershipType),
    customerState: active ? 'active' : (scheduled ? 'scheduled' : (memberType ? 'expired' : 'ordinary')),
    statusLabel: active
      ? (daysUntilExpiry <= 7 ? '即将到期' : '有效')
      : (scheduled ? '待生效' : (memberType ? '已过期' : '普通用户')),
    isActiveMember: active,
    isScheduledMember: scheduled,
    isExpiredMember: memberType && !active && !scheduled,
    isOrdinaryUser: !memberType,
    daysUntilExpiry
  }
}

function isConfirmedPaymentOrder(order = {}) {
  const status = String(order.status || '').toLowerCase()
  const paidAt = parseTimestamp(order.paidAt || order.paymentTime)
  const priceFen = Number(order.priceFen != null ? order.priceFen : order.amountFen)
  const provider = String(order.paymentProvider || '')
  return CONFIRMED_PAYMENT_STATUSES.has(status) &&
    Number.isFinite(paidAt) &&
    Number.isInteger(priceFen) &&
    priceFen > 0 &&
    provider === 'wechat_virtual_payment'
}

function getExplicitRefundFen(order = {}) {
  const refundStatus = String(order.refundStatus || '').toLowerCase()
  if (!REFUNDED_STATUSES.has(refundStatus)) return 0
  const refundFen = Number(order.refundFen != null ? order.refundFen : order.refundedFen)
  return Number.isInteger(refundFen) && refundFen > 0 ? refundFen : 0
}

function normalizeConfirmedPayment(order = {}) {
  if (!isConfirmedPaymentOrder(order)) return null
  const grossFen = Number(order.priceFen != null ? order.priceFen : order.amountFen)
  const refundFen = Math.min(grossFen, getExplicitRefundFen(order))
  const membershipType = normalizeMembershipType(order.membershipType)
  return {
    id: String(order.orderNo || order._id || ''),
    orderNo: String(order.orderNo || ''),
    userId: String(order.userId || ''),
    openid: String(order.openid || ''),
    phone: String(order.phone || '').replace(/\D/g, ''),
    productId: String(order.productId || ''),
    membershipType,
    membershipLabel: getMembershipLabel(membershipType),
    paidAt: order.paidAt || order.paymentTime || '',
    paidTimestamp: parseTimestamp(order.paidAt || order.paymentTime),
    grossFen,
    refundFen,
    confirmedFen: grossFen - refundFen,
    status: String(order.status || ''),
    refundStatus: String(order.refundStatus || '')
  }
}

function dedupeConfirmedPayments(orders = []) {
  const paymentMap = new Map()
  for (const order of orders || []) {
    const payment = normalizeConfirmedPayment(order)
    if (!payment) continue
    const key = payment.orderNo || payment.id
    if (!key) continue
    const existing = paymentMap.get(key)
    if (!existing || payment.paidTimestamp > existing.paidTimestamp) paymentMap.set(key, payment)
  }
  return Array.from(paymentMap.values()).sort((a, b) => b.paidTimestamp - a.paidTimestamp)
}

function dedupeAdminGrantRevenue(records = []) {
  const revenueMap = new Map()
  for (const record of records || []) {
    const operationId = String(record.operationId || record.revenueOperationId || '').trim()
    const source = String(record.source || record.revenueSource || '').trim()
    const amountFen = Number(record.amountFen != null ? record.amountFen : record.revenueAmountFen)
    const happenedAt = record.createdAt || record.grantedAt || record.revenueCreatedAt || ''
    const timestamp = parseTimestamp(happenedAt)
    if (!operationId || source !== 'admin_grant' || !Number.isInteger(amountFen) || amountFen <= 0 || !Number.isFinite(timestamp)) continue
    const membershipType = normalizeMembershipType(record.membershipType || record.revenueMembershipType)
    const item = {
      id: operationId,
      operationId,
      userId: String(record.userId || record.targetId || ''),
      productId: String(record.productId || record.revenueProductId || ''),
      membershipType,
      membershipLabel: getMembershipLabel(membershipType),
      paidAt: happenedAt,
      paidTimestamp: timestamp,
      grossFen: amountFen,
      refundFen: 0,
      confirmedFen: amountFen,
      status: 'recorded',
      source: 'admin_grant'
    }
    const existing = revenueMap.get(operationId)
    if (!existing || item.paidTimestamp > existing.paidTimestamp) revenueMap.set(operationId, item)
  }
  return Array.from(revenueMap.values()).sort((a, b) => b.paidTimestamp - a.paidTimestamp)
}

function summarizePaymentGroup(payments = []) {
  return payments.reduce((summary, payment) => {
    summary.grossFen += payment.grossFen
    summary.refundFen += payment.refundFen
    summary.confirmedFen += payment.confirmedFen
    summary.orderCount += 1
    return summary
  }, { grossFen: 0, refundFen: 0, confirmedFen: 0, orderCount: 0 })
}

function inRange(timestamp, range) {
  return timestamp >= range.startAt && timestamp < range.endAt
}

function aggregateRevenue(orders = [], nowValue = Date.now(), manualRevenueRecords = []) {
  const payments = dedupeConfirmedPayments(orders)
  const manualGrants = dedupeAdminGrantRevenue(manualRevenueRecords)
  const revenueEntries = payments.concat(manualGrants)
  const periods = getShanghaiPeriods(nowValue)
  const filterPeriod = (entries, range) => entries.filter(item => inRange(item.paidTimestamp, range))
  const packageMap = new Map()

  for (const entry of revenueEntries) {
    const key = MEMBER_TYPES.has(entry.membershipType) ? entry.membershipType : 'other'
    const current = packageMap.get(key) || {
      membershipType: key,
      membershipLabel: key === 'other' ? '其他真实套餐' : getMembershipLabel(key),
      orderCount: 0,
      confirmedFen: 0
    }
    current.orderCount += 1
    current.confirmedFen += entry.confirmedFen
    packageMap.set(key, current)
  }

  const all = summarizePaymentGroup(revenueEntries)
  const paymentAll = summarizePaymentGroup(payments)
  const manualAll = summarizePaymentGroup(manualGrants)
  const packages = Array.from(packageMap.values()).map(item => ({
    ...item,
    share: all.confirmedFen > 0 ? Number((item.confirmedFen / all.confirmedFen).toFixed(4)) : 0
  }))

  return {
    payments,
    manualGrants,
    all,
    today: summarizePaymentGroup(filterPeriod(revenueEntries, periods.today)),
    week: summarizePaymentGroup(filterPeriod(revenueEntries, periods.week)),
    month: summarizePaymentGroup(filterPeriod(revenueEntries, periods.month)),
    year: summarizePaymentGroup(filterPeriod(revenueEntries, periods.year)),
    payment: {
      all: paymentAll,
      today: summarizePaymentGroup(filterPeriod(payments, periods.today)),
      week: summarizePaymentGroup(filterPeriod(payments, periods.week)),
      month: summarizePaymentGroup(filterPeriod(payments, periods.month)),
      year: summarizePaymentGroup(filterPeriod(payments, periods.year))
    },
    manual: {
      all: manualAll,
      today: summarizePaymentGroup(filterPeriod(manualGrants, periods.today)),
      week: summarizePaymentGroup(filterPeriod(manualGrants, periods.week)),
      month: summarizePaymentGroup(filterPeriod(manualGrants, periods.month)),
      year: summarizePaymentGroup(filterPeriod(manualGrants, periods.year))
    },
    packages,
    paidUserCount: new Set(payments.map(item => item.openid || item.phone || item.userId).filter(Boolean)).size,
    revenueBasis: 'payment_plus_admin_grant',
    refundBasis: 'explicit_refund_fields_only'
  }
}

function createDateSeries(startDate, endDate) {
  const items = []
  let cursor = startDate
  while (cursor && cursor <= endDate && items.length < 800) {
    items.push(cursor)
    cursor = addShanghaiDays(cursor, 1)
  }
  return items
}

function buildDailyRevenueTrend(orders = [], startDate, endDate, manualRevenueRecords = []) {
  const range = getShanghaiDateRange(startDate, endDate)
  const grouped = new Map(createDateSeries(startDate, endDate).map(date => [date, {
    label: date,
    confirmedFen: 0,
    orderCount: 0
  }]))

  const entries = dedupeConfirmedPayments(orders).concat(dedupeAdminGrantRevenue(manualRevenueRecords))
  for (const entry of entries) {
    if (!inRange(entry.paidTimestamp, range)) continue
    const key = formatShanghaiDate(entry.paidTimestamp)
    const item = grouped.get(key)
    if (!item) continue
    item.confirmedFen += entry.confirmedFen
    item.orderCount += 1
  }
  return Array.from(grouped.values())
}

function buildRevenueHistory(orders = [], period = 'month', manualRevenueRecords = []) {
  const grouped = new Map()
  const entries = dedupeConfirmedPayments(orders).concat(dedupeAdminGrantRevenue(manualRevenueRecords))
  for (const entry of entries) {
    const parts = getShanghaiParts(entry.paidTimestamp)
    let key = String(parts.year)
    if (period === 'month') key = `${parts.year}-${pad(parts.month)}`
    if (period === 'week') {
      const dateKey = formatShanghaiDate(entry.paidTimestamp)
      const monday = addShanghaiDays(dateKey, -((parts.weekday + 6) % 7))
      key = monday
    }
    const current = grouped.get(key) || { label: key, confirmedFen: 0, orderCount: 0 }
    current.confirmedFen += entry.confirmedFen
    current.orderCount += 1
    grouped.set(key, current)
  }
  return Array.from(grouped.values()).sort((a, b) => b.label.localeCompare(a.label))
}

function membershipSnapshot(record = {}) {
  const state = classifyMembership(record)
  return {
    membershipType: state.membershipType,
    membershipStatus: String(record.membershipStatus || ''),
    membershipStartAt: String(record.membershipStartAt || ''),
    membershipEndAt: String(record.membershipEndAt || ''),
    source: String(record.source || ''),
    status: String(record.status || '')
  }
}

function buildManagedMembershipChange(input = {}, nowValue = Date.now()) {
  const action = ['add', 'update', 'extend', 'restore', 'end'].includes(input.membershipAction)
    ? input.membershipAction
    : 'update'
  if (action === 'end') {
    return {
      action,
      membershipType: 'free',
      membershipStartAt: '',
      membershipEndAt: null,
      membershipStatus: 'active'
    }
  }

  const membershipType = normalizeMembershipType(input.membershipType)
  if (!MEMBER_TYPES.has(membershipType)) {
    throw new Error('会员类型只能是季度会员或年度会员。')
  }
  const startDate = String(input.startDate || formatShanghaiDate(nowValue)).trim()
  if (!Number.isFinite(parseTimestamp(startDate))) throw new Error('会员生效日期无效。')
  const durationDays = membershipType === 'monthly' ? 90 : 365
  const endDate = String(input.endDate || addShanghaiDays(startDate, durationDays)).trim()
  if (!Number.isFinite(parseTimestamp(endDate, { endOfDay: true }))) throw new Error('会员到期日期无效。')
  if (endDate <= startDate) throw new Error('会员到期时间必须晚于生效时间。')
  return {
    action,
    membershipType,
    membershipStartAt: startDate,
    membershipEndAt: endDate,
    membershipStatus: parseTimestamp(endDate, { endOfDay: true }) >= parseTimestamp(nowValue) ? 'active' : 'expired'
  }
}

function safeCsvCell(value) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function buildUsersCsv(rows = []) {
  const headers = [
    '用户 ID', '昵称', '手机号', '注册时间', '用户类型', '会员状态', '会员类型',
    '购买时间', '生效时间', '到期时间', '实付金额（元）', '会员来源', '历史支付订单数', '历史累计实付（元）'
  ]
  const lines = [headers.map(safeCsvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.userId,
      row.nickname,
      row.phone,
      row.registeredAt,
      row.userTypeLabel,
      row.membershipStatusLabel,
      row.membershipLabel,
      row.purchaseTime || '历史数据未记录',
      row.membershipStartAt,
      row.membershipEndAt,
      row.paidAmountFen == null ? '' : (Number(row.paidAmountFen) / 100).toFixed(2),
      row.membershipSourceLabel,
      row.paidOrderCount == null ? '' : row.paidOrderCount,
      row.totalPaidFen == null ? '' : (Number(row.totalPaidFen) / 100).toFixed(2)
    ].map(safeCsvCell).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

module.exports = {
  addShanghaiDays,
  aggregateRevenue,
  buildDailyRevenueTrend,
  buildManagedMembershipChange,
  buildRevenueHistory,
  buildUsersCsv,
  classifyMembership,
  dedupeAdminGrantRevenue,
  dedupeConfirmedPayments,
  formatShanghaiDate,
  getMembershipLabel,
  getShanghaiDateRange,
  getShanghaiPeriods,
  isConfirmedPaymentOrder,
  membershipSnapshot,
  normalizeConfirmedPayment,
  normalizeMembershipType,
  parseTimestamp,
  safeCsvCell
}
