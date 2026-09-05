'use strict'

const SENSITIVE_KEY_PATTERN = /token|secret|authorization|access.?token|session.?key|pay.?sig|signature|sign.?data|login.?code|audio.?text|transcript|speech.?text/i
const PRIVATE_ID_KEY_PATTERN = /^(openid|openId|_openid|phone|phoneNumber|purePhoneNumber)$/i
const MAX_DEPTH = 5
const MAX_KEYS = 60
const MAX_TEXT_LENGTH = 2000

function redactSensitiveText(value) {
  return String(value == null ? '' : value)
    .replace(/((?:access[_-]?token|token|secret|authorization|session[_-]?key|pay[_-]?sig|signature)\s*[:=]\s*)[^\s&,;]+/gi, '$1[hidden]')
    .replace(/\b1\d{10}\b/g, '[phone hidden]')
    .replace(/\bo[A-Za-z0-9_-]{20,}\b/g, '[openid hidden]')
}

function truncateText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = redactSensitiveText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function sanitizeValue(value, key = '', seen = new WeakSet(), depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(key) || PRIVATE_ID_KEY_PATTERN.test(key)) return value ? '[hidden]' : ''
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return truncateText(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value !== 'object') return truncateText(value)
  if (depth >= MAX_DEPTH) return '[max depth]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map(item => sanitizeValue(item, '', seen, depth + 1))
  }

  const result = {}
  Object.keys(value).slice(0, MAX_KEYS).forEach(field => {
    result[field] = sanitizeValue(value[field], field, seen, depth + 1)
  })
  return result
}

function pickText(error, fields) {
  for (const field of fields) {
    const value = error && error[field]
    if (value != null && value !== '' && typeof value !== 'object') return truncateText(value)
  }
  return ''
}

function normalizeError(error, fallbackMessage = 'Unknown error') {
  const source = error && typeof error === 'object' ? error : {}
  const rawText = typeof error === 'string' || typeof error === 'number' ? truncateText(error) : ''
  const message = pickText(source, ['message', 'errMsg', 'msg', 'code', 'errCode', 'errno']) || rawText || fallbackMessage
  const normalized = {
    name: pickText(source, ['name']),
    message: message === '[object Object]' ? fallbackMessage : message,
    errMsg: pickText(source, ['errMsg']),
    code: pickText(source, ['code']),
    errCode: source.errCode == null ? '' : source.errCode,
    errno: source.errno == null ? '' : source.errno,
    stack: pickText(source, ['stack']),
    requestId: pickText(source, ['requestId', 'requestID', 'traceId']),
    details: sanitizeValue(source)
  }
  return normalized
}

function toError(error, fallbackMessage = '操作失败') {
  if (error instanceof Error) return error
  const normalized = normalizeError(error, fallbackMessage)
  const result = new Error(normalized.message)
  ;['name', 'errMsg', 'code', 'errCode', 'errno', 'requestId'].forEach(field => {
    if (normalized[field] !== '') result[field] = normalized[field]
  })
  result.details = normalized.details
  return result
}

function getUserErrorMessage(error, fallbackMessage = '操作失败，请稍后重试。') {
  const source = error && error.result && typeof error.result === 'object' ? error.result : error
  const message = pickText(source && typeof source === 'object' ? source : {}, ['errMsg', 'message', 'msg', 'code'])
  return message && message !== '[object Object]' ? message : fallbackMessage
}

module.exports = {
  getUserErrorMessage,
  normalizeError,
  redactSensitiveText,
  toError
}
