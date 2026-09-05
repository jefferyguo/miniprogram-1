'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  countUniqueActiveManualMembers,
  createUserMembershipAdminService,
  normalizePreauthorizationKeyword
} = require('./user-membership-admin-service')

test('待注册授权搜索仅对手机号形态关键字做号码归一化', () => {
  const normalizePhone = value => String(value || '').replace(/\D/g, '')
  assert.equal(normalizePreauthorizationKeyword('138 1234 5678', normalizePhone), '13812345678')
  assert.equal(normalizePreauthorizationKeyword('PREAUTH_NOTE_SAMPLE', normalizePhone), 'PREAUTH_NOTE_SAMPLE')
  assert.equal(normalizePreauthorizationKeyword('线下学员 2026', normalizePhone), '线下学员 2026')
})

function createDeniedService() {
  const forbiddenDependency = new Proxy({}, {
    get() {
      throw new Error('未授权请求不应访问数据库或云存储')
    }
  })
  return createUserMembershipAdminService({
    db: forbiddenDependency,
    _: forbiddenDependency,
    cloud: forbiddenDependency,
    collections: forbiddenDependency,
    requireAdmin: async () => ({
      ok: false,
      code: 'ADMIN_REQUIRED',
      message: '需要管理员权限。'
    }),
    fail: (code, message) => ({ success: false, code, message }),
    success: data => ({ success: true, ...data }),
    now: () => '2026-08-08 12:00:00',
    maskPhone: () => '',
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    getMembershipLimits: () => ({ aiDailyLimit: 1, aiMonthlyLimit: 30 }),
    writeAuditLog: async () => {
      throw new Error('未授权请求不应写审计日志')
    },
    buildOperationsPdf: async () => {
      throw new Error('未授权请求不应生成 PDF')
    }
  })
}

test('用户、会员、收入和导出 action 在读取敏感数据前拒绝非管理员', async () => {
  const service = createDeniedService()
  const wxContext = { OPENID: 'ordinary-user' }
  const calls = [
    () => service.adminUserOverview({}, wxContext),
    () => service.adminListUsers({}, wxContext),
    () => service.adminListPreRegistrationEntitlements({}, wxContext),
    () => service.adminSavePreRegistrationEntitlement({}, wxContext),
    () => service.adminRevokePreRegistrationEntitlement({}, wxContext),
    () => service.adminGetUserDetail({ userId: 'target' }, wxContext),
    () => service.adminUpdateUserMembership({ userId: 'target' }, wxContext),
    () => service.adminRevenueOverview({}, wxContext),
    () => service.adminExportUsersCsv({}, wxContext),
    () => service.adminExportPreRegistrationCsv({}, wxContext),
    () => service.adminGenerateOperationsPdf({}, wxContext)
  ]

  for (const call of calls) {
    const result = await call()
    assert.deepEqual(result, {
      success: false,
      code: 'ADMIN_REQUIRED',
      message: '需要管理员权限。'
    })
  }
})

