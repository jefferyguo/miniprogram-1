#!/usr/bin/env node

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'resources', 'training-source', '0728-final')
const IMPORT_DIR = path.join(ROOT, 'data', 'import', '0728-final')
const SOURCE_MANIFEST_PATH = path.join(SOURCE_DIR, 'source-manifest.json')
const ID_MANIFEST_PATH = path.join(IMPORT_DIR, 'training-content-id-manifest.json')
const CANONICAL_PATH = path.join(IMPORT_DIR, 'canonical-training-contents.json')
const PROJECT_CONFIG_PATH = path.join(ROOT, 'project.config.json')
const PERMANENT_ID = /^tc_[0-9a-f]{32}$/
const EXPECTED_COUNTS = {
  topic: 276,
  reading: 216,
  leaderSpeech: 24,
  retell: 257,
  speech: 116,
  mandarin: 77
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function assertSources(sourceManifest) {
  assert.equal(sourceManifest.modules.length, 6, '必须锁定六个源文件')
  for (const source of sourceManifest.modules) {
    const file = path.join(SOURCE_DIR, source.file)
    assert.ok(fs.existsSync(file), `${source.moduleId}: 源文件不存在`)
    assert.equal(sha256(fs.readFileSync(file)), source.sha256, `${source.moduleId}: 源文件哈希不一致`)
    assert.equal(source.physicalCount, EXPECTED_COUNTS[source.moduleId], `${source.moduleId}: 物理记录数不一致`)
  }
}

function assertCanonical(records, idManifest) {
  assert.equal(records.length, 966, 'CANONICAL_TOTAL 必须为 966')
  assert.equal(Object.keys(idManifest.articles || {}).length, 966, 'MANIFEST_TOTAL 必须为 966')
  const ids = new Set()
  const positions = new Set()
  const counts = {}

  for (const record of records) {
    assert.match(record.contentId, PERMANENT_ID, `${record.contentId}: 永久 ID 格式错误`)
    assert.ok(!ids.has(record.contentId), `${record.contentId}: contentId 重复`)
    ids.add(record.contentId)
    assert.ok(idManifest.articles[record.contentId], `${record.contentId}: manifest 缺失`)
    assert.ok(EXPECTED_COUNTS[record.moduleId], `${record.contentId}: moduleId 不正确`)
    assert.ok(Number.isInteger(record.day) && record.day > 0, `${record.contentId}: day 不正确`)
    assert.equal(record.sortOrder, record.day, `${record.contentId}: sortOrder 必须等于 day`)
    const positionKey = `${record.moduleId}:${record.day}`
    assert.ok(!positions.has(positionKey), `${positionKey}: 模块 Day 重复`)
    positions.add(positionKey)
    assert.ok(String(record.title || '').trim(), `${record.contentId}: 标题为空`)
    assert.ok(String(record.content || '').trim(), `${record.contentId}: 正文为空`)
    assert.equal(record.status, 'active', `${record.contentId}: status 必须为 active`)
    assert.ok(Number(record.contentVersion) >= 1, `${record.contentId}: contentVersion 无效`)
    assert.equal(record.titleHash, sha256(Buffer.from(record.title, 'utf8')), `${record.contentId}: titleHash 错误`)
    assert.equal(record.contentHash, sha256(Buffer.from(record.content, 'utf8')), `${record.contentId}: contentHash 错误`)
    for (const forbidden of ['sourceContentId', 'legacyContentId', 'legacyContentIds', 'oldContentId', 'newContentId']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(record, forbidden), `${record.contentId}: 含运行时禁用字段 ${forbidden}`)
    }
    counts[record.moduleId] = (counts[record.moduleId] || 0) + 1
  }

  assert.deepEqual(counts, EXPECTED_COUNTS, '模块计数不一致')
  for (const [moduleId, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
    const rows = records.filter(item => item.moduleId === moduleId).sort((a, b) => a.day - b.day)
    assert.equal(rows.length, expectedCount)
    rows.forEach((item, index) => assert.equal(item.day, index + 1, `${moduleId}: Day 不连续`))
  }

  const readingDay5 = records.find(item => item.moduleId === 'reading' && item.day === 5)
  assert.ok(readingDay5, 'reading Day 5 不存在')
  assert.equal(readingDay5.title, '每日练嘴：别让“我不配”，拖垮你的人生')
  assert.ok(readingDay5.content.length > 100, 'reading Day 5 正文异常')
}

function assertLightweightIndex(records) {
  const { generatedTrainingDays, generatedTrainingMeta } = require('../utils/generated-training-data')
  assert.equal(generatedTrainingMeta.totalCount, records.length)
  for (const [moduleId, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
    const rows = generatedTrainingDays[moduleId] || []
    assert.equal(rows.length, expectedCount, `${moduleId}: 轻量目录数量不一致`)
    rows.forEach((item, index) => {
      assert.deepEqual(
        Object.keys(item).filter(key => ['content', 'material', 'richContentHtml', 'sourceDay', 'sourceIndex'].includes(key)),
        [],
        `${item.contentId}: 轻量目录打入了正文或源位置字段`
      )
      assert.match(item.contentId, PERMANENT_ID)
      assert.equal(item.day, index + 1)
      assert.equal(item.sortOrder, item.day)
    })
  }

  const runtimeRoots = ['pages', 'utils', 'components']
  for (const rootName of runtimeRoots) {
    const stack = [path.join(ROOT, rootName)]
    while (stack.length) {
      const current = stack.pop()
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(file)
        else if (/\.(js|json|wxml)$/.test(entry.name)) {
          const text = fs.readFileSync(file, 'utf8')
          assert.ok(!text.includes('canonical-training-contents.json'), `${path.relative(ROOT, file)}: 运行时导入 canonical`)
        }
      }
    }
  }
}

function assertPackageExclusions(sourceManifest) {
  const projectConfig = readJson(PROJECT_CONFIG_PATH)
  const ignored = new Set((projectConfig.packOptions && projectConfig.packOptions.ignore || []).map(item => item.value))
  for (const folder of ['resources/training-source', 'scripts', 'data/import', 'data/backup', 'data/audit', 'cloudfunctions', 'reports']) {
    assert.ok(ignored.has(folder), `${folder}: 未排除出客户端包`)
  }
  sourceManifest.modules.forEach(source => assert.ok(ignored.has(source.file), `${source.file}: 根目录 DOCX 未排除`))
}

function main() {
  const sourceManifest = readJson(SOURCE_MANIFEST_PATH)
  const idManifest = readJson(ID_MANIFEST_PATH)
  const records = readJson(CANONICAL_PATH)
  assertSources(sourceManifest)
  assertCanonical(records, idManifest)
  assertLightweightIndex(records)
  assertPackageExclusions(sourceManifest)
  console.log(JSON.stringify({
    success: true,
    sourceFileCount: 6,
    canonicalTotal: records.length,
    permanentContentIdCount: new Set(records.map(item => item.contentId)).size,
    counts: EXPECTED_COUNTS,
    readingDay5: records.find(item => item.moduleId === 'reading' && item.day === 5).contentId,
    localFullContentBundleCount: 0
  }, null, 2))
}

main()
