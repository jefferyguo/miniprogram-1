#!/usr/bin/env node

/**
 * 将朗诵、复述、演讲三类训练完整同步到 CloudBase trainingContents。
 * 默认只做 dry-run；正式写入必须显式传入 --apply，并提供云开发密钥。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT_DIR = path.resolve(__dirname, '..')
const ENV_ID = process.env.CLOUDBASE_ENV || 'cloud1-d0geb9qt9d29ee6fc'
const SECRET_ID = process.env.CLOUDBASE_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID
const SECRET_KEY = process.env.CLOUDBASE_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY
const BATCH_SIZE = Math.max(10, Math.min(25, Number(process.env.IMPORT_BATCH_SIZE || 20)))
const APPLY = process.argv.includes('--apply')
const IMPORT_FILE = path.join(ROOT_DIR, 'data', 'import', 'yangqin_training_v4_all.json')
const BACKUP_DIR = path.join(ROOT_DIR, 'data', 'backup')
const COLLECTION = 'trainingContents'
const IMPORT_VERSION = 'v4'
const TARGETS = {
  reading: { expectedCount: 214, categoryName: '朗读训练' },
  retelling: { expectedCount: 255, categoryName: '复述训练' },
  speech: { expectedCount: 111, categoryName: '演讲训练' }
}

function loadCloudbaseSdk() {
  try {
    return require('@cloudbase/node-sdk')
  } catch (error) {
    throw new Error('缺少 @cloudbase/node-sdk，请先在本机安装后再执行正式导入。')
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function now() {
  return new Date().toISOString()
}

function timestamp() {
  const compact = now().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${compact.slice(0, 8)}-${compact.slice(8)}`
}

function getVersionedContentId(category, day) {
  return `${category}-${IMPORT_VERSION}-day-${day}`
}

function isActiveItem(item = {}) {
  return ['published', 'active'].includes(String(item.status || '')) &&
    item.active !== false &&
    item.visible !== false
}

function normalizeItem(item, category, index) {
  const day = Number(item.day || item.dayNumber || index + 1)
  const expectedSourceContentId = `${category}-day-${day}`
  const sourceContentId = cleanText(item.contentId || expectedSourceContentId)
  const contentId = getVersionedContentId(category, day)
  const title = cleanText(item.title || item.contentTitle)
  const content = cleanText(item.content || item.material || item.promptText)

  if (!Number.isInteger(day) || day !== index + 1) {
    throw new Error(`${category} 第 ${index + 1} 条 day 不连续`)
  }
  if (sourceContentId !== expectedSourceContentId) {
    throw new Error(`${category} Day ${day} 源 contentId 应为 ${expectedSourceContentId}，当前为 ${sourceContentId}`)
  }
  if (!title) throw new Error(`${category} Day ${day} 标题不能为空`)
  if (!content) throw new Error(`${category} Day ${day} 正文不能为空`)

  return {
    contentId,
    sourceContentId,
    contentVersion: IMPORT_VERSION,
    category,
    categoryName: TARGETS[category].categoryName,
    day,
    dayNumber: day,
    sortOrder: day,
    title,
    author: cleanText(item.author),
    articleCategory: cleanText(item.articleCategory),
    content,
    material: content,
    promptText: content,
    quote: cleanText(item.quote),
    isCustom: false,
    membershipLevel: day <= 21 ? 'free' : 'member',
    active: true,
    status: 'published',
    visible: true
  }
}

function validateItems(items, category) {
  const expectedCount = TARGETS[category].expectedCount
  if (!Array.isArray(items) || items.length !== expectedCount) {
    throw new Error(`${category} 数量应为 ${expectedCount}，当前为 ${Array.isArray(items) ? items.length : 0}`)
  }

  const normalized = items.map((item, index) => normalizeItem(item, category, index))
  const ids = new Set()
  normalized.forEach(item => {
    if (ids.has(item.contentId)) throw new Error(`${category} 存在重复 contentId：${item.contentId}`)
    ids.add(item.contentId)
  })
  return normalized
}

function summarizeItems(items) {
  const lengths = items.map(item => item.content.length)
  return {
    count: items.length,
    first: items[0] && items[0].title,
    middle: items[Math.floor(items.length / 2)] && items[Math.floor(items.length / 2)].title,
    last: items[items.length - 1] && items[items.length - 1].title,
    minContentLength: Math.min(...lengths),
    maxContentLength: Math.max(...lengths),
    emptyTitles: items.filter(item => !item.title).length,
    emptyContents: items.filter(item => !item.content).length
  }
}

async function runInChunks(items, worker) {
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const chunk = items.slice(index, index + BATCH_SIZE)
    await Promise.all(chunk.map(worker))
    console.log(`[import] 已处理 ${Math.min(index + chunk.length, items.length)} / ${items.length}`)
  }
}

async function fetchAll(queryFactory) {
  const pageSize = 100
  const result = []
  for (let offset = 0; ; offset += pageSize) {
    const response = await queryFactory().skip(offset).limit(pageSize).get()
    const rows = response.data || []
    result.push(...rows)
    if (rows.length < pageSize) break
  }
  return result
}

async function fetchExisting(collection, category) {
  return fetchAll(() => collection.where({ category }))
}

function countByCategory(items, activeOnly = false) {
  return items.reduce((result, item) => {
    if (activeOnly && !isActiveItem(item)) return result
    const category = item.category || 'unknown'
    result[category] = (result[category] || 0) + 1
    return result
  }, {})
}

function countArchivedByCategory(items) {
  return items.reduce((result, item) => {
    if (item.status !== 'archived' && item.active !== false) return result
    const category = item.category || 'unknown'
    result[category] = (result[category] || 0) + 1
    return result
  }, {})
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key])
    return result
  }, {})
}

function rowsFingerprint(items) {
  const rows = items
    .slice()
    .sort((a, b) => String(a._id || '').localeCompare(String(b._id || '')))
    .map(stableValue)
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function buildCloudSamples(rows, data) {
  const sampleDays = {
    reading: [1, 108, 214],
    retelling: [1, 128, 255],
    speech: [1, 56, 111]
  }
  const active = []

  Object.entries(sampleDays).forEach(([category, days]) => {
    days.forEach(day => {
      const expected = data[category][day - 1]
      const item = rows.find(row => row.contentId === expected.contentId && isActiveItem(row))
      if (!item) throw new Error(`${category} Day ${day} 云端 active 抽查记录缺失`)
      const body = cleanText(item.content || item.material || item.promptText)
      if (item.title !== expected.title || body !== expected.content || Number(item.day || item.dayNumber) !== day) {
        throw new Error(`${category} Day ${day} 云端内容与生成 JSON 不一致`)
      }
      active.push({
        _id: item._id,
        contentId: item.contentId,
        category,
        day,
        title: item.title,
        contentLength: body.length,
        contentStart: body.slice(0, 50),
        contentEnd: body.slice(-50),
        active: item.active !== false,
        status: item.status
      })
    })
  })

  const archived = rows
    .filter(item => Object.prototype.hasOwnProperty.call(TARGETS, item.category))
    .filter(item => item.status === 'archived' && item.active === false)
    .filter(item => item.contentId)
    .slice(0, 3)
    .map(item => ({
      _id: item._id,
      contentId: item.contentId,
      category: item.category,
      day: Number(item.day || item.dayNumber || 0),
      title: item.title || '',
      status: item.status,
      active: item.active
    }))

  return { active, archived }
}

async function addDoc(collection, data) {
  try {
    return await collection.add(data)
  } catch (error) {
    if (/invalid|argument|param|data/i.test(String(error && error.message || error))) {
      return collection.add({ data })
    }
    throw error
  }
}

async function updateDoc(collection, id, data) {
  try {
    return await collection.doc(id).update(data)
  } catch (error) {
    if (/invalid|argument|param|data/i.test(String(error && error.message || error))) {
      return collection.doc(id).update({ data })
    }
    throw error
  }
}

function planCategoryImport(existing, items) {
  const incomingIds = new Set(items.map(item => item.contentId))
  const existingByContentId = new Map()

  existing.forEach(item => {
    if (!item.contentId) return
    const list = existingByContentId.get(item.contentId) || []
    list.push(item)
    existingByContentId.set(item.contentId, list)
  })

  const canonicalByContentId = new Map()
  existingByContentId.forEach((rows, contentId) => {
    const sorted = rows.slice().sort((a, b) => {
      const activeDiff = Number(isActiveItem(b)) - Number(isActiveItem(a))
      if (activeDiff) return activeDiff
      return String(a._id || '').localeCompare(String(b._id || ''))
    })
    canonicalByContentId.set(contentId, sorted[0])
  })

  const upserts = items.map(item => ({ item, old: canonicalByContentId.get(item.contentId) || null }))
  const archive = existing.filter(item => {
    if (!item._id) return false
    const isCanonicalIncoming = item.contentId &&
      incomingIds.has(item.contentId) &&
      canonicalByContentId.get(item.contentId) &&
      canonicalByContentId.get(item.contentId)._id === item._id
    if (isCanonicalIncoming) return false
    return item.status !== 'archived' || item.active !== false || item.visible !== false
  })

  return { upserts, archive }
}

async function importCategory(collection, category, items) {
  const existing = await fetchExisting(collection, category)
  const plan = planCategoryImport(existing, items)
  const summary = { incoming: items.length, created: 0, updated: 0, archived: 0 }

  await runInChunks(plan.upserts, async entry => {
    const { item, old } = entry
    const payload = { ...item, updatedAt: now(), updatedBy: 'local_training_v4_import' }
    if (old && old._id) {
      await updateDoc(collection, old._id, payload)
      summary.updated += 1
    } else {
      await addDoc(collection, {
        ...payload,
        createdAt: now(),
        createdBy: 'local_training_v4_import'
      })
      summary.created += 1
    }
  })

  await runInChunks(plan.archive, async item => {
    await updateDoc(collection, item._id, {
      active: false,
      status: 'archived',
      visible: false,
      archivedAt: item.archivedAt || now(),
      archivedBy: item.archivedBy || 'local_training_v4_import',
      updatedAt: now(),
      updatedBy: 'local_training_v4_import'
    })
    summary.archived += 1
  })

  return summary
}

function assertOtherCategoriesUnchanged(beforeCounts, afterCounts) {
  const targetNames = new Set(Object.keys(TARGETS))
  const categories = new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)])
  categories.forEach(category => {
    if (targetNames.has(category)) return
    if (Number(beforeCounts[category] || 0) !== Number(afterCounts[category] || 0)) {
      throw new Error(`其他分类 ${category} 数量发生变化：${beforeCounts[category] || 0} -> ${afterCounts[category] || 0}`)
    }
  })
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'))
  const data = Object.keys(TARGETS).reduce((result, category) => {
    result[category] = validateItems(raw[category], category)
    return result
  }, {})

  console.log('[import] 本地数据校验通过', {
    env: ENV_ID,
    apply: APPLY,
    categories: Object.fromEntries(Object.entries(data).map(([category, items]) => [category, summarizeItems(items)]))
  })

  if (!APPLY) {
    console.log('[import] dry-run 完成：未连接 CloudBase，未写入 trainingContents。正式导入需显式添加 --apply。')
    return
  }
  if (!SECRET_ID || !SECRET_KEY) {
    throw new Error('缺少云开发密钥。请设置 CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY。')
  }

  const cloudbase = loadCloudbaseSdk()
  const app = cloudbase.init({ env: ENV_ID, secretId: SECRET_ID, secretKey: SECRET_KEY })
  const collection = app.database().collection(COLLECTION)
  const beforeAll = await fetchAll(() => collection)
  const beforeCounts = countByCategory(beforeAll, true)
  const beforeOtherRows = beforeAll.filter(item => !Object.prototype.hasOwnProperty.call(TARGETS, item.category))
  const beforeOtherFingerprint = rowsFingerprint(beforeOtherRows)
  const backupRows = beforeAll.filter(item => Object.prototype.hasOwnProperty.call(TARGETS, item.category))
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = path.join(BACKUP_DIR, `trainingContents-before-v4-${timestamp()}.json`)
  fs.writeFileSync(backupPath, JSON.stringify(backupRows, null, 2), 'utf8')
  const verifiedBackup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  if (!Array.isArray(verifiedBackup) || verifiedBackup.length !== backupRows.length) {
    throw new Error('云端备份 JSON 回读校验失败')
  }
  console.log('[import] 云端备份完成', { backupPath, rows: backupRows.length, beforeCounts })

  const importSummary = {}
  for (const [category, items] of Object.entries(data)) {
    importSummary[category] = await importCategory(collection, category, items)
  }

  const afterAll = await fetchAll(() => collection)
  const afterCounts = countByCategory(afterAll, true)
  const archivedCounts = countArchivedByCategory(afterAll)
  const afterOtherRows = afterAll.filter(item => !Object.prototype.hasOwnProperty.call(TARGETS, item.category))
  const afterOtherFingerprint = rowsFingerprint(afterOtherRows)
  Object.entries(TARGETS).forEach(([category, config]) => {
    if (Number(afterCounts[category] || 0) !== config.expectedCount) {
      throw new Error(`${category} 导入后数量错误：${afterCounts[category] || 0}，预期 ${config.expectedCount}`)
    }
  })
  assertOtherCategoriesUnchanged(beforeCounts, afterCounts)
  if (beforeOtherFingerprint !== afterOtherFingerprint) {
    throw new Error('其他训练分类原始字段或文档 ID 发生变化')
  }

  const idempotencyPlan = Object.fromEntries(Object.entries(data).map(([category, items]) => {
    const existing = afterAll.filter(item => item.category === category)
    const plan = planCategoryImport(existing, items)
    return [category, {
      wouldCreate: plan.upserts.filter(entry => !entry.old).length,
      wouldUpdate: plan.upserts.filter(entry => entry.old).length,
      wouldArchive: plan.archive.length
    }]
  }))
  Object.entries(idempotencyPlan).forEach(([category, plan]) => {
    if (plan.wouldCreate || plan.wouldArchive) {
      throw new Error(`${category} 幂等校验失败：${JSON.stringify(plan)}`)
    }
  })
  const cloudSamples = buildCloudSamples(afterAll, data)
  const legacyBackupRows = backupRows.filter(item => item.contentVersion !== IMPORT_VERSION && !/-v4-day-/i.test(item.contentId || ''))
  if (legacyBackupRows.length >= 3 && cloudSamples.archived.length < 3) {
    throw new Error('导入前存在旧训练记录，但 archived 抽查不足 3 条')
  }

  console.log('[import] 正式导入及回查完成', {
    backupPath,
    beforeCounts,
    afterCounts,
    archivedCounts,
    otherCategoriesFingerprint: afterOtherFingerprint,
    idempotencyPlan,
    cloudSamples,
    importSummary
  })
}

if (require.main === module) {
  main().catch(error => {
    console.error('[import] 失败:', error && (error.stack || error.message || error))
    process.exit(1)
  })
}

module.exports = {
  IMPORT_VERSION,
  countArchivedByCategory,
  countByCategory,
  buildCloudSamples,
  getVersionedContentId,
  isActiveItem,
  normalizeItem,
  planCategoryImport,
  rowsFingerprint,
  validateItems
}