test('管理员保存与用户注册并发后，重试会领取既有 pending 而不是遗留授权', async () => {
  const registeredUser = {
    _id: 'user-registered',
    openid: 'openid-registered',
    phone: '13812345678',
    phoneBound: true,
    nickname: '测试学员',
    membershipType: 'free',
    membershipStatus: 'active'
  }
  let reconciled = 0
  const db = {
    runTransaction: async () => {
      throw Object.assign(new Error('该手机号已经注册，请直接为现有用户添加会员。'), {
        code: 'PHONE_ALREADY_REGISTERED',
        registeredUserId: registeredUser._id
      })
    },
    collection: name => ({
      where: () => ({
        limit: () => ({
          get: async () => ({ data: [] })
        })
      }),
      doc: id => ({
        get: async () => ({ data: name === 'users' && id === registeredUser._id ? registeredUser : null })
      })
    })
  }
  const service = createUserMembershipAdminService({
    db,
    _: { or: value => value },
    cloud: {},
    collections: {
      users: 'users',
      phoneEntitlements: 'phoneEntitlements',
      auditLogs: 'auditLogs'
    },
    requireAdmin: async () => ({
      ok: true,
      profile: {
        role: 'super_admin',
        source: 'admins_collection',
        admin: { openid: 'admin-openid', nickname: '管理员' }
      }
    }),
    fail: (code, message, data = {}) => ({ success: false, code, message, ...data }),
    success: data => ({ success: true, ...data }),
    now: () => '2026-08-09 12:00:00',
    maskPhone: phone => `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    getMembershipLimits: () => ({ aiDailyLimit: 1, aiMonthlyLimit: 30 }),
    writeAuditLog: async () => {},
    buildOperationsPdf: async () => Buffer.from(''),
    reconcileBoundPhoneUser: async (userId, phone) => {
      reconciled += 1
      assert.equal(userId, registeredUser._id)
      assert.equal(phone, registeredUser.phone)
      return {
        claimed: true,
        entitlement: {
          _id: 'preauth-record',
          phone,
          membershipType: 'yearly',
          activationMode: 'on_claim',
          durationDays: 365,
          preauthStatus: 'claimed',
          claimedAt: '2026-08-09 12:00:00'
        }
      }
    }
  })

  const result = await service.adminSavePreRegistrationEntitlement({
    operationId: 'preauth-grant:concurrent-test',
    phone: registeredUser.phone,
    membershipType: 'yearly',
    activationMode: 'on_claim',
    durationDays: 365,
    note: '并发重试'
  }, { OPENID: 'admin-openid' })

  assert.equal(reconciled, 1)
  assert.equal(result.success, true)
  assert.equal(result.reconciled, true)
  assert.equal(result.registeredUserId, registeredUser._id)
  assert.equal(result.entitlement.status, 'claimed')
})

test('预检查发现已注册用户时仍会先重试领取已有 pending', async () => {
  const registeredUser = {
    _id: 'user-before-save',
    openid: 'openid-before-save',
    phone: '13912345678',
    phoneBound: true,
    nickname: '竞态学员',
    membershipType: 'free',
    membershipStatus: 'active'
  }
  let transactionCalled = false
  let reconciled = 0
  const service = createUserMembershipAdminService({
    db: {
      runTransaction: async () => {
        transactionCalled = true
        throw new Error('不应创建第二条预授权')
      },
      collection: name => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              data: name === 'users'
                ? [registeredUser]
                : (name === 'auditLogs' ? [] : [{
                    _id: 'existing-pending',
                    entitlementKind: 'pre_registration',
                    preauthStatus: 'pending',
                    status: 'active',
                    phone: registeredUser.phone,
                    membershipType: 'monthly',
                    activationMode: 'on_claim'
                  }])
            })
          })
        })
      })
    },
    _: { or: value => value },
    cloud: {},
    collections: {
      users: 'users',
      phoneEntitlements: 'phoneEntitlements',
      auditLogs: 'auditLogs'
    },
    requireAdmin: async () => ({
      ok: true,
      profile: {
        role: 'super_admin',
        source: 'admins_collection',
        admin: { openid: 'admin-openid', nickname: '管理员' }
      }
    }),
    fail: (code, message, data = {}) => ({ success: false, code, message, ...data }),
    success: data => ({ success: true, ...data }),
    now: () => '2026-08-09 12:00:00',
    maskPhone: phone => `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    getMembershipLimits: () => ({ aiDailyLimit: 1, aiMonthlyLimit: 30 }),
    writeAuditLog: async () => {},
    buildOperationsPdf: async () => Buffer.from(''),
    reconcileBoundPhoneUser: async (userId, phone) => {
      reconciled += 1
      assert.equal(userId, registeredUser._id)
      assert.equal(phone, registeredUser.phone)
      return {
        claimed: true,
        entitlement: {
          _id: 'existing-pending',
          phone,
          membershipType: 'monthly',
          activationMode: 'on_claim',
          durationDays: 90,
          preauthStatus: 'claimed',
          claimedAt: '2026-08-09 12:00:00'
        }
      }
    }
  })

  const result = await service.adminSavePreRegistrationEntitlement({
    operationId: 'preauth-grant:registered-test',
    phone: registeredUser.phone,
    membershipType: 'monthly',
    activationMode: 'on_claim',
    durationDays: 90
  }, { OPENID: 'admin-openid' })

  assert.equal(transactionCalled, false)
  assert.equal(reconciled, 1)
  assert.equal(result.success, true)
  assert.equal(result.reconciled, true)
})

