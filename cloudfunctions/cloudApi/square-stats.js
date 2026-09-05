const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const { isVideoWorkRecord } = require('./video-share-policy')

const NON_VISIBLE_STATUSES = new Set(['deleted', 'unpublished', 'hidden', 'blocked', 'disabled', 'rejected', 'private'])
const AUDIO_MEDIA_FIELDS = [
  'audioFileID', 'audioFileId', 'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL', 'audioPath',
  'fileID', 'fileId', 'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId',
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'filePath', 'localFilePath', 'tempFilePath'
]

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatUtcStorageDateTime(value = Date.now()) {
  const date = new Date(Number(value))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function getShanghaiUtcDayRange(nowMs = Date.now()) {
  const shanghaiNow = new Date(Number(nowMs) + SHANGHAI_OFFSET_MS)
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

function isPublicSquareWork(work = {}) {
  if (!work || typeof work !== 'object' || isVideoWorkRecord(work)) return false
  const publiclyMarked = work.isPublic === true ||
    work.public === true ||
    String(work.publicStatus || '').toLowerCase() === 'published' ||
    String(work.publishStatus || '').toLowerCase() === 'published' ||
    String(work.visibility || '').toLowerCase() === 'public'
  if (!publiclyMarked) return false

  const statusFields = ['status', 'publicStatus', 'publishStatus', 'squareStatus', 'visibility']
  if (statusFields.some(field => NON_VISIBLE_STATUSES.has(String(work[field] || '').trim().toLowerCase()))) return false

  return AUDIO_MEDIA_FIELDS.some(field => Boolean(String(work[field] || '').trim()))
}

async function collectVisibleSquareRecords(fetchBatch, options = {}) {
  const batchSize = Math.max(Number(options.batchSize || 100), 1)
  const requestedLimit = Number(options.limit)
  const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0 ? requestedLimit : Infinity
  const records = []
  let offset = 0

  while (records.length < limit) {
    const batch = await fetchBatch(offset, batchSize)
    const source = Array.isArray(batch) ? batch : []
    records.push(...source.filter(isPublicSquareWork))
    if (source.length < batchSize) break
    offset += source.length
  }

  return Number.isFinite(limit) ? records.slice(0, limit) : records
}

function normalizeSquareCursor(cursor) {
  const offset = Number(cursor)
  return Number.isInteger(offset) && offset >= 0 ? offset : 0
}

async function collectVisibleSquarePage(fetchBatch, options = {}) {
  const batchSize = Math.max(Number(options.batchSize || 50), 1)
  const pageSize = Math.max(Number(options.pageSize || 20), 1)
  const records = []
  let scanOffset = normalizeSquareCursor(options.cursor)
  let nextCursor = scanOffset

  while (true) {
    const batch = await fetchBatch(scanOffset, batchSize)
    const source = Array.isArray(batch) ? batch : []

    for (let index = 0; index < source.length; index += 1) {
      const record = source[index]
      if (!isPublicSquareWork(record)) continue
      if (records.length >= pageSize) {
        return { records, nextCursor: String(nextCursor), hasMore: true }
      }
      records.push(record)
      nextCursor = scanOffset + index + 1
    }

    scanOffset += source.length
    if (source.length < batchSize) {
      return { records, nextCursor: String(nextCursor), hasMore: false }
    }
  }
}

function isSquareWorkOwner(work = {}, viewer = {}) {
  const openid = String(viewer.openid || '')
  const userId = String(viewer.userId || viewer.id || '')
  const phone = String(viewer.phone || '').replace(/\D/g, '')
  const openidFields = ['ownerOpenid', 'userOpenid', 'openid', '_openid', 'authorOpenid', 'publicOpenid']
  const userIdFields = ['ownerUserId', 'userId', 'authorUserId']
  const phoneFields = ['ownerPhone', 'userPhone', 'phone']
  if (openid && openidFields.some(field => String(work[field] || '') === openid)) return true
  if (userId && userIdFields.some(field => String(work[field] || '') === userId)) return true
  return Boolean(phone && phoneFields.some(field => String(work[field] || '').replace(/\D/g, '') === phone))
}

function parseUtcStorageTime(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    return Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0)
    )
  }
  return Date.parse(text)
}

function computeSquareStats(records = [], options = {}) {
  const range = getShanghaiUtcDayRange(options.nowMs)
  const publicWorks = records.filter(isPublicSquareWork)
  return {
    publicCount: publicWorks.length,
    todayCount: publicWorks.filter(work => {
      const timestamp = parseUtcStorageTime(work.publicAt)
      return Number.isFinite(timestamp) && timestamp >= range.startMs && timestamp < range.endMs
    }).length,
    myPublicCount: publicWorks.filter(work => isSquareWorkOwner(work, options.viewer || {})).length,
    todayStartUtc: range.startText,
    todayEndUtc: range.endText
  }
}

function buildPublicSquareCondition(command) {
  return command.or([
    { isPublic: true },
    { public: true },
    { publicStatus: 'published' },
    { publishStatus: 'published' },
    { visibility: 'public' }
  ])
}

async function querySquareStats({ collection, command, viewer = {}, nowMs = Date.now() }) {
  const publicCondition = buildPublicSquareCondition(command)
  const records = await collectVisibleSquareRecords(async (offset, batchSize) => {
    const result = await collection
      .where(publicCondition)
      .skip(offset)
      .limit(batchSize)
      .get()
    return result.data || []
  }, { batchSize: 100 })

  return computeSquareStats(records, { viewer, nowMs })
}

module.exports = {
  buildPublicSquareCondition,
  collectVisibleSquarePage,
  collectVisibleSquareRecords,
  computeSquareStats,
  formatUtcStorageDateTime,
  getShanghaiUtcDayRange,
  isPublicSquareWork,
  isVideoWorkRecord,
  querySquareStats
}
