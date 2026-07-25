const INACTIVE_TRAINING_STATUSES = new Set([
  'archived',
  'inactive',
  'deleted',
  'disabled',
  'draft'
])

function normalizeCategory(value) {
  const category = String(value || '').trim()
  return category === 'retell' ? 'retelling' : category
}

function getTrainingDay(record = {}) {
  return Number(record.day || record.dayNumber || 0)
}

function hasTrainingBody(record = {}) {
  return Boolean(String(record.content || record.material || record.promptText || '').trim())
}

function isCurrentTrainingRecord(record) {
  if (!record || record.active === false || record.visible === false) return false
  const status = String(record.status || '').trim().toLowerCase()
  return !INACTIVE_TRAINING_STATUSES.has(status)
}

function parseVersionedTrainingContentId(contentId = '') {
  const match = String(contentId || '').trim().match(/^(.+)-v(\d+)-day-(\d+)$/i)
  if (!match) return null
  return {
    category: normalizeCategory(match[1]),
    version: Number(match[2]),
    day: Number(match[3])
  }
}

function isRequestedVersionedTrainingContent(contentId, category, day) {
  const parsed = parseVersionedTrainingContentId(contentId)
  if (!parsed) return false
  const requestedCategory = normalizeCategory(category)
  const requestedDay = Number(day || 0)
  return Boolean(
    requestedCategory &&
    requestedDay > 0 &&
    parsed.category === requestedCategory &&
    parsed.day === requestedDay
  )
}

function getTrainingRecordPriority(record = {}) {
  const contentId = String(record.contentId || '').trim()
  const parsed = parseVersionedTrainingContentId(contentId)
  if (parsed) return 300000 + parsed.version
  if (/-v\d+-/i.test(contentId)) return 200000
  return 100000
}

function compareCurrentTrainingRecords(left = {}, right = {}) {
  const priorityDiff = getTrainingRecordPriority(right) - getTrainingRecordPriority(left)
  if (priorityDiff) return priorityDiff
  return String(right.updatedAt || right.createdAt || '').localeCompare(
    String(left.updatedAt || left.createdAt || '')
  )
}

function getTrainingRecordKey(record = {}, index = 0) {
  const category = normalizeCategory(record.category)
  const day = getTrainingDay(record)
  if (category && day > 0) return `${category}:day:${day}`
  return `${category || 'unknown'}:id:${record.contentId || record._id || index}`
}

function selectPreferredCurrentTrainingRecords(records = []) {
  const selected = new Map()
  records
    .filter(record => isCurrentTrainingRecord(record) && hasTrainingBody(record))
    .forEach((record, index) => {
      const key = getTrainingRecordKey(record, index)
      const current = selected.get(key)
      if (!current || compareCurrentTrainingRecords(record, current) < 0) {
        selected.set(key, record)
      }
    })
  return Array.from(selected.values())
}

function findLegacyCurrentTrainingRecord(records = [], options = {}) {
  const requestedContentId = String(options.requestedContentId || '').trim()
  const category = normalizeCategory(options.category)
  const day = Number(options.day || 0)
  if (!isRequestedVersionedTrainingContent(requestedContentId, category, day)) return null

  return records
    .filter(record => (
      normalizeCategory(record.category) === category &&
      getTrainingDay(record) === day &&
      String(record.contentId || '').trim() !== requestedContentId &&
      isCurrentTrainingRecord(record) &&
      hasTrainingBody(record)
    ))
    .sort(compareCurrentTrainingRecords)[0] || null
}

module.exports = {
  compareCurrentTrainingRecords,
  findLegacyCurrentTrainingRecord,
  getTrainingDay,
  hasTrainingBody,
  isCurrentTrainingRecord,
  isRequestedVersionedTrainingContent,
  normalizeCategory,
  parseVersionedTrainingContentId,
  selectPreferredCurrentTrainingRecords
}