test('成熟预授权在数据库筛选后限量，不会被前 100 条未来授权饿死', async () => {
  const dueUser = {
    _id: 'due-user',
    phone: '13612345678',
    phoneBound: true,
    preauthDeferred: true,
    preauthDeferredStartAt: '2026-08-01 00:00:00'
  }
  const futureUsers = Array.from({ length: 100 }, (_, index) => ({
    _id: `future-user-${index}`,
    phoneBound: true,
    preauthDeferred: true,
    preauthDeferredStartAt: `2099-01-${String((index % 28) + 1).padStart(2, '0')} 00:00:00`
  }))
  const users = [...futureUsers, dueUser]
  const lte = value => ({ operator: 'lte', value })

  function matches(row, condition = {}) {
    return Object.entries(condition).every(([field, expected]) => {
      if (expected && expected.operator === 'lte') {
        return String(row[field] || '') <= String(expected.value)
      }
      return row[field] === expected
    })
  }

  function createQuery(rows, state = {}) {
    return {
      where(condition) {
        return createQuery(rows, { ...state, condition })
      },
      orderBy(field, direction) {
        return createQuery(rows, { ...state, orderBy: [field, direction] })
      },
      skip(value) {
        return createQuery(rows, { ...state, skip: value })
      },
      limit(value) {
        return createQuery(rows, { ...state, limit: value })
      },
      async count() {
        const filtered = state.condition ? rows.filter(row => matches(row, state.condition)) : rows
        return { total: filtered.length }
      },
      async get() {
        let result = state.condition ? rows.filter(row => matches(row, state.condition)) : [...rows]
        if (state.orderBy) {
          const [field, direction] = state.orderBy
          result.sort((left, right) => {
            const compared = String(left[field] || '').localeCompare(String(right[field] || ''))
            return direction === 'desc' ? -compared : compared
          })
        }
        const start = Number(state.skip || 0)
        const end = state.limit == null ? undefined : start + Number(state.limit)
        return { data: result.slice(start, end) }
      }
    }
  }

  let reconciledUserId = ''
  const service = createUserMembershipAdminService({
    db: {
      collection: name => createQuery(name === 'users' ? users : [])
    },
    _: {
      in: values => ({ operator: 'in', values }),
      lte
    },
    cloud: {},
    collections: {
      users: 'users',
      phoneEntitlements: 'phoneEntitlements',
      virtualPaymentOrders: 'virtualPaymentOrders'
    },
    requireAdmin: async () => ({
      ok: true,
      profile: {
        role: 'super_admin',
        source: 'admins_collection',
        admin: { openid: 'admin-openid', nickname: '管理员' }
      }
    }),
    fail: (code, message) => ({ success: false, code, message }),
    success: data => ({ success: true, ...data }),
    now: () => '2026-08-09 12:00:00',
    maskPhone: phone => phone,
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    getMembershipLimits: () => ({ aiDailyLimit: 1, aiMonthlyLimit: 30 }),
    writeAuditLog: async () => {},
    buildOperationsPdf: async () => Buffer.from(''),
    reconcileBoundPhoneUser: async userId => {
      reconciledUserId = userId
      return { claimed: true }
    }
  })

  const result = await service.adminListUsers({ page: 1, pageSize: 20 }, { OPENID: 'admin-openid' })

  assert.equal(result.success, true)
  assert.equal(reconciledUserId, dueUser._id)
})

