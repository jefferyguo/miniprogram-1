'use strict'

const crypto = require('crypto')

const {
  addShanghaiDays,
  aggregateRevenue,
  buildDailyRevenueTrend,
  buildManagedMembershipChange,
  buildRevenueHistory,
  buildUsersCsv,
  classifyMembership,
  dedupeConfirmedPayments,
  formatShanghaiDate,
  getMembershipLabel,
  getShanghaiDateRange,
  membershipSnapshot,
  normalizeMembershipType,
  parseTimestamp
} = require('./user-membership-admin-utils')
const {
  PHONE_BINDING_LOCK_KIND,
  PREAUTH_KIND,
  buildPreRegistrationCsv,
  buildPreRegistrationEntitlement,
  buildPreauthorizationRevocation,
  derivePreauthStatus,
  getPreauthorizationDocumentId,
  inspectPreauthorizationSave,
  redactPhoneNumbers
} = require('./pre-registration-entitlement-utils')
const { MEMBERSHIP_PRODUCTS } = require('./membership-products')

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const QUERY_PAGE_SIZE = 100
const MAX_EXPORT_ROWS = 20000
const SUCCESSFUL_PAYMENT_STATUSES = ['paid', 'fulfilled']
const MANAGED_MEMBER_TYPES = ['monthly', 'yearly']
const DEFERRED_RECONCILE_LIMIT = 20
const ADMIN_GRANT_REVENUE_SOURCE = 'admin_grant'

function getMembershipProductByType(membershipType) {
  return MEMBERSHIP_PRODUCTS.find(item => item.membershipType === membershipType) || null
}

function normalizeOperationId(value) {
  const operationId = String(value || '').trim()
  return /^[A-Za-z0-9:_-]{12,128}$/.test(operationId) ? operationId : ''
}

function getRevenueAuditDocumentId(operationId) {
  return `admin_revenue_${crypto.createHash('sha256').update(operationId).digest('hex').slice(0, 32)}`
}

function getRevenueRequestFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function isMembershipValueIncrease(before = {}, after = {}) {
  const rank = { free: 0, monthly: 1, yearly: 2, admin: 3 }
  const beforeType = normalizeMembershipType(before.membershipType)
  const afterType = normalizeMembershipType(after.membershipType)
  if (!['monthly', 'yearly'].includes(afterType)) return false
  if ((rank[afterType] || 0) > (rank[beforeType] || 0)) return true
  return parseTimestamp(after.membershipEndAt, { endOfDay: true }) > parseTimestamp(before.membershipEndAt, { endOfDay: true })
}

function normalizePreauthorizationKeyword(value, normalizePhoneValue) {
  const keyword = String(value || '').trim()
  if (!keyword) return ''
  const isPhoneLike = /^[\d\s+()\-]+$/.test(keyword)
  if (!isPhoneLike) return keyword
  return typeof normalizePhoneValue === 'function'
    ? normalizePhoneValue(keyword)
    : keyword.replace(/\D/g, '')
}

function countUniqueActiveManualMembers(records = [], normalizePhoneValue, nowValue = Date.now()) {
  const identities = new Set()
  for (const record of records) {
    if (record.historyArchive === true) continue
    if (String(record.source || '') === 'wechat_virtual_payment') continue
    if (!classifyMembership(record, nowValue).isActiveMember) continue
    const phone = typeof normalizePhoneValue === 'function'
      ? normalizePhoneValue(record.phoneNormalized || record.phone)
      : String(record.phoneNormalized || record.phone || '').replace(/\D/g, '')
    const identity = String(phone || record.claimedUserId || record.claimedOpenid || record._id || '')
    if (identity) identities.add(identity)
  }
  return identities.size
}

