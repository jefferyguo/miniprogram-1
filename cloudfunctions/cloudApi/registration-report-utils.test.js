'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  addDateDays,
  buildRegistrationProjection,
  getDateRange,
  getISOWeekNumber,
  getWeekRange
} = require('./registration-report-utils')

test('日报边界不受云函数宿主时区影响', () => {
  assert.deepEqual(getDateRange('2026-08-08'), {
    startAt: '2026-08-08 00:00:00',
    endAt: '2026-08-09 00:00:00'
  })
  assert.equal(addDateDays('2026-02-28', 1), '2026-03-01')
})

test('周报严格覆盖七天并给出上一周边界', () => {
  assert.deepEqual(getWeekRange('2026-08-03'), {
    startAt: '2026-08-03 00:00:00',
    endAt: '2026-08-10 00:00:00',
    prevStartAt: '2026-07-27 00:00:00',
    endDate: '2026-08-10',
    prevStartDate: '2026-07-27'
  })
  assert.equal(getISOWeekNumber('2026-08-03'), 'W32')
})

test('非超级管理员投影不会混用包含和排除字段', () => {
  const regularProjection = buildRegistrationProjection(false)
  const superProjection = buildRegistrationProjection(true)
  assert.equal(Object.hasOwn(regularProjection, 'phone'), false)
  assert.equal(superProjection.phone, true)
  assert.equal(Object.values(regularProjection).every(Boolean), true)
})

test('拒绝无效日期', () => {
  assert.throws(() => getDateRange('2026-02-30'), /不是有效日期/)
  assert.throws(() => getWeekRange('2026\/08\/03'), /YYYY-MM-DD/)
})
