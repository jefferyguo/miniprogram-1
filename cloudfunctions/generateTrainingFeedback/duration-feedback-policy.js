'use strict'

const DURATION_EVALUATION_PATTERNS = [
  /\d+\s*(?:秒|分钟)/,
  /(?:一分钟|几分钟)/,
  /(?:时长|时间长度|篇幅).{0,18}(?:过长|过短|偏长|偏短|略长|略短|控制|压缩|缩短|延长|精简|建议|推荐|合适|达到|不足)/,
  /(?:控制|压缩|缩短|延长|精简).{0,18}(?:时长|时间|\d+\s*(?:秒|分钟)|一分钟|几分钟)/
]

function hasDurationEvaluation(text) {
  return DURATION_EVALUATION_PATTERNS.some(pattern => pattern.test(String(text || '')))
}

function sanitizeDurationEvaluationText(text, fallback = '') {
  const value = String(text || '').trim()
  if (!value) return fallback
  const safeParts = (value.match(/[^。！？；\n]+[。！？；\n]?/g) || [])
    .map(part => part.trim())
    .filter(part => part && !hasDurationEvaluation(part))
  return safeParts.join('').trim() || fallback
}

function sanitizeDurationEvaluationList(items, fallback = []) {
  const safeItems = (Array.isArray(items) ? items : [])
    .map(item => sanitizeDurationEvaluationText(item))
    .filter(Boolean)
  return safeItems.length ? safeItems : fallback
}

module.exports = {
  DURATION_EVALUATION_PATTERNS,
  hasDurationEvaluation,
  sanitizeDurationEvaluationText,
  sanitizeDurationEvaluationList
}
