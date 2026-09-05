'use strict'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function assertDateText(value, fieldName) {
  const text = String(value || '').trim()
  if (!DATE_PATTERN.test(text)) {
    throw new Error(`${fieldName}格式必须为 YYYY-MM-DD`)
  }
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName}不是有效日期`)
  }
  return text
}

function addDateDays(dateText, days) {
  const value = assertDateText(dateText, '日期')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-')
}

function getDateRange(dateText) {
  const date = assertDateText(dateText, '日期')
  const endDate = addDateDays(date, 1)
  return {
    startAt: `${date} 00:00:00`,
    endAt: `${endDate} 00:00:00`
  }
}

function getWeekRange(weekStartText) {
  const weekStart = assertDateText(weekStartText, '周开始日期')
  const endDate = addDateDays(weekStart, 7)
  const prevStartDate = addDateDays(weekStart, -7)
  return {
    startAt: `${weekStart} 00:00:00`,
    endAt: `${endDate} 00:00:00`,
    prevStartAt: `${prevStartDate} 00:00:00`,
    endDate,
    prevStartDate
  }
}

function getISOWeekNumber(dateText) {
  const value = assertDateText(dateText, '日期')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const dayNumber = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNumber = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return `W${String(weekNumber).padStart(2, '0')}`
}

function buildRegistrationProjection(showFullPhone) {
  return {
    _id: true,
    openid: true,
    nickname: true,
    nicknameSource: true,
    ...(showFullPhone ? { phone: true } : {}),
    phoneMasked: true,
    phoneBound: true,
    registeredAt: true,
    profileCompleted: true,
    createdAt: true
  }
}

module.exports = {
  addDateDays,
  buildRegistrationProjection,
  getDateRange,
  getISOWeekNumber,
  getWeekRange
}