test('后台赠送人数按真实领取人去重且不混入支付或过期记录', () => {
  const rows = [
    {
      _id: 'direct-1',
      phone: '13812345678',
      membershipType: 'monthly',
      membershipStatus: 'active',
      membershipStartAt: '2026-08-01',
      membershipEndAt: '2026-12-01',
      source: 'admin'
    },
    {
      _id: 'preauth-1',
      claimedUserId: 'user-1',
      phoneNormalized: '13812345678',
      membershipType: 'yearly',
      membershipStatus: 'active',
      membershipStartAt: '2026-08-02',
      membershipEndAt: '2027-08-02',
      source: 'admin_preauthorization_claimed'
    },
    {
      _id: 'payment-1',
      phone: '13712345678',
      membershipType: 'yearly',
      membershipStatus: 'active',
      membershipStartAt: '2026-08-01',
      membershipEndAt: '2027-08-01',
      source: 'wechat_virtual_payment'
    },
    {
      _id: 'expired-1',
      phone: '13612345678',
      membershipType: 'monthly',
      membershipStatus: 'expired',
      membershipStartAt: '2025-01-01',
      membershipEndAt: '2025-04-01',
      source: 'admin'
    }
  ]

  assert.equal(countUniqueActiveManualMembers(
    rows,
    value => String(value || '').replace(/\D/g, ''),
    '2026-08-09 12:00:00'
  ), 1)
})

function createMemoryDatabase(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, rows.map(item => ({ ...item }))]))
  let addSequence = 0
  const rowsFor = name => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)
  }
  const matches = (row, condition) => {
    if (!condition || Array.isArray(condition)) return true
    return Object.entries(condition).every(([key, value]) => {
      if (value && typeof value === 'object') return true
      return row[key] === value
    })
  }
  const collection = name => {
    const makeQuery = (condition = null, offset = 0, limitValue = Infinity) => ({
      where: next => makeQuery(next, offset, limitValue),
      orderBy: () => makeQuery(condition, offset, limitValue),
      skip: next => makeQuery(condition, next, limitValue),
      limit: next => makeQuery(condition, offset, next),
      get: async () => ({ data: rowsFor(name).filter(row => matches(row, condition)).slice(offset, offset + limitValue) }),
      count: async () => ({ total: rowsFor(name).filter(row => matches(row, condition)).length })
    })
    return {
      ...makeQuery(),
      doc(id) {
        return {
          async get() {
            const row = rowsFor(name).find(item => item._id === id)
            if (!row) throw Object.assign(new Error('document not found'), { errCode: -1 })
            return { data: { ...row } }
          },
          async set({ data }) {
            const rows = rowsFor(name)
            const index = rows.findIndex(item => item._id === id)
            const next = { _id: id, ...data }
            if (index >= 0) rows[index] = next
            else rows.push(next)
          },
          async update({ data }) {
            const rows = rowsFor(name)
            const index = rows.findIndex(item => item._id === id)
            if (index < 0) throw new Error('document not found')
            rows[index] = { ...rows[index], ...data }
          }
        }
      },
      async add({ data }) {
        const id = `${name}-${++addSequence}`
        rowsFor(name).push({ _id: id, ...data })
        return { _id: id }
      }
    }
  }
  return {
    collection,
    runTransaction: async callback => callback({ collection }),
    rows: name => rowsFor(name)
  }
}

