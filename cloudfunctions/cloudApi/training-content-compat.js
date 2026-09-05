const PERMANENT_CONTENT_ID_RE = /^tc_[0-9a-f]{32}$/
const ACTIVE_TRAINING_STATUSES = new Set(['active', 'published'])

function normalizeCategory(value) {
  const category = String(value || '').trim()
  return category === 'retelling' ? 'retell' : category
}

function isPermanentTrainingContentId(value) {
  return PERMANENT_CONTENT_ID_RE.test(String(value || '').trim())
}

function requirePermanentTrainingContentId(value) {
  const contentId = String(value || '').trim()
  if (!isPermanentTrainingContentId(contentId)) {
    const error = new Error('contentId 必须是 tc_<32位十六进制> 永久 ID')
    error.code = 'INVALID_PERMANENT_CONTENT_ID'
    throw error
  }
  return contentId
}

function getTrainingDay(record = {}) {
  return Number(record.sortOrder || record.day || 0)
}

function hasTrainingBody(record = {}) {
  return Boolean(String(record.content || '').trim())
}

function isCurrentTrainingRecord(record = {}) {
  if (!record || record.active === false || record.visible === false) return false
  return ACTIVE_TRAINING_STATUSES.has(String(record.status || '').trim().toLowerCase())
}

function compareCurrentTrainingRecords(left = {}, right = {}) {
  const versionDiff = Number(right.contentVersion || 0) - Number(left.contentVersion || 0)
  if (versionDiff) return versionDiff
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
}

function selectPreferredCurrentTrainingRecords(records = []) {
  const selected = new Map()
  records.forEach(record => {
    if (!isPermanentTrainingContentId(record && record.contentId)) return
    if (!isCurrentTrainingRecord(record) || !hasTrainingBody(record)) return
    const contentId = String(record.contentId).trim()
    const current = selected.get(contentId)
    if (!current || compareCurrentTrainingRecords(record, current) < 0) {
      selected.set(contentId, record)
    }
  })
  return Array.from(selected.values())
}

module.exports = {
  PERMANENT_CONTENT_ID_RE,
  compareCurrentTrainingRecords,
  getTrainingDay,
  hasTrainingBody,
  isCurrentTrainingRecord,
  isPermanentTrainingContentId,
  normalizeCategory,
  requirePermanentTrainingContentId,
  selectPreferredCurrentTrainingRecords
}
