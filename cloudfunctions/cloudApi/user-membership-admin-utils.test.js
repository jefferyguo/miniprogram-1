'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  aggregateRevenue,
  buildDailyRevenueTrend,
  buildManagedMembershipChange,
  buildRevenueHistory,
  buildUsersCsv,
  classifyMembership,
  dedupeAdminGrantRevenue,
  dedupeConfirmedPayments,
  formatShanghaiDate,
  getShanghaiPeriods,
  parseTimestamp
} = require('./user-membership-admin-utils')

const NOW = '2026-08-08T04:00:00.000Z'

test('会员分类与用户端 monthly/yearly 有效期口径一致', () => {
  assert.equal(classifyMembership({ membershipType: 'free' }, NOW).customerState, 'ordinary')
  assert.equal(classifyMembership({
    membershipType: 'monthly',
    membershipStatus: 'active',
    membershipEndAt: '2026-08-10'
  }, NOW).customerState, 'active')
  assert.equal(classifyMembership({
    membershipType: 'yearly',
    membershipStatus: 'active',
    membershipEndAt: '2026-08-07'
  }, NOW).customerState, 'expired')
  assert.equal(classifyMembership({
    membershipType: 'monthly',
    membershipStatus: 'inactive',
    membershipEndAt: '2026-12-31'
  }, NOW).customerState, 'expired')
})

test('人工会员沿用 monthly=季度90天、yearly=年度365天且校验时间', () => {
  assert.deepEqual(buildManagedMembershipChange({
    membershipAction: 'add',
    membershipType: 'monthly',
    startDate: '2026-08-08'
  }, NOW), {
    action: 'add',
    membershipType: 'monthly',
    membershipStartAt: '2026-08-08',
    membershipEndAt: '2026-11-06',
    membershipStatus: 'active'
  })
  assert.equal(buildManagedMembershipChange({
    membershipType: 'yearly',
    startDate: '2026-08-08'
  }, NOW).membershipEndAt, '2027-08-08')
  assert.equal(buildManagedMembershipChange({ membershipAction: 'end' }, NOW).membershipType, 'free')
  assert.throws(() => buildManagedMembershipChange({
    membershipType: 'monthly',
    startDate: '2026-08-08',
    endDate: '2026-08-08'
  }, NOW), /晚于/)
})

test('上海时区日期边界稳定', () => {
  assert.equal(formatShanghaiDate('2026-08-07T16:30:00.000Z', true), '2026-08-08 00:30:00')
  const periods = getShanghaiPeriods(NOW)
  assert.deepEqual(periods.labels, {
    today: '2026-08-08',
    weekStart: '2026-08-03',
    monthStart: '2026-08-01',
    yearStart: '2026-01-01'
  })
  assert.equal(parseTimestamp('2026-08-08 00:00:00'), Date.parse('2026-08-07T16:00:00.000Z'))
  assert.equal(Number.isNaN(parseTimestamp('2026-02-30')), true)
})

test('收入只统计真实微信支付成功订单并按 orderNo 去重', () => {
  const orders = [
    {
      orderNo: 'paid-1',
      status: 'fulfilled',
      paymentProvider: 'wechat_virtual_payment',
      priceFen: 3990,
      paidAt: '2026-08-08T01:00:00.000Z',
      membershipType: 'monthly',
      openid: 'user-a'
    },
    {
      orderNo: 'paid-1',
      status: 'paid',
      paymentProvider: 'wechat_virtual_payment',
      priceFen: 3990,
      paidAt: '2026-08-08T01:00:00.000Z',
      membershipType: 'monthly',
      openid: 'user-a'
    },
    {
      orderNo: 'manual-1',
      status: 'paid',
      payMethod: 'manual',
      priceFen: 5990,
      paidAt: '2026-08-08T02:00:00.000Z',
      membershipType: 'yearly'
    },
    {
      orderNo: 'pending-1',
      status: 'pending',
      paymentProvider: 'wechat_virtual_payment',
      priceFen: 5990,
      paidAt: '2026-08-08T02:00:00.000Z'
    }
  ]
  assert.equal(dedupeConfirmedPayments(orders).length, 1)
  const result = aggregateRevenue(orders, NOW)
  assert.equal(result.today.confirmedFen, 3990)
  assert.equal(result.today.orderCount, 1)
  assert.equal(result.paidUserCount, 1)
})