function createAdminServiceWithMemoryDb(memoryDb) {
  const operator = { openid: 'admin-openid', nickname: '管理员' }
  const passThrough = value => value
  return createUserMembershipAdminService({
    db: { ...memoryDb, RegExp: value => value },
    _: {
      and: value => value,
      or: value => value,
      in: value => ({ in: value }),
      gte: passThrough,
      lte: passThrough,
      lt: passThrough
    },
    cloud: {},
    collections: {
      users: 'users',
      phoneEntitlements: 'phoneEntitlements',
      virtualPaymentOrders: 'virtualPaymentOrders',
      auditLogs: 'auditLogs'
    },
    requireAdmin: async () => ({
      ok: true,
      profile: { role: 'super_admin', source: 'admins_collection', admin: operator }
    }),
    fail: (code, message, data = {}) => ({ success: false, code, message, ...data }),
    success: data => ({ success: true, ...data }),
    now: () => '2026-08-29 10:00:00',
    maskPhone: phone => `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    getMembershipLimits: () => ({ aiDailyLimit: 5, aiMonthlyLimit: 150 }),
    writeAuditLog: async () => {},
    buildOperationsPdf: async () => Buffer.from('')
  })
}

test('已注册用户人工发放使用服务端价格，同 operationId 重试只写一笔且独立发放分别计入', async () => {
  const memoryDb = createMemoryDatabase({
    users: [{
      _id: 'user-1',
      openid: 'user-openid',
      phone: '13812345678',
      phoneBound: true,
      membershipType: 'free',
      membershipStatus: 'active',
      membershipStartAt: '',
      membershipEndAt: '',
      status: 'active'
    }],
    phoneEntitlements: [],
    virtualPaymentOrders: [],
    auditLogs: []
  })
  const service = createAdminServiceWithMemoryDb(memoryDb)
  const wxContext = { OPENID: 'admin-openid' }
  const quarterly = {
    userId: 'user-1',
    operationId: 'member-grant:quarterly:001',
    membershipAction: 'add',
    membershipType: 'monthly',
    startDate: '2026-08-29',
    endDate: '2026-11-27',
    reason: '线下季度会员'
  }
  assert.equal((await service.adminUpdateUserMembership(quarterly, wxContext)).success, true)
  assert.equal((await service.adminUpdateUserMembership(quarterly, wxContext)).success, true)
  const conflictingRetry = await service.adminUpdateUserMembership({
    ...quarterly,
    membershipType: 'yearly',
    endDate: '2027-08-29'
  }, wxContext)
  assert.equal(conflictingRetry.code, 'MEMBERSHIP_OPERATION_ID_CONFLICT')
  assert.equal(memoryDb.rows('auditLogs').filter(item => item.revenueSource === 'admin_grant').length, 1)
  assert.equal(memoryDb.rows('auditLogs').find(item => item.revenueSource === 'admin_grant').revenueAmountFen, 3990)

  const yearly = {
    ...quarterly,
    operationId: 'member-grant:yearly:002',
    membershipAction: 'update',
    membershipType: 'yearly',
    endDate: '2027-08-29',
    reason: '升级年度会员'
  }
  assert.equal((await service.adminUpdateUserMembership(yearly, wxContext)).success, true)
  const revenue = await service.adminRevenueOverview({}, wxContext)
  assert.equal(revenue.metrics.all.confirmedFen, 9980)
  assert.equal(revenue.paymentMetrics.all.confirmedFen, 0)
  assert.equal(revenue.manualMetrics.all.orderCount, 2)
})

test('预注册会员创建时计价一次，重复创建幂等且后续领取不在收入入口发生', async () => {
  const memoryDb = createMemoryDatabase({ users: [], phoneEntitlements: [], virtualPaymentOrders: [], auditLogs: [] })
  const service = createAdminServiceWithMemoryDb(memoryDb)
  const request = {
    operationId: 'preauth-grant:quarterly:001',
    phone: '13912345678',
    membershipType: 'monthly',
    activationMode: 'on_claim',
    note: '未注册季度会员'
  }
  assert.equal((await service.adminSavePreRegistrationEntitlement(request, { OPENID: 'admin-openid' })).success, true)
  const duplicate = await service.adminSavePreRegistrationEntitlement(request, { OPENID: 'admin-openid' })
  assert.equal(duplicate.success, true)
  assert.equal(duplicate.duplicate, true)
  const conflictingRetry = await service.adminSavePreRegistrationEntitlement({
    ...request,
    membershipType: 'yearly'
  }, { OPENID: 'admin-openid' })
  assert.equal(conflictingRetry.code, 'PREAUTH_OPERATION_ID_CONFLICT')
  const records = memoryDb.rows('auditLogs').filter(item => item.revenueSource === 'admin_grant')
  assert.equal(records.length, 1)
  assert.equal(records[0].revenueAmountFen, 3990)
})
