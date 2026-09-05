const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseTimeValue(value, options = {}) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (value && typeof value === 'object' && value.$date !== undefined) {
    return parseTimeValue(value.$date, options)
  }

  const text = String(value || '').trim()
  if (!text) return NaN
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text)
    return text.length === 10 ? numeric * 1000 : numeric
  }

  const naive = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (naive) {
    const utcValue = Date.UTC(
      Number(naive[1]),
      Number(naive[2]) - 1,
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] || 0)
    )
    return options.naiveTimeZone === 'Asia/Shanghai'
      ? utcValue - SHANGHAI_OFFSET_MS
      : utcValue
  }

  return Date.parse(text)
}

function formatShanghaiDateTime(value, options = {}) {
  const timestamp = parseTimeValue(value, options)
  if (!Number.isFinite(timestamp)) return String(value || '')
  const shanghai = new Date(timestamp + SHANGHAI_OFFSET_MS)
  return `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())} ` +
    `${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}:${pad(shanghai.getUTCSeconds())}`
}

function getShanghaiUtcDayRange(nowValue = Date.now()) {
  const nowMs = parseTimeValue(nowValue)
  const shanghaiNow = new Date(nowMs + SHANGHAI_OFFSET_MS)
  const startMs = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate()
  ) - SHANGHAI_OFFSET_MS
  const endMs = startMs + 24 * 60 * 60 * 1000

  return {
    startMs,
    endMs,
    startText: formatUtcStorageDateTime(startMs),
    endText: formatUtcStorageDateTime(endMs)
  }
}

function formatUtcStorageDateTime(value = Date.now()) {
  const date = new Date(parseTimeValue(value))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function isShanghaiToday(value, nowValue = Date.now(), options = {}) {
  const timestamp = parseTimeValue(value, options)
  if (!Number.isFinite(timestamp)) return false
  const range = getShanghaiUtcDayRange(nowValue)
  return timestamp >= range.startMs && timestamp < range.endMs
}

module.exports = {
  SHANGHAI_OFFSET_MS,
  formatShanghaiDateTime,
  formatUtcStorageDateTime,
  getShanghaiUtcDayRange,
  isShanghaiToday,
  parseTimeValue
}