test('总收益包含后台人工发放，支付收入保持独立且人工记录按 operationId 去重', () => {
  const orders = [{
    orderNo: 'paid-quarterly',
    status: 'fulfilled',
    paymentProvider: 'wechat_virtual_payment',
    priceFen: 3990,
    paidAt: '2026-08-08T01:00:00.000Z',
    membershipType: 'monthly',
    openid: 'paid-user'
  }]
  const manualRevenueRecords = [{
    operationId: 'admin-grant-yearly-1',
    source: 'admin_grant',
    amountFen: 5990,
    membershipType: 'yearly',
    userId: 'manual-user',
    createdAt: '2026-08-08T02:00:00.000Z'
  }, {
    operationId: 'admin-grant-yearly-1',
    source: 'admin_grant',
    amountFen: 5990,
    membershipType: 'yearly',
    userId: 'manual-user',
    createdAt: '2026-08-08T02:00:00.000Z'
  }]

  const result = aggregateRevenue(orders, NOW, manualRevenueRecords)
  assert.equal(result.today.confirmedFen, 9980)
  assert.equal(result.today.orderCount, 2)
  assert.equal(result.payment.today.confirmedFen, 3990)
  assert.equal(result.payment.today.orderCount, 1)
  assert.equal(result.manual.today.confirmedFen, 5990)
  assert.equal(result.manual.today.orderCount, 1)
  assert.equal(result.paidUserCount, 1)
  assert.equal(result.revenueBasis, 'payment_plus_admin_grant')
})

test('两次独立人工发放分别计入，预授权领取不会再次产生收益', () => {
  const records = [{
    operationId: 'admin-grant-quarterly-1',
    source: 'admin_grant',
    amountFen: 3990,
    membershipType: 'monthly',
    createdAt: '2026-08-08T01:00:00.000Z'
  }, {
    operationId: 'admin-grant-yearly-2',
    source: 'admin_grant',
    amountFen: 5990,
    membershipType: 'yearly',
    createdAt: '2026-08-08T02:00:00.000Z'
  }, {
    operationId: 'preauth-claim-must-not-count',
    source: 'admin_preauthorization_claimed',
    amountFen: 5990,
    membershipType: 'yearly',
    createdAt: '2026-08-08T03:00:00.000Z'
  }]
  assert.equal(dedupeAdminGrantRevenue(records).length, 2)
  const result = aggregateRevenue([], NOW, records)
  assert.equal(result.all.confirmedFen, 9980)
  assert.equal(result.manual.all.orderCount, 2)
  assert.equal(result.payment.all.confirmedFen, 0)
})

test('明确退款字段会扣减，缺失退款字段不会虚构净收入', () => {
  const result = aggregateRevenue([{
    orderNo: 'refund-1',
    status: 'fulfilled',
    paymentProvider: 'wechat_virtual_payment',
    priceFen: 5990,
    refundStatus: 'partial_refund',
    refundFen: 1000,
    paidAt: '2026-08-08T01:00:00.000Z',
    membershipType: 'yearly'
  }], NOW)
  assert.equal(result.today.grossFen, 5990)
  assert.equal(result.today.refundFen, 1000)
  assert.equal(result.today.confirmedFen, 4990)
  assert.equal(result.revenueBasis, 'payment_plus_admin_grant')
})

test('趋势包含零值日期，周月年历史使用上海日期', () => {
  const orders = [{
    orderNo: 'trend-1',
    status: 'fulfilled',
    paymentProvider: 'wechat_virtual_payment',
    priceFen: 3990,
    paidAt: '2026-08-07T16:30:00.000Z',
    membershipType: 'monthly'
  }]
  const trend = buildDailyRevenueTrend(orders, '2026-08-07', '2026-08-09')
  assert.deepEqual(trend.map(item => item.confirmedFen), [0, 3990, 0])
  assert.equal(buildRevenueHistory(orders, 'week')[0].label, '2026-08-03')
  assert.equal(buildRevenueHistory(orders, 'month')[0].label, '2026-08')
  assert.equal(buildRevenueHistory(orders, 'year')[0].label, '2026')
})

test('CSV 包含 BOM、完整手机号、不含班级并防止公式注入', () => {
  const csv = buildUsersCsv([{
    userId: 'user-1',
    nickname: '=危险公式',
    phone: '18712343503',
    registeredAt: '2026-08-08 10:00:00',
    userTypeLabel: '有效会员',
    membershipStatusLabel: '有效',
    membershipLabel: '季度会员',
    purchaseTime: '',
    membershipStartAt: '2026-08-08',
    membershipEndAt: '2026-11-06',
    paidAmountFen: null,
    membershipSourceLabel: '后台添加',
    paidOrderCount: 0,
    totalPaidFen: 0
  }])
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.match(csv, /18712343503/)
  assert.doesNotMatch(csv, /班级/)
  assert.match(csv, /'=危险公式/)
  assert.match(csv, /历史数据未记录/)
})