function createUserMembershipAdminService(deps) {
  const {
    db,
    _,
    cloud,
    collections,
    requireAdmin,
    fail,
    success,
    now,
    maskPhone,
    normalizePhone,
    getMembershipLimits,
    writeAuditLog,
    buildOperationsPdf,
    reconcileBoundPhoneUser
  } = deps

  function readInput(event = {}) {
    return event.data && typeof event.data === 'object' ? { ...event, ...event.data } : event
  }

  function preauthorizationNow() {
    return formatShanghaiDate(Date.now(), true)
  }

  function getPagination(input = {}) {
    const page = Math.max(1, Number(input.page || 1))
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize || DEFAULT_PAGE_SIZE)))
    return { page, pageSize, skip: (page - 1) * pageSize }
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function sanitizeAuditText(value) {
    return redactPhoneNumbers(value, maskPhone)
  }

  function combineConditions(conditions = []) {
    const valid = conditions.filter(Boolean)
    if (!valid.length) return null
    if (valid.length === 1) return valid[0]
    return _.and(valid)
  }

  function dateRangeCondition(field, startDate, endDate, options = {}) {
    if (!startDate && !endDate) return null
    const start = startDate || '1970-01-01'
    const end = endDate || '2999-12-31'
    const range = getShanghaiDateRange(start, end)
    if (options.dateOnly) {
      return { [field]: _.gte(start).and(_.lte(end)) }
    }
    if (options.mixedDate) {
      return _.or([
        { [field]: _.gte(start).and(_.lte(end)) },
        { [field]: _.gte(formatShanghaiDate(range.startAt, true)).and(_.lt(formatShanghaiDate(range.endAt, true))) }
      ])
    }
    return { [field]: _.gte(formatShanghaiDate(range.startAt, true)).and(_.lt(formatShanghaiDate(range.endAt, true))) }
  }

  function membershipStateCondition(state, todayText = formatShanghaiDate(Date.now())) {
    const memberType = { membershipType: _.in(MANAGED_MEMBER_TYPES) }
    if (state === 'active') {
      return _.and([
        memberType,
        { membershipStatus: _.in(['active', 'scheduled']) },
        _.or([
          { membershipStartAt: _.lte(`${todayText} 23:59:59`) },
          { membershipStartAt: '' },
          { membershipStartAt: _.exists(false) }
        ]),
        { membershipEndAt: _.gte(todayText) }
      ])
    }
    if (state === 'expired') {
      return _.and([
        memberType,
        _.or([
          { membershipStatus: _.in(['expired', 'inactive', 'disabled', 'cancelled']) },
          { membershipEndAt: _.lt(todayText) }
        ])
      ])
    }
    if (state === 'ordinary') {
      return _.or([
        { membershipType: 'free' },
        { membershipType: 'admin' },
        { membershipType: '' },
        { membershipType: _.exists(false) }
      ])
    }
    if (state === 'expiring7' || state === 'expiring30') {
      const days = state === 'expiring7' ? 7 : 30
      return _.and([
        memberType,
        { membershipStatus: _.in(['active', 'scheduled']) },
        _.or([
          { membershipStartAt: _.lte(`${todayText} 23:59:59`) },
          { membershipStartAt: '' },
          { membershipStartAt: _.exists(false) }
        ]),
        { membershipEndAt: _.gte(todayText).and(_.lte(addShanghaiDays(todayText, days))) }
      ])
    }
    return null
  }

  function buildUserCondition(input = {}) {
    const conditions = []
    const keyword = String(input.keyword || '').trim()
    if (keyword) {
      const regexp = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
      conditions.push(_.or([
        { nickname: regexp },
        { phone: regexp },
        { phoneMasked: regexp },
        { _id: regexp }
      ]))
    }

    const membershipState = String(input.membershipState || input.tab || 'all')
    conditions.push(membershipStateCondition(membershipState))

    const membershipType = String(input.membershipType || '')
    if (['free', 'monthly', 'yearly'].includes(membershipType)) {
      conditions.push({ membershipType })
    }

    conditions.push(dateRangeCondition('registeredAt', input.registeredStartDate, input.registeredEndDate))

    if (input.expiryStartDate || input.expiryEndDate) {
      conditions.push(dateRangeCondition('membershipEndAt', input.expiryStartDate, input.expiryEndDate, { dateOnly: true }))
    }
    return combineConditions(conditions)
  }

  function createQuery(collectionName, condition) {
    return condition
      ? db.collection(collectionName).where(condition)
      : db.collection(collectionName)
  }

  async function fetchAll(collectionName, condition, options = {}) {
    const rows = []
    const maxRows = Math.max(QUERY_PAGE_SIZE, Number(options.maxRows || 50000))
    for (let page = 0; rows.length < maxRows; page += 1) {
      let query = createQuery(collectionName, condition)
      if (options.orderBy) {
        for (const [field, direction] of options.orderBy) query = query.orderBy(field, direction)
      }
      const result = await query.skip(page * QUERY_PAGE_SIZE).limit(QUERY_PAGE_SIZE).get()
      const pageRows = result.data || []
      rows.push(...pageRows)
      if (pageRows.length < QUERY_PAGE_SIZE) break
    }
    return rows.slice(0, maxRows)
  }

  async function countUsers(input = {}) {
    const condition = buildUserCondition(input)
    const result = await createQuery(collections.users, condition).count()
    return Number(result.total || 0)
  }

  function getUserOrderIdentityCondition(users = []) {
    const openids = Array.from(new Set(users.map(item => item.openid).filter(Boolean)))
    const phones = Array.from(new Set(users.map(item => normalizePhone(item.phone)).filter(Boolean)))
    const clauses = []
    if (openids.length) clauses.push({ openid: _.in(openids) })
    if (phones.length) clauses.push({ phone: _.in(phones) })
    return clauses.length ? _.or(clauses) : null
  }

  async function getConfirmedOrdersForUsers(users = []) {
    const identity = getUserOrderIdentityCondition(users)
    if (!identity) return []
    const condition = _.and([
      identity,
      { status: _.in(SUCCESSFUL_PAYMENT_STATUSES) },
      { paymentProvider: 'wechat_virtual_payment' }
    ])
    return fetchAll(collections.virtualPaymentOrders, condition, {
      orderBy: [['paidAt', 'desc']],
      maxRows: 10000
    })
  }

  async function getEntitlementsForUsers(users = []) {
    const phones = Array.from(new Set(users.map(item => normalizePhone(item.phone)).filter(Boolean)))
    if (!phones.length) return []
    return fetchAll(collections.phoneEntitlements, _.or([
      { phone: _.in(phones) },
      { phoneNormalized: _.in(phones) }
    ]), { maxRows: phones.length * 3 })
  }

  function isDirectPhoneEntitlement(item = {}) {
    return item.historyArchive !== true &&
      String(item.entitlementKind || '') !== PREAUTH_KIND &&
      String(item.entitlementKind || '') !== PHONE_BINDING_LOCK_KIND
  }

  function entitlementPriority(item = {}) {
    if (item.historyArchive === true || ['disabled', 'deleted'].includes(String(item.status || 'active'))) return 0
    const state = classifyMembership(item)
    if (normalizeMembershipType(item.membershipType) === 'admin') return 6
    if (state.isActiveMember) return 5
    if (state.isScheduledMember) return 4
    if (String(item.entitlementKind || '') === PREAUTH_KIND && String(item.preauthStatus || '') === 'claimed') return 2
    if (String(item.entitlementKind || '') === PREAUTH_KIND) return 1
    return 3
  }

  function buildEntitlementMap(entitlements = []) {
    const result = new Map()
    for (const entitlement of entitlements) {
      if (!isDirectPhoneEntitlement(entitlement) && String(entitlement.entitlementKind || '') !== PREAUTH_KIND) {
        continue
      }
      if (entitlement.historyArchive === true) continue
      const phone = normalizePhone(entitlement.phone)
      if (!phone) continue
      const current = result.get(phone)
      const priority = entitlementPriority(entitlement)
      const currentPriority = current ? entitlementPriority(current) : -1
      if (
        !current ||
        priority > currentPriority ||
        (priority === currentPriority && String(entitlement.updatedAt || '').localeCompare(String(current.updatedAt || '')) > 0)
      ) {
        result.set(phone, entitlement)
      }
    }
    return result
  }

  function getUserIdentityKey(user = {}) {
    return String(user.openid || normalizePhone(user.phone) || user._id || '')
  }

  function buildPaymentMaps(orders = []) {
    const userPayments = new Map()
    for (const payment of dedupeConfirmedPayments(orders)) {
      for (const key of [payment.openid, payment.phone].filter(Boolean)) {
        const list = userPayments.get(key) || []
        if (!list.some(item => item.orderNo === payment.orderNo)) list.push(payment)
        userPayments.set(key, list)
      }
    }
    for (const list of userPayments.values()) list.sort((a, b) => b.paidTimestamp - a.paidTimestamp)
    return userPayments
  }

  function resolveUserPayments(user, paymentMap) {
    const keys = [user.openid, normalizePhone(user.phone)].filter(Boolean)
    const seen = new Set()
    const payments = []
    for (const key of keys) {
      for (const payment of paymentMap.get(key) || []) {
        if (seen.has(payment.orderNo)) continue
        seen.add(payment.orderNo)
        payments.push(payment)
      }
    }
    return payments.sort((a, b) => b.paidTimestamp - a.paidTimestamp)
  }

  function resolveMembershipSource(entitlement = {}, latestPayment = null) {
    const source = String(entitlement.source || '').toLowerCase()
    if (source === 'admin_preauthorization_claimed') return {
      code: 'preauthorization',
      label: '后台预授权领取'
    }
    if (['admin', 'manual', 'grant', 'admin_manual'].includes(source)) return {
      code: 'admin',
      label: '后台添加'
    }
    if (source === 'wechat_virtual_payment' || latestPayment) return {
      code: 'payment',
      label: '微信支付'
    }
    if (source === 'legacy') return { code: 'legacy', label: '历史数据' }
    return { code: entitlement._id ? 'admin' : 'none', label: entitlement._id ? '后台添加' : '无' }
  }

  function fallbackNickname(user = {}) {
    const nickname = String(user.nickname || '').trim()
    if (nickname) return nickname
    const phone = normalizePhone(user.phone)
    if (phone) return `用户 ${phone.slice(-4)}`
    const id = String(user._id || '')
    return id ? `用户 ${id.slice(-6)}` : '用户'
  }

  function toUserDto(user = {}, entitlement = {}, payments = []) {
    const state = classifyMembership(user)
    const latestPayment = payments[0] || null
    const source = resolveMembershipSource(entitlement, latestPayment)
    const currentPayment = state.customerState !== 'ordinary' && source.code === 'payment' ? latestPayment : null
    const totalPaidFen = payments.reduce((sum, payment) => sum + payment.confirmedFen, 0)
    const phone = normalizePhone(user.phone || entitlement.phone)
    return {
      userId: String(user._id || ''),
      nickname: fallbackNickname(user),
      phone,
      phoneBound: user.phoneBound === true,
      registeredAt: user.registeredAt || user.createdAt || '',
      lastActiveAt: user.lastLoginAt || user.lastVisitAt || user.updatedAt || '',
      registrationSource: user.registrationSource || user.nicknameSource || '',
      customerState: state.customerState,
      userTypeLabel: state.customerState === 'ordinary'
        ? '普通用户'
        : (state.customerState === 'active' ? '有效会员' : (state.customerState === 'scheduled' ? '待生效会员' : '已过期会员')),
      membershipType: state.membershipType,
      membershipLabel: state.membershipLabel,
      membershipStatus: state.customerState,
      membershipStatusLabel: state.statusLabel,
      membershipStartAt: user.membershipStartAt || entitlement.membershipStartAt || '',
      membershipEndAt: user.membershipEndAt || entitlement.membershipEndAt || '',
      daysUntilExpiry: state.daysUntilExpiry,
      purchaseTime: currentPayment ? currentPayment.paidAt : '',
      purchaseTimeLabel: currentPayment
        ? formatShanghaiDate(currentPayment.paidTimestamp, true)
        : (source.code === 'preauthorization' ? '—' : '历史数据未记录'),
      paidAmountFen: currentPayment ? currentPayment.confirmedFen : null,
      membershipSource: source.code,
      membershipSourceLabel: source.label,
      paidOrderCount: payments.length,
      totalPaidFen,
      isPaidUser: payments.length > 0,
      canManageMembership: state.membershipType !== 'admin',
      preauthorization: String(entitlement.entitlementKind || '') === PREAUTH_KIND
        ? {
            entitlementId: String(entitlement._id || ''),
            status: String(entitlement.preauthStatus || ''),
            activationMode: String(entitlement.activationMode || ''),
            createdAt: entitlement.createdAt || '',
            claimedAt: entitlement.claimedAt || '',
            createdBySuffix: entitlement.createdBy ? String(entitlement.createdBy).slice(-6) : '',
            note: String(entitlement.note || entitlement.remark || '')
          }
        : null
    }
  }

  async function enrichUsers(users = []) {
    const [entitlements, orders] = await Promise.all([
      getEntitlementsForUsers(users),
      getConfirmedOrdersForUsers(users)
    ])
    const entitlementMap = buildEntitlementMap(entitlements)
    const paymentMap = buildPaymentMaps(orders)
    return users.map(user => toUserDto(
      user,
      entitlementMap.get(normalizePhone(user.phone)) || {},
      resolveUserPayments(user, paymentMap)
    ))
  }

  function applyUserOrdering(query, sortBy) {
    if (sortBy === 'oldest_registration') return query.orderBy('registeredAt', 'asc')
    if (sortBy === 'expiry_soon') return query.orderBy('membershipEndAt', 'asc')
    if (sortBy === 'expiry_latest') return query.orderBy('membershipEndAt', 'desc')
    return query.orderBy('registeredAt', 'desc')
  }

  async function requireAdminOrReturn(wxContext) {
    const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
    return admin.ok ? { admin } : { response: fail(admin.code, admin.message) }
  }

  function isMaturedDeferredUser(user = {}, nowValue = Date.now()) {
    if (user.preauthDeferred !== true || user.phoneBound !== true) return false
    const startTimestamp = parseTimestamp(user.preauthDeferredStartAt)
    const nowTimestamp = parseTimestamp(nowValue)
    return Number.isFinite(startTimestamp) && Number.isFinite(nowTimestamp) && startTimestamp <= nowTimestamp
  }

  async function reconcileMaturedDeferredUser(user = {}) {
    if (!isMaturedDeferredUser(user) || typeof reconcileBoundPhoneUser !== 'function') return null
    const phone = normalizePhone(user.phone || user.phoneNormalized)
    if (!/^1\d{10}$/.test(phone)) return null
    try {
      return await reconcileBoundPhoneUser(user._id, phone)
    } catch (error) {
      console.warn('[user-membership-admin] deferred preauthorization reconciliation failed:', {
        userIdSuffix: user._id ? String(user._id).slice(-6) : '',
        message: error.message || String(error)
      })
      return null
    }
  }

  async function reconcileMaturedDeferredUsers() {
    if (typeof reconcileBoundPhoneUser !== 'function') return 0
    const dueAt = preauthorizationNow()
    const result = await db.collection(collections.users)
      .where({
        preauthDeferred: true,
        phoneBound: true,
        preauthDeferredStartAt: _.lte(dueAt)
      })
      .orderBy('preauthDeferredStartAt', 'asc')
      .limit(DEFERRED_RECONCILE_LIMIT)
      .get()
    const due = (result.data || [])
      .filter(item => isMaturedDeferredUser(item, dueAt))
    let reconciled = 0
    for (let offset = 0; offset < due.length; offset += 10) {
      const results = await Promise.all(due.slice(offset, offset + 10).map(reconcileMaturedDeferredUser))
      reconciled += results.filter(Boolean).length
    }
    return reconciled
  }

  async function adminListUsers(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    await reconcileMaturedDeferredUsers()
    const input = readInput(event)
    const { page, pageSize, skip } = getPagination(input)
    const condition = buildUserCondition(input)
    const baseQuery = createQuery(collections.users, condition)
    const [countResult, listResult] = await Promise.all([
      baseQuery.count(),
      applyUserOrdering(createQuery(collections.users, condition), input.sortBy).skip(skip).limit(pageSize).get()
    ])
    const list = await enrichUsers(listResult.data || [])
    const total = Number(countResult.total || 0)
    return success({
      list,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: {
        membershipState: String(input.membershipState || input.tab || 'all'),
        membershipType: String(input.membershipType || ''),
        keyword: String(input.keyword || '')
      }
    })
  }

  function preauthStatusLabel(status) {
    if (status === 'claimed') return '已领取'
    if (status === 'revoked') return '已撤销'
    if (status === 'expired') return '已过期'
    return '待注册'
  }

  function preauthActivationModeLabel(mode) {
    return mode === 'fixed' ? '固定时间授权' : '注册后激活'
  }

  function toPreauthDto(record = {}, nowValue = Date.now()) {
    const status = derivePreauthStatus(record, nowValue)
    const membershipType = normalizeMembershipType(record.authorizedMembershipType || record.membershipType)
    return {
      id: String(record._id || ''),
      phone: normalizePhone(record.phone),
      phoneMasked: maskPhone(record.phone),
      membershipType,
      membershipLabel: getMembershipLabel(membershipType),
      activationMode: String(record.activationMode || 'on_claim'),
      activationModeLabel: preauthActivationModeLabel(record.activationMode),
      durationDays: Number(record.durationDays || (membershipType === 'yearly' ? 365 : 90)),
      membershipStartAt: record.authorizedMembershipStartAt || record.membershipStartAt || '',
      membershipEndAt: record.authorizedMembershipEndAt || record.membershipEndAt || '',
      status,
      statusLabel: preauthStatusLabel(status),
      createdAt: record.createdAt || '',
      createdByName: String(record.createdByName || '管理员'),
      createdBySuffix: record.createdBy ? String(record.createdBy).slice(-6) : '',
      updatedAt: record.updatedAt || '',
      claimedAt: record.claimedAt || '',
      claimedUserId: String(record.claimedUserId || ''),
      revokedAt: record.revokedAt || '',
      note: String(record.note || record.remark || ''),
      source: '后台预授权',
      canEdit: status === 'pending',
      canRevoke: status === 'pending'
    }
  }

  function toPreauthAuditSnapshot(record = {}) {
    return {
      membershipType: String(record.authorizedMembershipType || record.membershipType || ''),
      activationMode: String(record.activationMode || ''),
      durationDays: Number(record.durationDays || 0),
      membershipStartAt: String(record.authorizedMembershipStartAt || record.membershipStartAt || ''),
      membershipEndAt: String(record.authorizedMembershipEndAt || record.membershipEndAt || ''),
      preauthStatus: String(record.preauthStatus || ''),
      note: sanitizeAuditText(record.note || record.remark || '')
    }
  }

  async function persistExpiredPreauthorizations(operationAt = preauthorizationNow()) {
    const todayText = formatShanghaiDate(operationAt)
    const expired = await fetchAll(collections.phoneEntitlements, _.and([
      { entitlementKind: PREAUTH_KIND },
      { preauthStatus: 'pending' },
      { activationMode: 'fixed' },
      { membershipEndAt: _.lt(todayText) }
    ]), { maxRows: 500 })
    for (let offset = 0; offset < expired.length; offset += 20) {
      const batch = expired.slice(offset, offset + 20)
      await Promise.all(batch.map(item => db.collection(collections.phoneEntitlements).doc(item._id).update({
        data: {
          preauthStatus: 'expired',
          membershipStatus: 'expired',
          expiredAt: operationAt,
          updatedAt: operationAt
        }
      })))
    }
    return expired.length
  }

  function buildPreauthCondition(input = {}, options = {}) {
    const conditions = [{ entitlementKind: PREAUTH_KIND }]
    const status = String(input.status == null ? (options.defaultStatus || 'pending') : input.status)
    const todayText = formatShanghaiDate(Date.now())
    if (status === 'pending') {
      conditions.push(_.and([
        { preauthStatus: 'pending' },
        _.or([
          { activationMode: 'on_claim' },
          { activationMode: _.exists(false) },
          _.and([
            { activationMode: 'fixed' },
            { membershipEndAt: _.gte(todayText) }
          ])
        ])
      ]))
    } else if (status === 'expired') {
      conditions.push(_.or([
        { preauthStatus: 'expired' },
        _.and([
          { preauthStatus: 'pending' },
          { activationMode: 'fixed' },
          { membershipEndAt: _.lt(todayText) }
        ])
      ]))
    } else if (status && status !== 'all') {
      conditions.push({ preauthStatus: status })
    }
    const membershipType = String(input.membershipType || '')
    if (MANAGED_MEMBER_TYPES.includes(membershipType)) {
      conditions.push(_.or([
        { authorizedMembershipType: membershipType },
        { membershipType }
      ]))
    }
    const keyword = String(input.keyword || '').trim()
    if (keyword) {
      const searchKeyword = normalizePreauthorizationKeyword(keyword, normalizePhone)
      const regexp = db.RegExp({ regexp: escapeRegExp(searchKeyword), options: 'i' })
      conditions.push(_.or([
        { phone: regexp },
        { phoneNormalized: regexp },
        { note: regexp },
        { remark: regexp }
      ]))
    }
    conditions.push(dateRangeCondition('createdAt', input.createdStartDate, input.createdEndDate))
    return combineConditions(conditions)
  }

  async function getPreauthCounts() {
    const statuses = ['pending', 'claimed', 'revoked', 'expired']
    const totals = await Promise.all(statuses.map(status => createQuery(
      collections.phoneEntitlements,
      buildPreauthCondition({ status }, { defaultStatus: status })
    ).count()))
    return statuses.reduce((result, status, index) => {
      result[status] = Number(totals[index].total || 0)
      return result
    }, {})
  }

  async function getPreauthorizationStats(startDate = '', endDate = '') {
    await persistExpiredPreauthorizations()
    const counts = await getPreauthCounts()
    let periodCreated = null
    let periodClaimed = null
    if (startDate && endDate) {
      const [createdResult, claimedResult] = await Promise.all([
        createQuery(collections.phoneEntitlements, combineConditions([
          { entitlementKind: PREAUTH_KIND },
          dateRangeCondition('createdAt', startDate, endDate)
        ])).count(),
        createQuery(collections.phoneEntitlements, combineConditions([
          { entitlementKind: PREAUTH_KIND },
          { preauthStatus: 'claimed' },
          dateRangeCondition('claimedAt', startDate, endDate)
        ])).count()
      ])
      periodCreated = Number(createdResult.total || 0)
      periodClaimed = Number(claimedResult.total || 0)
    }
    return {
      counts,
      periodCreated,
      periodClaimed,
      total: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
    }
  }

  async function adminListPreRegistrationEntitlements(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    const { page, pageSize, skip } = getPagination(input)
    await persistExpiredPreauthorizations()
    const condition = buildPreauthCondition(input)
    const [countResult, listResult, counts] = await Promise.all([
      createQuery(collections.phoneEntitlements, condition).count(),
      createQuery(collections.phoneEntitlements, condition)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get(),
      getPreauthCounts()
    ])
    const total = Number(countResult.total || 0)
    return success({
      list: (listResult.data || []).map(item => toPreauthDto(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      counts
    })
  }

  function buildPreauthAuditData(action, profile, targetId, phone, before, after) {
    return {
      action,
      operatorOpenid: profile.admin && profile.admin.openid || '',
      operatorRole: profile.role || '',
      operatorSource: profile.source || '',
      targetType: 'preRegistrationEntitlement',
      targetId,
      targetPhoneMasked: maskPhone(phone),
      preauthorizationChange: { before, after },
      payloadSummary: {
        status: after && after.preauthStatus || '',
        source: 'admin_preauthorization',
        remark: sanitizeAuditText(after && after.note || '')
      },
      createdAt: preauthorizationNow()
    }
  }

  async function getRegisteredUserByPhone(phone) {
    const result = await db.collection(collections.users)
      .where(_.or([{ phone }, { phoneNormalized: phone }]))
      .limit(1)
      .get()
    return result.data && result.data[0] || null
  }

  async function getPendingPreauthorizationByPhone(phone, nowValue = Date.now()) {
    const result = await db.collection(collections.phoneEntitlements)
      .where(_.or([{ phone }, { phoneNormalized: phone }]))
      .limit(20)
      .get()
    return (result.data || []).find(item =>
      String(item.entitlementKind || '') === PREAUTH_KIND &&
      String(item.status || 'active') === 'active' &&
      derivePreauthStatus(item, nowValue) === 'pending'
    ) || null
  }

  async function adminSavePreRegistrationEntitlement(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    const operatorOpenid = wxContext.OPENID || ''
    const operationAt = preauthorizationNow()
    const id = String(input.id || '').trim()
    const operationId = normalizeOperationId(input.operationId)
    if (!id && !operationId) {
      return fail('PREAUTH_OPERATION_ID_REQUIRED', '缺少预注册会员发放操作 ID，请刷新页面后重试。')
    }
    let normalized
    try {
      normalized = buildPreRegistrationEntitlement(input, {
        operationAt,
        operatorOpenid,
        operatorName: auth.admin.profile.admin && auth.admin.profile.admin.nickname || '管理员',
        operatorRole: auth.admin.profile.role || '',
        phoneMasked: maskPhone(input.phone)
      })
    } catch (error) {
      return fail(error.code || 'INVALID_PREAUTH_INPUT', error.message || '预授权信息无效。')
    }

    const revenueAuditId = operationId ? getRevenueAuditDocumentId(operationId) : ''
    const revenueRequestFingerprint = operationId ? getRevenueRequestFingerprint({
      kind: 'pre_registration',
      phone: normalized.phone,
      membershipType: normalized.membershipType,
      activationMode: normalized.activationMode,
      membershipStartAt: normalized.membershipStartAt || '',
      membershipEndAt: normalized.membershipEndAt || '',
      note: normalized.note || ''
    }) : ''
    if (!id && revenueAuditId) {
      try {
        const existingAuditResult = await db.collection(collections.auditLogs).where({ _id: revenueAuditId }).limit(1).get()
        const existingAudit = existingAuditResult.data && existingAuditResult.data[0] || null
        if (existingAudit) {
          if (String(existingAudit.revenueRequestFingerprint || '') !== revenueRequestFingerprint) {
            return fail('PREAUTH_OPERATION_ID_CONFLICT', '预注册会员操作 ID 已用于不同的发放请求。')
          }
          const existingEntitlementResult = await db.collection(collections.phoneEntitlements)
            .doc(String(existingAudit.targetId || ''))
            .get()
          if (existingEntitlementResult.data) {
            return success({ entitlement: toPreauthDto(existingEntitlementResult.data), duplicate: true })
          }
        }
      } catch (error) {
        // 文档不存在时继续正常创建；其他冲突仍会在事务内再次校验。
      }
    }

    const registeredBeforeSave = await getRegisteredUserByPhone(normalized.phone)
    if (registeredBeforeSave) {
      const pendingPreauthorization = await getPendingPreauthorizationByPhone(normalized.phone, operationAt)
      if (pendingPreauthorization && typeof reconcileBoundPhoneUser === 'function') {
        try {
          const reconciliation = await reconcileBoundPhoneUser(registeredBeforeSave._id, normalized.phone)
          if (reconciliation && reconciliation.claimed) {
            return success({
              entitlement: toPreauthDto(reconciliation.entitlement),
              reconciled: true,
              registeredUserId: registeredBeforeSave._id
            })
          }
        } catch (error) {
          return fail('PREAUTH_RECONCILE_FAILED', '该手机号已注册，已有预授权自动领取失败，请重试。', {
            registeredUser: toUserDto(registeredBeforeSave),
            retryable: true
          })
        }
      }
      return fail('PHONE_ALREADY_REGISTERED', '该手机号已经注册，请直接为现有用户添加会员。', {
        registeredUser: toUserDto(registeredBeforeSave)
      })
    }

    let saved
    try {
      saved = await db.runTransaction(async transaction => {
        const entitlements = transaction.collection(collections.phoneEntitlements)
        const auditLogs = transaction.collection(collections.auditLogs)
        if (!id && revenueAuditId) {
          const existingAuditResult = await auditLogs.where({ _id: revenueAuditId }).limit(1).get()
          const existingAudit = existingAuditResult.data && existingAuditResult.data[0] || null
          if (existingAudit) {
            if (String(existingAudit.revenueRequestFingerprint || '') !== revenueRequestFingerprint) {
              throw Object.assign(new Error('预注册会员操作 ID 已用于不同的发放请求。'), {
                code: 'PREAUTH_OPERATION_ID_CONFLICT'
              })
            }
            const existingEntitlementResult = await entitlements.doc(String(existingAudit.targetId || '')).get()
            if (existingEntitlementResult.data) return existingEntitlementResult.data
          }
        }
        const deterministicId = getPreauthorizationDocumentId(normalized.phone)
        const deterministicResult = await entitlements
          .where({ _id: deterministicId })
          .limit(1)
          .get()
        const phoneResult = await entitlements
          .where(_.or([{ phone: normalized.phone }, { phoneNormalized: normalized.phone }]))
          .limit(20)
          .get()
        const samePhoneRecords = [
          ...(deterministicResult.data || []),
          ...(phoneResult.data || [])
        ].filter((item, index, records) =>
          item.historyArchive !== true &&
          records.findIndex(record => String(record._id || '') === String(item._id || '')) === index
        )
        const targetResult = id
          ? await entitlements.where({ _id: id, entitlementKind: PREAUTH_KIND }).limit(1).get()
          : { data: [] }
        const target = targetResult.data && targetResult.data[0] || null
        if (target && normalizePhone(target.phone || target.phoneNormalized) !== normalized.phone) {
          throw Object.assign(new Error('编辑待注册授权时不能修改手机号；如手机号录入错误，请撤销后重新创建。'), {
            code: 'PREAUTH_PHONE_CHANGE_NOT_ALLOWED'
          })
        }
        const inspection = inspectPreauthorizationSave({
          // 事务前已排除存量用户。与注册并发时先落预授权，
          // 事务后 reconciliation 会立即且幂等地领取。
          registeredUser: null,
          requestedId: id,
          target,
          samePhoneRecords,
          nowValue: operationAt
        })
        if (inspection.conflict) {
          const messages = {
            PHONE_ALREADY_REGISTERED: '该手机号已经注册，请直接为现有用户添加会员。',
            PREAUTH_NOT_FOUND: '待注册授权不存在。',
            PREAUTH_NOT_EDITABLE: '只有待注册状态的授权可以编辑。',
            PREAUTH_ALREADY_EXISTS: '该手机号已有待注册授权，请编辑现有记录。',
            PREAUTH_ALREADY_CLAIMED: '该手机号已有已领取的预授权记录，请先核对用户状态。',
            PHONE_ENTITLEMENT_ALREADY_ACTIVE: '该手机号已有生效中的手机号会员授权。'
          }
          throw Object.assign(new Error(messages[inspection.conflict] || '预授权冲突。'), {
            code: inspection.conflict,
            registeredUserId: inspection.registeredUserId || '',
            entitlementId: inspection.entitlementId || ''
          })
        }

        const reusable = inspection.reusable
        const record = buildPreRegistrationEntitlement(input, {
          existing: reusable,
          operationAt,
          operatorOpenid,
          operatorName: auth.admin.profile.admin && auth.admin.profile.admin.nickname || '管理员',
          operatorRole: auth.admin.profile.role || '',
          phoneMasked: maskPhone(normalized.phone)
        })
        const documentId = reusable && reusable._id || deterministicId
        const currentSlot = !reusable
          ? (deterministicResult.data && deterministicResult.data[0] || null)
          : null
        if (currentSlot) {
          const { _id, ...historyData } = currentSlot
          const historyId = `${documentId}_history_${operationAt.replace(/\D/g, '')}`
          await entitlements.doc(historyId).set({
            data: {
              ...historyData,
              historyArchive: true,
              archivedAt: operationAt,
              archivedFromId: documentId
            }
          })
        }
        if (reusable) await entitlements.doc(documentId).update({ data: record })
        else await entitlements.doc(documentId).set({ data: record })

        const beforeRecord = reusable || currentSlot
        const before = beforeRecord ? toPreauthAuditSnapshot(beforeRecord) : null
        const after = toPreauthAuditSnapshot(record)
        const auditAction = reusable && target ? 'PREAUTH_UPDATE' : 'PREAUTH_CREATE'
        const auditData = buildPreauthAuditData(
            auditAction,
            auth.admin.profile,
            documentId,
            normalized.phone,
            before,
            after
          )
        if (auditAction === 'PREAUTH_CREATE') {
          const product = getMembershipProductByType(record.membershipType)
          if (!product) {
            throw Object.assign(new Error('会员商品价格配置不存在。'), { code: 'MEMBERSHIP_PRODUCT_PRICE_MISSING' })
          }
          await auditLogs.doc(revenueAuditId).set({
            data: {
              ...auditData,
              operationId,
              revenueOperationId: operationId,
              revenueRequestFingerprint,
              revenueSource: ADMIN_GRANT_REVENUE_SOURCE,
              revenueAmountFen: product.priceFen,
              revenueProductId: product.productId,
              revenueMembershipType: product.membershipType,
              revenueOperatorOpenid: operatorOpenid,
              revenueEntitlementDurationDays: product.durationDays,
              revenueEntitlementExpiry: record.membershipEndAt || '',
              revenueCreatedAt: operationAt
            }
          })
        } else {
          await auditLogs.add({ data: auditData })
        }
        return { _id: documentId, ...record }
      })
    } catch (error) {
      if (error.code === 'PHONE_ALREADY_REGISTERED') {
        const user = await getUserById(error.registeredUserId)
        if (user && typeof reconcileBoundPhoneUser === 'function') {
          const reconciliation = await reconcileBoundPhoneUser(user._id, normalized.phone)
          if (reconciliation && reconciliation.claimed) {
            return success({
              entitlement: toPreauthDto(reconciliation.entitlement),
              reconciled: true,
              registeredUserId: user._id
            })
          }
        }
        return fail(error.code, error.message, {
          registeredUser: user ? toUserDto(user) : { userId: error.registeredUserId }
        })
      }
      return fail(error.code || 'PREAUTH_SAVE_FAILED', error.message || '待注册授权保存失败。', {
        entitlementId: error.entitlementId || ''
      })
    }

    const registeredAfterSave = await getRegisteredUserByPhone(normalized.phone)
    let reconciliation = null
    let reconciliationPending = false
    if (registeredAfterSave && typeof reconcileBoundPhoneUser === 'function') {
      try {
        reconciliation = await reconcileBoundPhoneUser(registeredAfterSave._id, normalized.phone)
        reconciliationPending = !Boolean(reconciliation && reconciliation.claimed)
      } catch (error) {
        reconciliationPending = true
        console.warn('[user-membership-admin] post-save preauthorization reconciliation failed:', {
          userIdSuffix: registeredAfterSave._id ? String(registeredAfterSave._id).slice(-6) : '',
          message: error.message || String(error)
        })
      }
    }
    return success({
      entitlement: toPreauthDto(reconciliation && reconciliation.entitlement || saved),
      reconciled: Boolean(reconciliation && reconciliation.claimed),
      reconciliationPending,
      registeredUserId: registeredAfterSave && registeredAfterSave._id || ''
    })
  }

  async function adminRevokePreRegistrationEntitlement(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    const id = String(input.id || '').trim()
    const reason = String(input.reason || '').trim().slice(0, 300)
    if (!id) return fail('PREAUTH_ID_REQUIRED', '缺少待注册授权 ID。')
    if (!reason) return fail('PREAUTH_REVOKE_REASON_REQUIRED', '请填写撤销原因。')
    const operationAt = preauthorizationNow()
    try {
      const revoked = await db.runTransaction(async transaction => {
        const entitlements = transaction.collection(collections.phoneEntitlements)
        const auditLogs = transaction.collection(collections.auditLogs)
        const result = await entitlements.where({ _id: id, entitlementKind: PREAUTH_KIND }).limit(1).get()
        const current = result.data && result.data[0] || null
        if (!current) throw Object.assign(new Error('待注册授权不存在。'), { code: 'PREAUTH_NOT_FOUND' })
        const patch = buildPreauthorizationRevocation(current, {
          operationAt,
          operatorOpenid: wxContext.OPENID || '',
          reason
        })
        await entitlements.doc(id).update({ data: patch })
        await auditLogs.add({
          data: buildPreauthAuditData(
            'PREAUTH_REVOKE',
            auth.admin.profile,
            id,
            current.phone,
            toPreauthAuditSnapshot(current),
            toPreauthAuditSnapshot({ ...current, ...patch, note: reason })
          )
        })
        return { ...current, ...patch }
      })
      return success({ entitlement: toPreauthDto(revoked) })
    } catch (error) {
      return fail(error.code || 'PREAUTH_REVOKE_FAILED', error.message || '撤销失败。')
    }
  }

  async function fetchAllConfirmedOrders() {
    return fetchAll(collections.virtualPaymentOrders, _.and([
      { status: _.in(SUCCESSFUL_PAYMENT_STATUSES) },
      { paymentProvider: 'wechat_virtual_payment' }
    ]), {
      orderBy: [['paidAt', 'desc']],
      maxRows: Infinity
    })
  }

  async function fetchAllAdminGrantRevenue() {
    return fetchAll(collections.auditLogs, { revenueSource: ADMIN_GRANT_REVENUE_SOURCE }, {
      maxRows: Infinity
    })
  }

  async function countRegisteredPaidUsers(orders = []) {
    const payments = dedupeConfirmedPayments(orders)
    const openids = Array.from(new Set(payments.map(item => item.openid).filter(Boolean)))
    const phones = Array.from(new Set(payments.map(item => item.phone).filter(Boolean)))
    const ids = new Set()
    const chunkSize = 20
    const maxLength = Math.max(openids.length, phones.length)
    for (let offset = 0; offset < maxLength; offset += chunkSize) {
      const clauses = []
      const openidChunk = openids.slice(offset, offset + chunkSize)
      const phoneChunk = phones.slice(offset, offset + chunkSize)
      if (openidChunk.length) clauses.push({ openid: _.in(openidChunk) })
      if (phoneChunk.length) clauses.push({ phone: _.in(phoneChunk) })
      if (!clauses.length) continue
      const users = await fetchAll(collections.users, _.or(clauses), { maxRows: chunkSize * 3 })
      users.forEach(user => ids.add(user._id))
    }
    return ids.size
  }

  function dateRangeStrings(days, endDate = formatShanghaiDate(Date.now())) {
    const startDate = addShanghaiDays(endDate, -(Math.max(1, Number(days || 1)) - 1))
    return { startDate, endDate }
  }

  async function countRegisteredRange(days) {
    const range = dateRangeStrings(days)
    return countUsers({ registeredStartDate: range.startDate, registeredEndDate: range.endDate })
  }

  async function countMembershipStarts(days) {
    const range = dateRangeStrings(days)
    const condition = combineConditions([
      { membershipType: _.in(MANAGED_MEMBER_TYPES) },
      dateRangeCondition('membershipStartAt', range.startDate, range.endDate, { mixedDate: true })
    ])
    const result = await createQuery(collections.users, condition).count()
    return Number(result.total || 0)
  }

  function groupRowsByDay(rows, field, startDate, endDate, sourceResolver) {
    const series = []
    const map = new Map()
    let cursor = startDate
    while (cursor && cursor <= endDate && series.length < 370) {
      const item = sourceResolver
        ? { label: cursor, total: 0, paid: 0, admin: 0 }
        : { label: cursor, count: 0 }
      map.set(cursor, item)
      series.push(item)
      cursor = addShanghaiDays(cursor, 1)
    }
    for (const row of rows) {
      const key = formatShanghaiDate(row[field])
      const item = map.get(key)
      if (!item) continue
      if (!sourceResolver) item.count += 1
      else {
        item.total += 1
        item[sourceResolver(row) === 'paid' ? 'paid' : 'admin'] += 1
      }
    }
    return series
  }

  async function buildGrowthTrends(days = 30, requestedStartDate = '', requestedEndDate = '') {
    const safeDays = Math.min(365, Math.max(7, Number(days || 30)))
    const range = requestedStartDate && requestedEndDate
      ? { startDate: requestedStartDate, endDate: requestedEndDate }
      : dateRangeStrings(safeDays)
    getShanghaiDateRange(range.startDate, range.endDate)
    const { startDate, endDate } = range
    const [users, memberships] = await Promise.all([
      fetchAll(collections.users, dateRangeCondition('registeredAt', startDate, endDate), { maxRows: 50000 }),
      fetchAll(collections.users, combineConditions([
        { membershipType: _.in(MANAGED_MEMBER_TYPES) },
        dateRangeCondition('membershipStartAt', startDate, endDate, { mixedDate: true })
      ]), { maxRows: 50000 })
    ])
    return {
      userTrend: groupRowsByDay(users, 'registeredAt', startDate, endDate),
      membershipTrend: groupRowsByDay(
        memberships,
        'membershipStartAt',
        startDate,
        endDate,
        item => String(item.membershipSource || '') === 'wechat_virtual_payment' ? 'paid' : 'admin'
      ),
      startDate,
      endDate
    }
  }

  async function adminUserOverview(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    await reconcileMaturedDeferredUsers()
    const input = readInput(event)
    const trendDays = Math.min(365, Math.max(7, Number(input.trendDays || 30)))
    const periodStartDate = String(input.startDate || '')
    const periodEndDate = String(input.endDate || '')
    const [
      totalUsers,
      activeMembers,
      expiredMembers,
      ordinaryUsers,
      todayNewUsers,
      sevenDayNewUsers,
      thirtyDayNewUsers,
      todayNewMembers,
      sevenDayNewMembers,
      thirtyDayNewMembers,
      expiring7,
      expiring30,
      orders,
      manualRevenueRecords,
      trends,
      periodNewUsers,
      periodNewMembers,
      preauthorizationStats
    ] = await Promise.all([
      countUsers(),
      countUsers({ membershipState: 'active' }),
      countUsers({ membershipState: 'expired' }),
      countUsers({ membershipState: 'ordinary' }),
      countRegisteredRange(1),
      countRegisteredRange(7),
      countRegisteredRange(30),
      countMembershipStarts(1),
      countMembershipStarts(7),
      countMembershipStarts(30),
      countUsers({ membershipState: 'expiring7' }),
      countUsers({ membershipState: 'expiring30' }),
      fetchAllConfirmedOrders(),
      fetchAllAdminGrantRevenue(),
      buildGrowthTrends(trendDays, periodStartDate, periodEndDate),
      periodStartDate && periodEndDate
        ? countUsers({ registeredStartDate: periodStartDate, registeredEndDate: periodEndDate })
        : Promise.resolve(null),
      periodStartDate && periodEndDate
        ? (async () => {
          const condition = combineConditions([
            { membershipType: _.in(MANAGED_MEMBER_TYPES) },
            dateRangeCondition('membershipStartAt', periodStartDate, periodEndDate, { mixedDate: true })
          ])
          const result = await createQuery(collections.users, condition).count()
          return Number(result.total || 0)
        })()
        : Promise.resolve(null),
      getPreauthorizationStats(periodStartDate, periodEndDate)
    ])
    const revenue = aggregateRevenue(orders, Date.now(), manualRevenueRecords)
    const paidUsers = await countRegisteredPaidUsers(orders)
    return success({
      counts: {
        all: totalUsers,
        ordinary: ordinaryUsers,
        active: activeMembers,
        expired: expiredMembers,
        todayNewUsers,
        sevenDayNewUsers,
        thirtyDayNewUsers,
        todayNewMembers,
        sevenDayNewMembers,
        thirtyDayNewMembers,
        periodNewUsers,
        periodNewMembers,
        expiring7,
        expiring30,
        paidUsers,
        paidConversionRate: totalUsers > 0 ? Number((paidUsers / totalUsers).toFixed(4)) : 0,
        pendingPreauthorizations: preauthorizationStats.counts.pending,
        claimedPreauthorizations: preauthorizationStats.counts.claimed,
        revokedPreauthorizations: preauthorizationStats.counts.revoked,
        expiredPreauthorizations: preauthorizationStats.counts.expired,
        periodPreauthorizationsCreated: preauthorizationStats.periodCreated,
        periodPreauthorizationsClaimed: preauthorizationStats.periodClaimed
      },
      revenue: {
        today: revenue.today,
        week: revenue.week,
        month: revenue.month,
        year: revenue.year,
        basis: revenue.revenueBasis,
        refundBasis: revenue.refundBasis
      },
      trends,
      generatedAt: now()
    })
  }

  async function getUserById(userId) {
    const id = String(userId || '').trim()
    if (!id) return null
    try {
      const result = await db.collection(collections.users).doc(id).get()
      return result.data || null
    } catch (error) {
      return null
    }
  }

  function toPaymentHistory(payments = []) {
    return payments.map(payment => ({
      kind: 'payment',
      orderNo: payment.orderNo,
      membershipType: payment.membershipType,
      membershipLabel: payment.membershipLabel,
      startAt: '',
      endAt: '',
      amountFen: payment.confirmedFen,
      source: '微信支付',
      status: payment.status,
      happenedAt: payment.paidAt,
      happenedAtLabel: formatShanghaiDate(payment.paidTimestamp, true)
    }))
  }

  function sanitizeMembershipAudit(log = {}) {
    const change = log.membershipChange || {}
    const isPreauthorizationClaim = String(log.action || '') === 'PREAUTH_CLAIM'
    const isAdminGrantRevenue = String(log.revenueSource || '') === ADMIN_GRANT_REVENUE_SOURCE
    return {
      kind: 'admin',
      action: log.action || '',
      actionLabel: change.actionLabel || (isPreauthorizationClaim ? '后台预授权领取' : '后台调整会员'),
      membershipType: change.after && change.after.membershipType || '',
      membershipLabel: getMembershipLabel(change.after && change.after.membershipType),
      startAt: change.after && change.after.membershipStartAt || '',
      endAt: change.after && change.after.membershipEndAt || '',
      amountFen: isAdminGrantRevenue ? Number(log.revenueAmountFen) : null,
      source: isPreauthorizationClaim ? '后台预授权领取' : (isAdminGrantRevenue ? '后台人工添加' : '后台添加'),
      revenueSource: isAdminGrantRevenue ? ADMIN_GRANT_REVENUE_SOURCE : '',
      operationId: isAdminGrantRevenue ? String(log.revenueOperationId || log.operationId || '') : '',
      status: change.after && change.after.membershipStatus || '',
      reason: change.reason || '',
      operatorSuffix: log.operatorOpenid ? String(log.operatorOpenid).slice(-6) : '',
      happenedAt: log.createdAt || '',
      happenedAtLabel: formatShanghaiDate(log.createdAt, true),
      preauthorization: isPreauthorizationClaim ? (log.preauthorization || null) : null
    }
  }

  async function getUserAuditLogs(userId) {
    try {
      const result = await db.collection(collections.auditLogs)
        .where({ targetType: 'userMembership', targetId: userId })
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      return (result.data || []).map(sanitizeMembershipAudit)
    } catch (error) {
      return []
    }
  }

  async function adminGetUserDetail(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    let user = await getUserById(input.userId)
    if (!user) return fail('USER_NOT_FOUND', '用户不存在。')
    const reconciliation = await reconcileMaturedDeferredUser(user)
    if (reconciliation && reconciliation.user) user = reconciliation.user
    const [list, audits] = await Promise.all([enrichUsers([user]), getUserAuditLogs(user._id)])
    const dto = list[0]
    const orders = await getConfirmedOrdersForUsers([user])
    const payments = dedupeConfirmedPayments(orders)
    const history = toPaymentHistory(payments).concat(audits)
      .sort((a, b) => parseTimestamp(b.happenedAt) - parseTimestamp(a.happenedAt))
    return success({ user: dto, history, auditLogs: audits })
  }

  function normalizeAdminMembershipInput(input = {}, current = {}) {
    return buildManagedMembershipChange(input)
  }

  function actionLabel(action) {
    if (action === 'add') return '后台添加会员'
    if (action === 'extend') return '后台延长会员'
    if (action === 'restore') return '后台恢复会员'
    if (action === 'end') return '后台提前结束会员'
    return '后台编辑会员'
  }

  async function adminUpdateUserMembership(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    const userId = String(input.userId || '').trim()
    const reason = String(input.reason || '').trim().slice(0, 200)
    const operationId = normalizeOperationId(input.operationId)
    if (!userId) return fail('MISSING_USER_ID', '缺少用户 ID。')
    if (!reason) return fail('MEMBERSHIP_REASON_REQUIRED', '请填写本次会员调整原因。')
    if (String(input.membershipAction || '') !== 'end' && !operationId) {
      return fail('MEMBERSHIP_OPERATION_ID_REQUIRED', '缺少会员发放操作 ID，请刷新页面后重试。')
    }

    let user = await getUserById(userId)
    if (!user) return fail('USER_NOT_FOUND', '用户不存在。')
    if (normalizeMembershipType(user.membershipType) === 'admin' || user.isAdmin === true) {
      return fail('ADMIN_MEMBERSHIP_NOT_EDITABLE', '管理员身份不能在会员中心修改。')
    }
    const phone = normalizePhone(user.phone)
    if (user.phoneBound !== true || !/^1\d{10}$/.test(phone)) {
      return fail('PHONE_REQUIRED', '目标用户尚未绑定有效手机号，不能调整会员。')
    }
    if (typeof reconcileBoundPhoneUser === 'function') {
      const reconciliation = await reconcileBoundPhoneUser(userId, phone)
      if (reconciliation && reconciliation.user) user = reconciliation.user
    }

    const operatorOpenid = wxContext.OPENID || ''
    const operationAt = preauthorizationNow()
    const expectedMembership = membershipSnapshot(user)
    const revenueRequestFingerprint = operationId ? getRevenueRequestFingerprint({
      kind: 'registered_user',
      userId,
      membershipAction: String(input.membershipAction || ''),
      membershipType: String(input.membershipType || ''),
      startDate: String(input.startDate || ''),
      endDate: String(input.endDate || ''),
      reason
    }) : ''

    try {
      await db.runTransaction(async transaction => {
        const users = transaction.collection(collections.users)
        const entitlements = transaction.collection(collections.phoneEntitlements)
        const auditLogs = transaction.collection(collections.auditLogs)
        const revenueAuditId = operationId ? getRevenueAuditDocumentId(operationId) : ''
        if (revenueAuditId) {
          const existingOperationResult = await auditLogs.where({ _id: revenueAuditId }).limit(1).get()
          const existingOperation = existingOperationResult.data && existingOperationResult.data[0] || null
          if (existingOperation) {
            if (
              String(existingOperation.targetId || '') !== userId ||
              String(existingOperation.revenueRequestFingerprint || '') !== revenueRequestFingerprint
            ) {
              throw Object.assign(new Error('会员操作 ID 已被其他发放使用。'), { code: 'MEMBERSHIP_OPERATION_ID_CONFLICT' })
            }
            return { duplicate: true }
          }
        }
        const userResult = await users.doc(userId).get()
        const currentUser = userResult.data || null
        if (!currentUser) throw Object.assign(new Error('用户不存在。'), { code: 'USER_NOT_FOUND' })
        const currentPhone = normalizePhone(currentUser.phone)
        if (currentUser.phoneBound !== true || currentPhone !== phone) {
          throw Object.assign(new Error('用户手机号状态已变化，请刷新后重试。'), {
            code: 'MEMBERSHIP_CHANGED_RETRY'
          })
        }
        if (JSON.stringify(membershipSnapshot(currentUser)) !== JSON.stringify(expectedMembership)) {
          throw Object.assign(new Error('会员状态已被其他操作更新，请刷新后重试。'), {
            code: 'MEMBERSHIP_CHANGED_RETRY'
          })
        }

        let next
        try {
          next = normalizeAdminMembershipInput(input, currentUser)
        } catch (error) {
          throw Object.assign(error, { code: error.code || 'INVALID_MEMBERSHIP_INPUT' })
        }
        const limits = getMembershipLimits(next.membershipType)
        const before = membershipSnapshot(currentUser)
        const after = {
          membershipType: next.membershipType,
          membershipStatus: next.membershipStatus,
          membershipStartAt: next.membershipStartAt,
          membershipEndAt: next.membershipEndAt || '',
          source: 'admin',
          status: 'active'
        }
        const revenueEligible = next.action !== 'end' && isMembershipValueIncrease(before, after)
        const product = revenueEligible ? getMembershipProductByType(next.membershipType) : null
        if (revenueEligible && !product) {
          throw Object.assign(new Error('会员商品价格配置不存在。'), { code: 'MEMBERSHIP_PRODUCT_PRICE_MISSING' })
        }
        const entitlementResult = await entitlements
          .where(_.or([{ phone }, { phoneNormalized: phone }]))
          .limit(20)
          .get()
        const entitlement = (entitlementResult.data || [])
          .filter(isDirectPhoneEntitlement)
          .sort((left, right) => entitlementPriority(right) - entitlementPriority(left))[0] || null
        const common = {
          membershipType: next.membershipType,
          membershipStatus: next.membershipStatus,
          membershipStartAt: next.membershipStartAt,
          membershipEndAt: next.membershipEndAt,
          role: 'user',
          isAdmin: false,
          aiDailyLimit: limits.aiDailyLimit,
          aiMonthlyLimit: limits.aiMonthlyLimit,
          updatedAt: operationAt
        }
        await users.doc(userId).update({
          data: {
            ...common,
            membershipSource: 'admin'
          }
        })

        const entitlementPatch = {
          ...common,
          name: String(currentUser.nickname || entitlement && entitlement.name || '').trim(),
          phone,
          phoneNormalized: phone,
          phoneMasked: maskPhone(phone),
          membershipLabel: getMembershipLabel(next.membershipType),
          source: 'admin',
          status: 'active',
          remark: reason,
          updatedBy: operatorOpenid,
          lastAdminActionAt: operationAt
        }
        if (entitlement) {
          await entitlements.doc(entitlement._id).update({ data: entitlementPatch })
        } else {
          await entitlements.add({
            data: {
              ...entitlementPatch,
              createdAt: operationAt,
              createdBy: operatorOpenid
            }
          })
        }

        const auditData = {
            action: `adminMembership:${next.action}`,
            operatorOpenid,
            operatorRole: auth.admin.profile.role,
            operatorSource: auth.admin.profile.source,
            targetType: 'userMembership',
            targetId: userId,
            targetPhoneMasked: maskPhone(phone),
            membershipChange: {
              actionLabel: actionLabel(next.action),
              before,
              after,
              reason
            },
            ...(revenueEligible ? {
              operationId,
              revenueOperationId: operationId,
              revenueRequestFingerprint,
              revenueSource: ADMIN_GRANT_REVENUE_SOURCE,
              revenueAmountFen: product.priceFen,
              revenueProductId: product.productId,
              revenueMembershipType: product.membershipType,
              revenueUserId: userId,
              revenueOperatorOpenid: operatorOpenid,
              revenueEntitlementDurationDays: product.durationDays,
              revenueEntitlementExpiry: after.membershipEndAt,
              revenueCreatedAt: operationAt
            } : {}),
            createdAt: operationAt
          }
        if (revenueEligible) await auditLogs.doc(revenueAuditId).set({ data: auditData })
        else await auditLogs.add({ data: auditData })
      })
    } catch (error) {
      return fail(error.code || 'MEMBERSHIP_UPDATE_FAILED', error.message || '会员信息更新失败。')
    }

    return adminGetUserDetail({ userId }, wxContext)
  }

  async function countManualActiveMembers() {
    const records = await fetchAll(collections.phoneEntitlements, _.and([
      { membershipType: _.in(MANAGED_MEMBER_TYPES) },
      { membershipStatus: 'active' },
      { status: 'active' }
    ]), { maxRows: 50000 })
    return countUniqueActiveManualMembers(records, normalizePhone)
  }

  async function adminRevenueOverview(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    const rangeType = ['7d', '30d', 'year', 'custom'].includes(input.rangeType) ? input.rangeType : '30d'
    let range
    if (rangeType === 'custom') {
      range = { startDate: input.startDate, endDate: input.endDate }
      getShanghaiDateRange(range.startDate, range.endDate)
    } else if (rangeType === 'year') {
      range = { startDate: `${formatShanghaiDate(Date.now()).slice(0, 4)}-01-01`, endDate: formatShanghaiDate(Date.now()) }
    } else {
      range = dateRangeStrings(rangeType === '7d' ? 7 : 30)
    }
    const [orders, manualRevenueRecords, manualGrantCount] = await Promise.all([
      fetchAllConfirmedOrders(),
      fetchAllAdminGrantRevenue(),
      countManualActiveMembers()
    ])
    const revenue = aggregateRevenue(orders, Date.now(), manualRevenueRecords)
    return success({
      metrics: {
        today: revenue.today,
        week: revenue.week,
        month: revenue.month,
        year: revenue.year,
        all: revenue.all
      },
      paymentMetrics: revenue.payment,
      manualMetrics: revenue.manual,
      revenueDetails: revenue.payments.map(item => ({
        id: item.orderNo || item.id,
        source: 'payment',
        sourceLabel: '微信支付',
        membershipLabel: item.membershipLabel,
        amountFen: item.confirmedFen,
        happenedAt: formatShanghaiDate(item.paidTimestamp, true)
      })).concat(revenue.manualGrants.map(item => ({
        id: item.operationId,
        source: ADMIN_GRANT_REVENUE_SOURCE,
        sourceLabel: '后台人工添加',
        membershipLabel: item.membershipLabel,
        amountFen: item.confirmedFen,
        happenedAt: formatShanghaiDate(item.paidTimestamp, true)
      }))).sort((left, right) => parseTimestamp(right.happenedAt) - parseTimestamp(left.happenedAt)).slice(0, 50),
      trend: buildDailyRevenueTrend(orders, range.startDate, range.endDate, manualRevenueRecords),
      packages: revenue.packages,
      history: {
        week: buildRevenueHistory(orders, 'week', manualRevenueRecords).slice(0, 20),
        month: buildRevenueHistory(orders, 'month', manualRevenueRecords).slice(0, 24),
        year: buildRevenueHistory(orders, 'year', manualRevenueRecords).slice(0, 10)
      },
      manualGrantCount,
      paidUserCount: revenue.paidUserCount,
      range,
      revenueBasis: revenue.revenueBasis,
      refundBasis: revenue.refundBasis,
      note: '总收益包含微信虚拟支付与后台人工会员发放；支付收入仅统计微信虚拟支付已确认成功订单。'
    })
  }

  async function collectExportRows(input = {}) {
    const condition = buildUserCondition(input)
    const users = await fetchAll(collections.users, condition, {
      orderBy: [['registeredAt', 'desc']],
      maxRows: MAX_EXPORT_ROWS + 1
    })
    if (users.length > MAX_EXPORT_ROWS) {
      throw Object.assign(new Error(`单次最多导出 ${MAX_EXPORT_ROWS} 条，请缩小筛选范围。`), {
        code: 'EXPORT_TOO_LARGE'
      })
    }
    return enrichUsers(users)
  }

  async function uploadGeneratedFile(cloudPath, fileContent) {
    const uploaded = await cloud.uploadFile({ cloudPath, fileContent })
    const result = await cloud.getTempFileURL({ fileList: [uploaded.fileID] })
    const file = result.fileList && result.fileList[0] || {}
    return { fileID: uploaded.fileID, tempFileURL: file.tempFileURL || '' }
  }

  async function adminExportUsersCsv(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    let rows
    try {
      rows = await collectExportRows(input)
    } catch (error) {
      return fail(error.code || 'EXPORT_FAILED', error.message || '导出失败。')
    }
    const dateText = formatShanghaiDate(Date.now())
    const filename = `users-members-${dateText}.csv`
    const uploaded = await uploadGeneratedFile(
      `admin-exports/${dateText}/${Date.now()}-${filename}`,
      Buffer.from(buildUsersCsv(rows), 'utf8')
    )
    await writeAuditLog('adminExportUsersCsv', auth.admin.profile, {
      targetType: 'adminExport',
      targetId: uploaded.fileID,
      payloadSummary: {
        status: 'generated',
        source: 'user_membership_admin',
        remark: `rows=${rows.length}`
      }
    })
    return success({ ...uploaded, filename, rowCount: rows.length, expiresWithTempUrl: true })
  }

  async function adminExportPreRegistrationCsv(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    const input = readInput(event)
    await persistExpiredPreauthorizations()
    const condition = buildPreauthCondition({
      ...input,
      status: input.status == null ? 'all' : input.status
    }, { defaultStatus: 'all' })
    const records = await fetchAll(collections.phoneEntitlements, condition, {
      orderBy: [['createdAt', 'desc']],
      maxRows: MAX_EXPORT_ROWS + 1
    })
    if (records.length > MAX_EXPORT_ROWS) {
      return fail('EXPORT_TOO_LARGE', `单次最多导出 ${MAX_EXPORT_ROWS} 条，请缩小筛选范围。`)
    }
    const rows = records.map(item => toPreauthDto(item))
    const dateText = formatShanghaiDate(Date.now())
    const filename = `pre-registration-entitlements-${dateText}.csv`
    const uploaded = await uploadGeneratedFile(
      `admin-exports/${dateText}/${Date.now()}-${filename}`,
      Buffer.from(buildPreRegistrationCsv(rows), 'utf8')
    )
    await writeAuditLog('PREAUTH_EXPORT', auth.admin.profile, {
      targetType: 'adminExport',
      targetId: uploaded.fileID,
      payloadSummary: {
        status: 'generated',
        source: 'pre_registration_entitlement',
        remark: `rows=${rows.length}`
      }
    })
    return success({ ...uploaded, filename, rowCount: rows.length, expiresWithTempUrl: true })
  }

  async function adminGenerateOperationsPdf(event, wxContext) {
    const auth = await requireAdminOrReturn(wxContext)
    if (auth.response) return auth.response
    if (typeof buildOperationsPdf !== 'function') {
      return fail('PDF_GENERATOR_UNAVAILABLE', 'PDF 生成组件不可用。')
    }
    const input = readInput(event)
    const startDate = String(input.startDate || `${formatShanghaiDate(Date.now()).slice(0, 7)}-01`)
    const endDate = String(input.endDate || formatShanghaiDate(Date.now()))
    try {
      getShanghaiDateRange(startDate, endDate)
    } catch (error) {
      return fail('INVALID_REPORT_RANGE', error.message)
    }
    const [overview, revenueResult] = await Promise.all([
      adminUserOverview({ trendDays: 30, startDate, endDate }, wxContext),
      adminRevenueOverview({ rangeType: 'custom', startDate, endDate }, wxContext)
    ])
    if (!overview.success || !revenueResult.success) {
      return fail('REPORT_DATA_FAILED', '经营报告数据读取失败。')
    }
    let buffer
    try {
      buffer = await buildOperationsPdf({
        title: `${startDate.slice(0, 7)} 用户与会员经营报告`,
        startDate,
        endDate,
        generatedAt: now(),
        overview,
        revenue: revenueResult
      })
    } catch (error) {
      console.error('[adminGenerateOperationsPdf] failed:', error.message || error)
      return fail('PDF_GENERATION_FAILED', error.message || 'PDF 生成失败。')
    }
    const filename = `operations-report-${startDate}-${endDate}.pdf`
    const uploaded = await uploadGeneratedFile(
      `admin-reports/${formatShanghaiDate(Date.now())}/${Date.now()}-${filename}`,
      buffer
    )
    await writeAuditLog('adminGenerateOperationsPdf', auth.admin.profile, {
      targetType: 'adminExport',
      targetId: uploaded.fileID,
      payloadSummary: {
        status: 'generated',
        source: 'user_membership_admin',
        remark: `${startDate}~${endDate}`
      }
    })
    return success({ ...uploaded, filename, startDate, endDate, expiresWithTempUrl: true })
  }

  return {
    adminAddMembership: adminUpdateUserMembership,
    adminExportUsersCsv,
    adminExportPreRegistrationCsv,
    adminGenerateOperationsPdf,
    adminGetUserDetail,
    adminListUsers,
    adminListPreRegistrationEntitlements,
    adminRevenueOverview,
    adminRevenueTrend: adminRevenueOverview,
    adminRevokePreRegistrationEntitlement,
    adminSavePreRegistrationEntitlement,
    adminUpdateMembership: adminUpdateUserMembership,
    adminUpdateUserMembership,
    adminUserOverview
  }
}

module.exports = {
  countUniqueActiveManualMembers,
  createUserMembershipAdminService,
  normalizePreauthorizationKeyword
}
