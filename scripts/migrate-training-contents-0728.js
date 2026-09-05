#!/usr/bin/env node

/*
 * 六个训练模块的 CloudBase 永久 ID 迁移工具。
 *
 * 安全顺序：本地预检 -> 云端审计/dry-run -> 完整备份 -> 写入永久记录
 * -> 验证 966 条正文 -> 删除旧/重复记录 -> 迁移历史作品引用 -> 最终回读验证。
 * 默认 sync 模式不会覆盖较新的管理端编辑；无法唯一判断时直接阻断。
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CANONICAL_PATH = path.join(ROOT, 'data', 'import', '0728-final', 'canonical-training-contents.json')
const AUDIT_DIR = path.join(ROOT, 'data', 'audit', 'training-content-permanent-id-migration')
const TARGET_ENV = 'cloud1-d0geb9qt9d29ee6fc'
const PERMANENT_ID_RE = /^tc_[0-9a-f]{32}$/
const EXPECTED_COUNTS = {
  topic: 276,
  reading: 216,
  leaderSpeech: 24,
  retell: 257,
  speech: 116,
  mandarin: 77
}
const EXPECTED_TOTAL = Object.values(EXPECTED_COUNTS).reduce((sum, count) => sum + count, 0)
const CONTROLLED_MODULES = new Set(Object.keys(EXPECTED_COUNTS))
const INACTIVE_STATUSES = new Set(['archived', 'inactive', 'deleted', 'disabled', 'draft', 'removed'])
const COLLECTIONS = {
  contents: 'trainingContents',
  modules: 'trainingContentModules',
  revisions: 'trainingContentRevisions',
  submissions: 'submissions'
}
const PAGE_SIZE = 100
const ADMIN_WRITE_SOURCES = new Set([
  'admin',
  'admin_created',
  'admin_web',
  'dashboard_web'
])

function nowIso() {
  return new Date().toISOString()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeModuleId(value) {
  const text = String(value || '').trim()
  if (text === 'retelling') return 'retell'
  if (text === 'leaderspeech') return 'leaderSpeech'
  return text
}

function isPermanentContentId(value) {
  return PERMANENT_ID_RE.test(String(value || '').trim())
}

function isActive(record = {}) {
  if (record.active === false || record.visible === false) return false
  return !INACTIVE_STATUSES.has(String(record.status || 'active').trim().toLowerCase())
}

function numericVersion(record = {}) {
  const value = Number(record.contentVersion || record.version || 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function recordBody(record = {}) {
  return String(record.content || record.material || record.promptText || '').trim()
}

function recordModuleId(record = {}) {
  const explicit = normalizeModuleId(record.moduleId || record.category || record.trainingType)
  if (CONTROLLED_MODULES.has(explicit)) return explicit
  const contentId = String(record.contentId || record.taskId || '').trim()
  const legacyMatch = contentId.match(/^([a-zA-Z]+?)(?:-v\d+)?-day-\d+$/)
  const legacyModule = normalizeModuleId(legacyMatch && legacyMatch[1])
  return CONTROLLED_MODULES.has(legacyModule) ? legacyModule : ''
}

function legacyDayFromId(value) {
  const match = String(value || '').trim().match(/(?:-v\d+)?-day-(\d+)$/i)
  return match ? Number(match[1]) : 0
}

function isAdminOwned(record = {}) {
  return [record.origin, record.updateSource, record.updatedBy, record.createdBy]
    .some(value => ADMIN_WRITE_SOURCES.has(String(value || '').trim().toLowerCase())) ||
    record.isCustom === true
}

function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && value.$date) return toTimestamp(value.$date)
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function canonicalCore(record = {}) {
  const moduleId = normalizeModuleId(record.moduleId || record.category)
  return {
    contentId: String(record.contentId || '').trim(),
    moduleId,
    category: moduleId,
    day: Number(record.day || 0),
    sortOrder: Number(record.sortOrder || record.day || 0),
    sourceDay: Number(record.sourceDay || 0),
    title: String(record.title || '').trim(),
    content: recordBody(record),
    titleHash: String(record.titleHash || sha256(String(record.title || '').trim())),
    contentHash: String(record.contentHash || sha256(recordBody(record))),
    richContentHtml: String(record.richContentHtml || ''),
    richContentHash: String(record.richContentHash || ''),
    titleStyle: record.titleStyle || null,
    contentStyle: record.contentStyle || null,
    contentStylePreset: String(record.contentStylePreset || ''),
    membershipLevel: String(record.membershipLevel || ''),
    status: String(record.status || 'active').trim().toLowerCase(),
    active: record.active !== false,
    visible: record.visible !== false,
    sourceDocument: String(record.sourceDocument || ''),
    sourceDocumentHash: String(record.sourceDocumentHash || ''),
    sourceRevision: String(record.sourceRevision || '')
  }
}

function sameCanonicalCore(left, right) {
  return JSON.stringify(canonicalCore(left)) === JSON.stringify(canonicalCore(right))
}

function recordConcurrencyFingerprint(record) {
  if (!record) return 'missing'
  return sha256(JSON.stringify({
    _id: String(record._id || ''),
    contentId: String(record.contentId || ''),
    moduleId: recordModuleId(record),
    day: Number(record.day || 0),
    sortOrder: Number(record.sortOrder || record.day || 0),
    title: String(record.title || ''),
    contentHash: sha256(recordBody(record)),
    contentVersion: numericVersion(record),
    status: String(record.status || 'active').trim().toLowerCase(),
    active: record.active !== false,
    visible: record.visible !== false,
    updateSource: String(record.updateSource || ''),
    updatedBy: String(record.updatedBy || ''),
    updatedAt: toTimestamp(record.updatedAt)
  }))
}

function submissionReferenceFingerprint(record) {
  if (!record) return 'missing'
  return sha256(JSON.stringify({
    sourceType: String(record.sourceType || 'main'),
    contentId: String(record.contentId || ''),
    taskId: String(record.taskId || ''),
    moduleId: recordModuleId(record),
    day: Number(record.day || 0),
    sortOrder: Number(record.sortOrder || record.day || 0),
    title: String(record.title || record.contentTitle || record.taskTitle || '').trim(),
    contentHash: sha256(recordBody(record)),
    trainingReferenceStatus: String(record.trainingReferenceStatus || '')
  }))
}

function submissionSourceSignature(submissions = []) {
  const references = submissions
    .filter(record => (record.sourceType || 'main') !== 'extra')
    .map(record => ({
      recordId: String(record._id || ''),
      fingerprint: submissionReferenceFingerprint(record)
    }))
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
  return sha256(JSON.stringify(references))
}

function submissionPlanSignature(plan = {}) {
  const actions = (plan.actions || []).map(item => ({
    recordId: String(item.recordId || ''),
    before: submissionReferenceFingerprint(item.before),
    contentId: String(item.contentId || ''),
    taskId: String(item.data && item.data.taskId || ''),
    trainingReferenceStatus: String(item.data && item.data.trainingReferenceStatus || '')
  })).sort((left, right) => left.recordId.localeCompare(right.recordId))
  return sha256(JSON.stringify({ sourceSignature: plan.sourceSignature || '', actions }))
}

function migrationPlanSignature(plan = {}) {
  const upserts = (plan.upserts || []).map(item => ({
    action: item.action,
    contentId: item.contentId,
    recordId: item.recordId,
    before: recordConcurrencyFingerprint(item.before),
    afterCore: sha256(JSON.stringify(canonicalCore(item.after))),
    afterVersion: numericVersion(item.after)
  })).sort((left, right) => `${left.contentId}:${left.recordId}`.localeCompare(`${right.contentId}:${right.recordId}`))
  const deletions = (plan.deletions || []).map(item => ({
    action: item.action,
    contentId: item.contentId,
    recordId: item.recordId,
    before: recordConcurrencyFingerprint(item.before)
  })).sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)))
  return sha256(JSON.stringify({ upserts, deletions }))
}

function validateCanonical(records) {
  const errors = []
  const ids = new Set()
  const positions = new Set()
  const counts = {}
  if (!Array.isArray(records) || records.length !== EXPECTED_TOTAL) {
    errors.push(`CANONICAL_TOTAL expected=${EXPECTED_TOTAL} actual=${Array.isArray(records) ? records.length : 0}`)
  }
  records.forEach((record, index) => {
    const moduleId = normalizeModuleId(record.moduleId || record.category)
    const contentId = String(record.contentId || '').trim()
    const day = Number(record.day || 0)
    const sortOrder = Number(record.sortOrder || 0)
    const key = `${moduleId}:${day}`
    counts[moduleId] = (counts[moduleId] || 0) + 1
    if (!CONTROLLED_MODULES.has(moduleId)) errors.push(`INVALID_MODULE index=${index} moduleId=${moduleId}`)
    if (!isPermanentContentId(contentId)) errors.push(`INVALID_CONTENT_ID index=${index} contentId=${contentId}`)
    if (ids.has(contentId)) errors.push(`DUPLICATE_CONTENT_ID contentId=${contentId}`)
    if (positions.has(key)) errors.push(`DUPLICATE_MODULE_DAY ${key}`)
    if (!String(record.title || '').trim()) errors.push(`EMPTY_TITLE contentId=${contentId}`)
    if (!recordBody(record)) errors.push(`EMPTY_CONTENT contentId=${contentId}`)
    if (day < 1 || sortOrder !== day) errors.push(`DAY_ORDER_ERROR contentId=${contentId}`)
    if (record.titleHash !== sha256(String(record.title || '').trim())) errors.push(`TITLE_HASH_MISMATCH contentId=${contentId}`)
    if (record.contentHash !== sha256(recordBody(record))) errors.push(`CONTENT_HASH_MISMATCH contentId=${contentId}`)
    if (String(record.status || '').toLowerCase() !== 'active' || record.active === false || record.visible === false) {
      errors.push(`CANONICAL_NOT_ACTIVE contentId=${contentId}`)
    }
    ids.add(contentId)
    positions.add(key)
  })
  Object.entries(EXPECTED_COUNTS).forEach(([moduleId, expected]) => {
    if (Number(counts[moduleId] || 0) !== expected) {
      errors.push(`MODULE_COUNT ${moduleId} expected=${expected} actual=${counts[moduleId] || 0}`)
    }
    const days = records
      .filter(record => normalizeModuleId(record.moduleId || record.category) === moduleId)
      .map(record => Number(record.day || 0))
      .sort((a, b) => a - b)
    if (days.some((day, index) => day !== index + 1)) errors.push(`MODULE_DAY_GAP moduleId=${moduleId}`)
  })
  if (errors.length) {
    const error = new Error(`canonical 预检失败（${errors.length} 项）`)
    error.code = 'CANONICAL_VALIDATION_FAILED'
    error.details = errors
    throw error
  }
  return { total: records.length, counts, permanentIds: ids.size }
}

function createCanonicalIndexes(canonicalRecords) {
  const byId = new Map()
  const byModule = new Map()
  canonicalRecords.forEach(record => {
    const moduleId = normalizeModuleId(record.moduleId || record.category)
    const normalized = { ...record, moduleId, category: moduleId }
    byId.set(record.contentId, normalized)
    if (!byModule.has(moduleId)) byModule.set(moduleId, [])
    byModule.get(moduleId).push(normalized)
  })
  return { byId, byModule }
}

function uniqueMatch(records, predicate) {
  const matches = records.filter(predicate)
  return matches.length === 1 ? matches[0] : null
}

// 旧 ID 只允许在迁移脚本内读取；正式记录不会保存任何旧 ID 字段。
function matchLegacyRecord(record, indexes) {
  const moduleId = recordModuleId(record)
  const candidates = indexes.byModule.get(moduleId) || []
  if (!candidates.length) return { match: null, reason: 'module_unresolved' }
  const title = String(record.title || record.contentTitle || record.taskTitle || '').trim()
  const content = recordBody(record)
  const titleHash = title ? sha256(title) : ''
  const contentHash = content ? sha256(content) : ''
  let match = null
  if (titleHash && contentHash) {
    match = uniqueMatch(candidates, item => item.titleHash === titleHash && item.contentHash === contentHash)
    if (match) return { match, reason: 'title_and_content_hash' }
  }
  if (contentHash) {
    match = uniqueMatch(candidates, item => item.contentHash === contentHash)
    if (match) return { match, reason: 'unique_content_hash' }
  }
  if (titleHash) {
    match = uniqueMatch(candidates, item => item.titleHash === titleHash)
    if (match) return { match, reason: 'unique_title_hash' }
  }
  const legacyDay = legacyDayFromId(record.contentId || record.taskId) || Number(record.day || record.sortOrder || 0)
  if (legacyDay > 0) {
    const positionMatch = candidates.find(item => Number(item.day) === legacyDay) || null
    if (positionMatch && (!title || positionMatch.title === title) && (!content || positionMatch.contentHash === contentHash)) {
      return { match: positionMatch, reason: 'verified_legacy_position' }
    }
  }
  return { match: null, reason: 'ambiguous_or_unmatched' }
}

function buildImportedRecord(canonical, current, migrationId) {
  const currentVersion = current ? numericVersion(current) : 0
  const canonicalVersion = numericVersion(canonical)
  const contentChanged = current ? !sameCanonicalCore(current, canonical) : false
  const nextVersion = current
    ? Math.max(canonicalVersion, contentChanged ? currentVersion + 1 : currentVersion)
    : canonicalVersion
  return {
    ...canonical,
    moduleId: canonical.moduleId,
    category: canonical.moduleId,
    contentId: canonical.contentId,
    day: Number(canonical.day),
    sortOrder: Number(canonical.day),
    sourceDay: Number(canonical.sourceDay || canonical.day),
    version: nextVersion,
    contentVersion: nextVersion,
    status: 'active',
    active: true,
    visible: true,
    updateSource: 'controlled_import',
    migrationId,
    updatedAt: contentChanged || !current ? nowIso() : (current.updatedAt || canonical.updatedAt || nowIso()),
    createdAt: current && current.createdAt || nowIso(),
    createdBy: current && current.createdBy || 'controlled_import_0728'
  }
}

function chooseExactRecord(records, canonical) {
  return records.slice().sort((left, right) => {
    const activeDiff = Number(isActive(right)) - Number(isActive(left))
    if (activeDiff) return activeDiff
    const sameDiff = Number(sameCanonicalCore(right, canonical)) - Number(sameCanonicalCore(left, canonical))
    if (sameDiff) return sameDiff
    const versionDiff = numericVersion(right) - numericVersion(left)
    if (versionDiff) return versionDiff
    return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt)
  })[0] || null
}

function buildSubmissionReferencePlan(submissions, indexes) {
  const actions = []
  const audit = []
  submissions.forEach(record => {
    if ((record.sourceType || 'main') === 'extra') return
    const rawContentId = String(record.contentId || record.taskId || '').trim()
    if (rawContentId && indexes.byId.has(rawContentId)) return
    const resolved = matchLegacyRecord(record, indexes)
    const nextContentId = resolved.match ? resolved.match.contentId : ''
    const currentTaskId = String(record.taskId || '').trim()
    if (rawContentId === nextContentId && (!currentTaskId || currentTaskId === nextContentId)) return
    actions.push({
      action: 'update_submission_reference',
      recordId: record._id,
      contentId: nextContentId,
      before: record,
      data: {
        contentId: nextContentId,
        taskId: nextContentId,
        trainingReferenceStatus: nextContentId ? 'permanent_id_mapped' : 'historical_snapshot_only',
        updatedAt: nowIso()
      }
    })
    audit.push({
      submissionId: record._id || '',
      hadReference: Boolean(rawContentId || currentTaskId),
      mapped: Boolean(nextContentId),
      contentId: nextContentId,
      reason: resolved.reason
    })
  })
  return {
    actions,
    audit,
    sourceSignature: submissionSourceSignature(submissions)
  }
}

function buildMigrationPlan(canonicalRecords, cloudRecords, options = {}) {
  validateCanonical(canonicalRecords)
  const migrationId = options.migrationId || `training-permanent-id-${Date.now()}`
  const strategy = options.strategy || 'sync'
  const force = strategy === 'force'
  const indexes = createCanonicalIndexes(canonicalRecords)
  const controlledCloudRecords = cloudRecords.filter(record => CONTROLLED_MODULES.has(recordModuleId(record)))
  const byExactId = new Map()
  controlledCloudRecords.forEach(record => {
    const contentId = String(record.contentId || '').trim()
    if (!isPermanentContentId(contentId) || !indexes.byId.has(contentId)) return
    if (!byExactId.has(contentId)) byExactId.set(contentId, [])
    byExactId.get(contentId).push(record)
  })

  const upserts = []
  const deletions = []
  const conflicts = []
  const unchanged = []
  const legacyAudit = []
  const retainedRecordIds = new Set()

  canonicalRecords.forEach(canonical => {
    const exactRecords = byExactId.get(canonical.contentId) || []
    const docIdCollision = controlledCloudRecords.find(record => (
      String(record._id || '') === canonical.contentId &&
      !exactRecords.includes(record)
    ))
    const current = chooseExactRecord(exactRecords.length ? exactRecords : (docIdCollision ? [docIdCollision] : []), canonical)
    if (current) retainedRecordIds.add(String(current._id || ''))

    const currentDiffers = current && !sameCanonicalCore(current, canonical)
    const currentIsNewer = current && numericVersion(current) > numericVersion(canonical)
    if (currentDiffers && !force && (isAdminOwned(current) || currentIsNewer)) {
      conflicts.push({
        code: isAdminOwned(current) ? 'NEWER_ADMIN_EDIT' : 'NEWER_CLOUD_VERSION',
        contentId: canonical.contentId,
        recordId: current._id || '',
        currentVersion: numericVersion(current),
        canonicalVersion: numericVersion(canonical)
      })
      return
    }

    if (current && sameCanonicalCore(current, canonical) && isActive(current) && String(current.contentId || '') === canonical.contentId) {
      unchanged.push({ contentId: canonical.contentId, recordId: current._id || '', contentVersion: numericVersion(current) })
    } else {
      upserts.push({
        action: current ? 'update' : 'create',
        contentId: canonical.contentId,
        recordId: current && current._id || canonical.contentId,
        before: current || null,
        after: buildImportedRecord(canonical, current, migrationId)
      })
    }

    exactRecords.filter(record => record !== current).forEach(record => {
      if (isAdminOwned(record) && !sameCanonicalCore(record, canonical) && !force) {
        conflicts.push({ code: 'DUPLICATE_ADMIN_RECORD', contentId: canonical.contentId, recordId: record._id || '' })
      }
    })
  })

  controlledCloudRecords.forEach(record => {
    const recordId = String(record._id || '')
    if (retainedRecordIds.has(recordId)) return
    const contentId = String(record.contentId || '').trim()
    const resolved = isPermanentContentId(contentId) && indexes.byId.has(contentId)
      ? { match: indexes.byId.get(contentId), reason: 'duplicate_permanent_id' }
      : matchLegacyRecord(record, indexes)
    legacyAudit.push({
      recordId,
      permanent: isPermanentContentId(contentId),
      mappedContentId: resolved.match && resolved.match.contentId || '',
      reason: resolved.reason,
      adminOwned: isAdminOwned(record),
      active: isActive(record)
    })
    // 已删除的管理员测试墓碑，以及正文 Hash 唯一命中 canonical 的旧自定义重复记录，
    // 会先进入完整备份和 revision 审计，再安全移除。其余活跃管理员内容继续阻断迁移。
    const resolvedCoreMatches = Boolean(
      resolved.match &&
      String(record.title || '').trim() === resolved.match.title &&
      recordBody(record) &&
      sha256(recordBody(record)) === resolved.match.contentHash
    )
    const safeAdminLegacyCleanup = !isActive(record) || resolvedCoreMatches
    if (isAdminOwned(record) && !safeAdminLegacyCleanup && !force) {
      conflicts.push({ code: 'UNRESOLVED_ADMIN_RECORD', recordId, contentId, reason: resolved.reason })
      return
    }
    deletions.push({
      action: isPermanentContentId(contentId) ? 'delete_duplicate_or_stale' : 'delete_legacy',
      recordId,
      contentId,
      mappedContentId: resolved.match && resolved.match.contentId || '',
      preservedInAudit: isAdminOwned(record),
      before: record
    })
  })

  return {
    migrationId,
    strategy,
    canonicalCount: canonicalRecords.length,
    cloudControlledCount: controlledCloudRecords.length,
    upserts,
    deletions,
    unchanged,
    conflicts,
    legacyAudit,
    summary: {
      create: upserts.filter(item => item.action === 'create').length,
      update: upserts.filter(item => item.action === 'update').length,
      deleteLegacy: deletions.filter(item => item.action === 'delete_legacy').length,
      deleteDuplicateOrStale: deletions.filter(item => item.action === 'delete_duplicate_or_stale').length,
      unchanged: unchanged.length,
      conflicts: conflicts.length,
      changeCount: upserts.length + deletions.length
    }
  }
}

function verifyCanonicalPresence(canonicalRecords, cloudRecords) {
  const errors = []
  const exactMap = new Map()
  cloudRecords.forEach(record => {
    const contentId = String(record.contentId || '').trim()
    if (!isPermanentContentId(contentId)) return
    if (!exactMap.has(contentId)) exactMap.set(contentId, [])
    exactMap.get(contentId).push(record)
  })
  canonicalRecords.forEach(canonical => {
    const records = (exactMap.get(canonical.contentId) || []).filter(isActive)
    if (records.length !== 1) {
      errors.push({ code: 'CANONICAL_RECORD_COUNT', contentId: canonical.contentId, actual: records.length })
      return
    }
    if (!sameCanonicalCore(records[0], canonical)) {
      errors.push({ code: 'CANONICAL_FIELD_MISMATCH', contentId: canonical.contentId })
    }
  })
  return { ok: errors.length === 0, errors }
}

function buildCloudVerification(canonicalRecords, cloudRecords) {
  const controlled = cloudRecords.filter(record => CONTROLLED_MODULES.has(recordModuleId(record)))
  const active = controlled.filter(isActive)
  const permanentActive = active.filter(record => isPermanentContentId(record.contentId))
  const oldIdCount = controlled.filter(record => !isPermanentContentId(record.contentId)).length
  const idCounts = new Map()
  const positionCounts = new Map()
  permanentActive.forEach(record => {
    const contentId = String(record.contentId || '').trim()
    const key = `${recordModuleId(record)}:${Number(record.day || record.sortOrder || 0)}`
    idCounts.set(contentId, (idCounts.get(contentId) || 0) + 1)
    positionCounts.set(key, (positionCounts.get(key) || 0) + 1)
  })
  const presence = verifyCanonicalPresence(canonicalRecords, cloudRecords)
  const counts = {}
  permanentActive.forEach(record => {
    const moduleId = recordModuleId(record)
    counts[moduleId] = (counts[moduleId] || 0) + 1
  })
  const metrics = {
    CLOUD_ACTIVE_TOTAL: active.length,
    CLOUD_PERMANENT_ID_COUNT: new Set(permanentActive.map(record => record.contentId)).size,
    CLOUD_OLD_ID_COUNT: oldIdCount,
    CLOUD_DUPLICATE_CONTENT_ID: Array.from(idCounts.values()).filter(count => count > 1).length,
    CLOUD_DUPLICATE_MODULE_DAY: Array.from(positionCounts.values()).filter(count => count > 1).length,
    CLOUD_EMPTY_TITLE: active.filter(record => !String(record.title || '').trim()).length,
    CLOUD_EMPTY_CONTENT: active.filter(record => !recordBody(record)).length,
    CLOUD_CANONICAL_FIELD_MISMATCH: presence.errors.filter(item => item.code === 'CANONICAL_FIELD_MISMATCH').length,
    CLOUD_MISSING_CANONICAL: presence.errors.filter(item => item.code === 'CANONICAL_RECORD_COUNT').length,
    moduleCounts: counts
  }
  const expected = {
    CLOUD_ACTIVE_TOTAL: EXPECTED_TOTAL,
    CLOUD_PERMANENT_ID_COUNT: EXPECTED_TOTAL,
    CLOUD_OLD_ID_COUNT: 0,
    CLOUD_DUPLICATE_CONTENT_ID: 0,
    CLOUD_DUPLICATE_MODULE_DAY: 0,
    CLOUD_EMPTY_TITLE: 0,
    CLOUD_EMPTY_CONTENT: 0,
    CLOUD_CANONICAL_FIELD_MISMATCH: 0,
    CLOUD_MISSING_CANONICAL: 0
  }
  const errors = Object.entries(expected)
    .filter(([key, value]) => metrics[key] !== value)
    .map(([key, value]) => `${key} expected=${value} actual=${metrics[key]}`)
  Object.entries(EXPECTED_COUNTS).forEach(([moduleId, expectedCount]) => {
    if (Number(counts[moduleId] || 0) !== expectedCount) {
      errors.push(`CLOUD_MODULE_COUNT ${moduleId} expected=${expectedCount} actual=${counts[moduleId] || 0}`)
    }
  })
  return { verified: errors.length === 0, metrics, errors, presenceErrors: presence.errors }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    mode: 'local',
    strategy: 'sync',
    env: '',
    confirmEnv: '',
    backup: '',
    rollbackPlan: '',
    auditFile: ''
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--cloud-dry-run') args.mode = 'cloud-dry-run'
    else if (token === '--apply') args.mode = 'apply'
    else if (token === '--verify') args.mode = 'verify'
    else if (token === '--initial-import') args.strategy = 'initial-import'
    else if (token === '--sync') args.strategy = 'sync'
    else if (token === '--force-overwrite-cloud') args.strategy = 'force'
    else if (token === '--env') args.env = argv[++index] || ''
    else if (token === '--confirm-env') args.confirmEnv = argv[++index] || ''
    else if (token === '--backup') {
      args.backup = argv[++index] || ''
      if (args.mode === 'local') args.mode = 'backup'
    } else if (token === '--rollback-plan') {
      args.mode = 'rollback-plan'
      args.rollbackPlan = argv[++index] || ''
    } else if (token === '--audit-file') args.auditFile = argv[++index] || ''
    else if (token === '--help' || token === '-h') args.help = true
    else throw new Error(`未知参数：${token}`)
  }
  return args
}

function assertCloudArgs(args) {
  if (!args.env) throw new Error('云端操作必须显式提供 --env')
  if (args.env !== TARGET_ENV) throw new Error(`本迁移只允许目标环境 ${TARGET_ENV}`)
  if (args.mode === 'apply') {
    if (args.confirmEnv !== args.env) throw new Error('--confirm-env 必须与 --env 完全一致')
    if (process.env.TRAINING_CONTENT_MIGRATION_CONFIRM !== args.env) {
      throw new Error('必须设置 TRAINING_CONTENT_MIGRATION_CONFIRM=<env>')
    }
    if (!args.backup) throw new Error('--apply 必须提供 --backup <path>')
  }
  if (args.mode === 'backup' && !args.backup) throw new Error('--backup 必须指定备份文件')
  if (args.mode === 'rollback-plan' && !args.rollbackPlan) throw new Error('--rollback-plan 必须指定备份文件')
}

function getCloudDatabase(args) {
  assertCloudArgs(args)
  const secretId = process.env.CLOUDBASE_SECRET_ID ||
    process.env.TENCENTCLOUD_SECRET_ID ||
    process.env.TENCENTCLOUD_SECRETID ||
    ''
  const secretKey = process.env.CLOUDBASE_SECRET_KEY ||
    process.env.TENCENTCLOUD_SECRET_KEY ||
    process.env.TENCENTCLOUD_SECRETKEY ||
    ''
  if (!secretId || !secretKey) {
    const error = new Error('WAITING_FOR_CLOUDBASE_CREDENTIALS')
    error.code = 'WAITING_FOR_CLOUDBASE_CREDENTIALS'
    throw error
  }
  const cloudbase = require('@cloudbase/node-sdk')
  return cloudbase.init({ env: args.env, secretId, secretKey }).database()
}

async function fetchAll(db, collectionName) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await db.collection(collectionName)
      .orderBy('_id', 'asc')
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
    const page = result.data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function fetchCollectionOrEmpty(db, collectionName) {
  try {
    return await fetchAll(db, collectionName)
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || '')
    if (/collection.*not exist|集合.*不存在|-502005/i.test(message)) return []
    throw error
  }
}

function stripId(record = {}) {
  const value = { ...record }
  delete value._id
  return value
}

async function createBackup(db, file, migrationId) {
  const [contents, modules, revisions, submissions] = await Promise.all([
    fetchCollectionOrEmpty(db, COLLECTIONS.contents),
    fetchCollectionOrEmpty(db, COLLECTIONS.modules),
    fetchCollectionOrEmpty(db, COLLECTIONS.revisions),
    fetchCollectionOrEmpty(db, COLLECTIONS.submissions)
  ])
  const backup = {
    env: TARGET_ENV,
    migrationId,
    createdAt: nowIso(),
    collections: { contents, modules, revisions, submissions }
  }
  backup.sha256 = sha256(JSON.stringify(backup.collections))
  writeJson(file, backup)
  const reloaded = readJson(file)
  if (reloaded.sha256 !== sha256(JSON.stringify(reloaded.collections))) {
    throw new Error('备份回读 Hash 校验失败')
  }
  return backup
}

async function addRevision(db, migrationId, action, before, after, contentId, recordId) {
  await db.collection(COLLECTIONS.revisions).add({
    migrationId,
    action,
    contentId: contentId || '',
    recordId: recordId || '',
    before: before || null,
    after: after || null,
    createdAt: nowIso()
  })
}

async function readDocumentOrNull(db, collectionName, recordId) {
  try {
    const result = await db.collection(collectionName).doc(recordId).get()
    const data = result && result.data
    return data && !Array.isArray(data) ? data : (data || [])[0] || null
  } catch (error) {
    const text = `${error && (error.code || error.errCode) || ''} ${error && (error.message || error.errMsg) || ''}`
    if (/not.*exist|not.*found|DOCUMENT_NOT_EXIST|-502002/i.test(text)) return null
    throw error
  }
}

function assertRecordUnchanged(expected, actual, recordId, action) {
  const expectedFingerprint = recordConcurrencyFingerprint(expected)
  const actualFingerprint = recordConcurrencyFingerprint(actual)
  if (expectedFingerprint === actualFingerprint) return
  const error = new Error(`迁移计划生成后记录发生变化，拒绝 ${action}：${recordId}`)
  error.code = 'MIGRATION_CONCURRENT_MODIFICATION'
  error.details = { recordId, action, expectedFingerprint, actualFingerprint }
  throw error
}

function assertSubmissionReferenceUnchanged(expected, actual, recordId) {
  const expectedFingerprint = submissionReferenceFingerprint(expected)
  const actualFingerprint = submissionReferenceFingerprint(actual)
  if (expectedFingerprint === actualFingerprint) return
  const error = new Error(`迁移计划生成后作品引用发生变化，拒绝更新：${recordId}`)
  error.code = 'MIGRATION_CONCURRENT_MODIFICATION'
  error.details = { recordId, action: 'update_submission_reference', expectedFingerprint, actualFingerprint }
  throw error
}

async function assertPlanStillCurrent(db, canonical, plan) {
  const latestRecords = await fetchCollectionOrEmpty(db, COLLECTIONS.contents)
  const latestPlan = buildMigrationPlan(canonical, latestRecords, {
    strategy: plan.strategy,
    migrationId: plan.migrationId
  })
  if (latestPlan.conflicts.length || migrationPlanSignature(latestPlan) !== migrationPlanSignature(plan)) {
    const error = new Error('dry-run/备份后云端训练内容发生变化，拒绝继续迁移')
    error.code = 'MIGRATION_CONCURRENT_MODIFICATION'
    error.details = {
      conflicts: latestPlan.conflicts,
      plannedSignature: migrationPlanSignature(plan),
      latestSignature: migrationPlanSignature(latestPlan)
    }
    throw error
  }
}

async function assertSubmissionPlanStillCurrent(db, indexes, submissionPlan) {
  const latestSubmissions = await fetchCollectionOrEmpty(db, COLLECTIONS.submissions)
  const latestPlan = buildSubmissionReferencePlan(latestSubmissions, indexes)
  if (submissionPlanSignature(latestPlan) === submissionPlanSignature(submissionPlan)) return
  const error = new Error('dry-run/备份后作品引用发生变化，拒绝继续迁移')
  error.code = 'MIGRATION_CONCURRENT_MODIFICATION'
  error.details = {
    plannedSignature: submissionPlanSignature(submissionPlan),
    latestSignature: submissionPlanSignature(latestPlan)
  }
  throw error
}

async function applyPlan(db, canonical, plan, submissionPlan) {
  if (plan.conflicts.length) throw new Error(`存在 ${plan.conflicts.length} 条未解决冲突，拒绝 apply`)
  await assertPlanStillCurrent(db, canonical, plan)
  const canonicalIndexes = createCanonicalIndexes(canonical)
  await assertSubmissionPlanStillCurrent(db, canonicalIndexes, submissionPlan)
  const checkpoint = { migrationId: plan.migrationId, startedAt: nowIso(), phases: [] }
  const checkpointPath = path.join(AUDIT_DIR, `apply-checkpoint-${plan.migrationId}.json`)

  for (const action of plan.upserts) {
    const recordId = action.recordId || action.contentId
    const latest = await readDocumentOrNull(db, COLLECTIONS.contents, recordId)
    assertRecordUnchanged(action.before, latest, recordId, action.action)
    if (action.action === 'create') {
      await db.collection(COLLECTIONS.contents).doc(recordId).set(stripId(action.after))
    } else {
      await db.collection(COLLECTIONS.contents).doc(recordId).update(stripId(action.after))
    }
    await addRevision(db, plan.migrationId, action.action, action.before, action.after, action.contentId, recordId)
  }
  checkpoint.phases.push({ name: 'upsert_permanent_records', count: plan.upserts.length, completedAt: nowIso() })
  writeJson(checkpointPath, checkpoint)

  const afterUpsert = await fetchAll(db, COLLECTIONS.contents)
  const presence = verifyCanonicalPresence(canonical, afterUpsert)
  if (!presence.ok) {
    writeJson(path.join(AUDIT_DIR, `pre-delete-verify-failed-${plan.migrationId}.json`), presence)
    throw new Error(`永久记录写入后验证失败（${presence.errors.length} 项），未删除任何旧记录`)
  }
  checkpoint.phases.push({ name: 'verify_before_delete', count: canonical.length, completedAt: nowIso() })
  writeJson(checkpointPath, checkpoint)

  // 正文批量写入可能耗时，再次复核作品引用，避免期间新增的旧引用漏迁。
  await assertSubmissionPlanStillCurrent(db, canonicalIndexes, submissionPlan)
  for (const action of submissionPlan.actions) {
    const latest = await readDocumentOrNull(db, COLLECTIONS.submissions, action.recordId)
    assertSubmissionReferenceUnchanged(action.before, latest, action.recordId)
    await db.collection(COLLECTIONS.submissions).doc(action.recordId).update(action.data)
  }
  checkpoint.phases.push({ name: 'migrate_submission_references', count: submissionPlan.actions.length, completedAt: nowIso() })
  writeJson(checkpointPath, checkpoint)

  const latestSubmissions = await fetchCollectionOrEmpty(db, COLLECTIONS.submissions)
  const remainingSubmissionPlan = buildSubmissionReferencePlan(latestSubmissions, canonicalIndexes)
  if (remainingSubmissionPlan.actions.length) {
    const error = new Error(`仍有 ${remainingSubmissionPlan.actions.length} 条作品引用待迁移，拒绝删除旧训练内容`)
    error.code = 'MIGRATION_CONCURRENT_MODIFICATION'
    error.details = remainingSubmissionPlan.audit
    throw error
  }
  checkpoint.phases.push({ name: 'verify_submission_references', count: latestSubmissions.length, completedAt: nowIso() })
  writeJson(checkpointPath, checkpoint)

  for (const action of plan.deletions) {
    const latest = await readDocumentOrNull(db, COLLECTIONS.contents, action.recordId)
    assertRecordUnchanged(action.before, latest, action.recordId, action.action)
    await addRevision(db, plan.migrationId, action.action, action.before, null, action.mappedContentId || '', action.recordId)
    await db.collection(COLLECTIONS.contents).doc(action.recordId).remove()
  }
  checkpoint.phases.push({ name: 'remove_legacy_and_duplicates', count: plan.deletions.length, completedAt: nowIso() })

  const moduleGroups = createCanonicalIndexes(canonical).byModule
  for (const [moduleId, records] of moduleGroups.entries()) {
    const moduleVersion = sha256(records.map(item => `${item.contentId}:${numericVersion(item)}:${item.day}`).join('|')).slice(0, 20)
    await db.collection(COLLECTIONS.modules).doc(`module_${moduleId}`).set({
      moduleId,
      moduleVersion,
      publishedCount: records.length,
      schemaVersion: 1,
      migrationId: plan.migrationId,
      updatedAt: nowIso()
    })
  }
  checkpoint.phases.push({ name: 'update_module_catalog_metadata', count: moduleGroups.size, completedAt: nowIso() })
  checkpoint.completedAt = nowIso()
  writeJson(checkpointPath, checkpoint)
  return checkpoint
}

function buildRollbackPlan(backup) {
  const collections = backup.collections || {}
  return {
    env: backup.env,
    migrationId: backup.migrationId,
    backupHashVerified: backup.sha256 === sha256(JSON.stringify(collections)),
    generatedAt: nowIso(),
    steps: [
      '暂停管理端训练内容写入。',
      `按 _id 恢复 trainingContents ${Number((collections.contents || []).length)} 条备份记录。`,
      `按 _id 恢复 trainingContentModules ${Number((collections.modules || []).length)} 条备份记录。`,
      `按 _id 恢复 submissions ${Number((collections.submissions || []).length)} 条备份记录。`,
      '删除本迁移新增且备份中不存在的记录。',
      '重新执行 --verify，并抽查六模块与 reading Day 5。'
    ],
    note: '本命令只生成回滚计划，不自动写云端。'
  }
}

function publicPlan(plan, submissionPlan) {
  return {
    migrationId: plan.migrationId,
    strategy: plan.strategy,
    canonicalCount: plan.canonicalCount,
    cloudControlledCount: plan.cloudControlledCount,
    summary: plan.summary,
    conflicts: plan.conflicts,
    legacyAudit: plan.legacyAudit,
    upserts: plan.upserts.map(item => ({ action: item.action, contentId: item.contentId, recordId: item.recordId })),
    deletions: plan.deletions.map(item => ({ action: item.action, recordId: item.recordId, mappedContentId: item.mappedContentId })),
    submissionReferences: {
      updateCount: submissionPlan.actions.length,
      mappedCount: submissionPlan.audit.filter(item => item.mapped).length,
      snapshotOnlyCount: submissionPlan.audit.filter(item => !item.mapped).length,
      audit: submissionPlan.audit
    }
  }
}

function printHelp() {
  console.log([
    '本地预检：node scripts/migrate-training-contents-0728.js',
    `云端 dry-run：node scripts/migrate-training-contents-0728.js --cloud-dry-run --sync --env ${TARGET_ENV}`,
    `仅备份：node scripts/migrate-training-contents-0728.js --backup <file> --env ${TARGET_ENV}`,
    `正式迁移：TRAINING_CONTENT_MIGRATION_CONFIRM=${TARGET_ENV} node scripts/migrate-training-contents-0728.js --apply --sync --env ${TARGET_ENV} --confirm-env ${TARGET_ENV} --backup <file>`,
    `强制覆盖：在正式迁移命令中把 --sync 改成 --force-overwrite-cloud`,
    `验证：node scripts/migrate-training-contents-0728.js --verify --env ${TARGET_ENV}`,
    '回滚计划：node scripts/migrate-training-contents-0728.js --rollback-plan <backup-file>'
  ].join('\n'))
}

async function main() {
  const args = parseArgs()
  if (args.help) return printHelp()
  const canonical = readJson(CANONICAL_PATH)
  const canonicalSummary = validateCanonical(canonical)

  if (args.mode === 'local') {
    const result = {
      status: 'READY_FOR_CLOUD_DRY_RUN',
      targetEnv: TARGET_ENV,
      canonical: canonicalSummary,
      note: '本地预检通过；尚未连接或写入 CloudBase。'
    }
    writeJson(args.auditFile || path.join(AUDIT_DIR, 'local-readiness.json'), result)
    console.log(JSON.stringify(result, null, 2))
    return result
  }

  if (args.mode === 'rollback-plan') {
    const backup = readJson(args.rollbackPlan)
    const result = buildRollbackPlan(backup)
    const output = args.auditFile || path.join(AUDIT_DIR, `rollback-plan-${backup.migrationId || Date.now()}.json`)
    writeJson(output, result)
    console.log(JSON.stringify(result, null, 2))
    return result
  }

  const db = getCloudDatabase(args)
  if (args.mode === 'backup') {
    const result = await createBackup(db, args.backup, `backup-${Date.now()}`)
    console.log(JSON.stringify({ status: 'BACKUP_COMPLETE', file: args.backup, sha256: result.sha256 }, null, 2))
    return result
  }

  const [cloudRecords, submissions] = await Promise.all([
    fetchCollectionOrEmpty(db, COLLECTIONS.contents),
    fetchCollectionOrEmpty(db, COLLECTIONS.submissions)
  ])
  const plan = buildMigrationPlan(canonical, cloudRecords, { strategy: args.strategy })
  const submissionPlan = buildSubmissionReferencePlan(submissions, createCanonicalIndexes(canonical))
  const audit = publicPlan(plan, submissionPlan)
  const auditPath = args.auditFile || path.join(AUDIT_DIR, `${args.mode}-${plan.migrationId}.json`)
  writeJson(auditPath, audit)

  if (args.mode === 'cloud-dry-run') {
    console.log(JSON.stringify(audit, null, 2))
    if (plan.conflicts.length) process.exitCode = 2
    return audit
  }

  if (args.mode === 'verify') {
    const verification = buildCloudVerification(canonical, cloudRecords)
    const result = { status: verification.verified ? 'CLOUD_VERIFY_COMPLETE' : 'CLOUD_VERIFY_FAILED', ...verification }
    writeJson(args.auditFile || path.join(AUDIT_DIR, `verify-${Date.now()}.json`), result)
    console.log(JSON.stringify(result, null, 2))
    if (!verification.verified) process.exitCode = 2
    return result
  }

  if (plan.conflicts.length) {
    throw new Error(`dry-run 发现 ${plan.conflicts.length} 条冲突；未写入 CloudBase`)
  }
  await createBackup(db, args.backup, plan.migrationId)
  const checkpoint = await applyPlan(db, canonical, plan, submissionPlan)
  const afterRecords = await fetchAll(db, COLLECTIONS.contents)
  const verification = buildCloudVerification(canonical, afterRecords)
  const secondPlan = buildMigrationPlan(canonical, afterRecords, { strategy: args.strategy, migrationId: `${plan.migrationId}-idempotency` })
  const result = {
    status: verification.verified && secondPlan.summary.changeCount === 0
      ? 'APPLIED_AND_VERIFIED'
      : 'APPLIED_VERIFY_FAILED',
    migrationId: plan.migrationId,
    checkpoint,
    verification,
    SECOND_APPLY_CHANGE_COUNT: secondPlan.summary.changeCount,
    secondApplyConflicts: secondPlan.conflicts
  }
  writeJson(path.join(AUDIT_DIR, `apply-result-${plan.migrationId}.json`), result)
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'APPLIED_AND_VERIFIED') process.exitCode = 2
  return result
}

if (require.main === module) {
  main().catch(error => {
    if (error && error.code === 'WAITING_FOR_CLOUDBASE_CREDENTIALS') {
      console.error('WAITING_FOR_CLOUDBASE_CREDENTIALS')
    } else {
      console.error('[training-content-migration] failed:', error.message)
      if (Array.isArray(error.details)) console.error(error.details.join('\n'))
    }
    process.exitCode = 1
  })
}

module.exports = {
  assertRecordUnchanged,
  assertSubmissionReferenceUnchanged,
  buildCloudVerification,
  buildMigrationPlan,
  buildSubmissionReferencePlan,
  buildRollbackPlan,
  createCanonicalIndexes,
  isPermanentContentId,
  migrationPlanSignature,
  matchLegacyRecord,
  parseArgs,
  recordConcurrencyFingerprint,
  submissionPlanSignature,
  submissionReferenceFingerprint,
  submissionSourceSignature,
  sameCanonicalCore,
  validateCanonical,
  verifyCanonicalPresence
}
