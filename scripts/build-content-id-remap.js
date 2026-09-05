#!/usr/bin/env node
/**
 * 训练内容 contentId 旧→新映射生成工具
 *
 * 从旧 canonical（或云端 dry-run 数据）与新 canonical 对比，
 * 按标题+正文哈希精确匹配同一篇文章，输出旧 contentId → 新 contentId 映射。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const NEW_CANONICAL = path.join(ROOT, 'data', 'import', '0728-final', 'canonical-training-contents.json')
const REPORTS_DIR = path.join(ROOT, 'reports')

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex')
}

function articleKey(item) {
  const mod = String(item.category || item.moduleId || '').trim()
  const title = String(item.title || '').trim()
  const content = String(item.content || item.material || item.promptText || '').trim()
  return `${mod}::${sha256(title + '\0' + content)}`
}

function normalizeCategory(v) {
  const c = String(v || '').trim()
  return c === 'retelling' ? 'retell' : c
}

function main() {
  const args = process.argv.slice(2)
  const oldPath = args[0]
  if (!oldPath) {
    console.error('用法: node scripts/build-content-id-remap.js <old-canonical.json | old-cloud-dry-run.json>')
    console.error('old-canonical.json 来自 git 历史或云端 dry-run 导出的旧数据')
    process.exit(1)
  }

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'))
  const newData = JSON.parse(fs.readFileSync(NEW_CANONICAL, 'utf8'))
  const oldItems = Array.isArray(oldData) ? oldData : (oldData.contents || oldData.data || [])

  // Build lookup by article key
  const oldByKey = new Map()
  oldItems.forEach(item => {
    const key = articleKey(item)
    if (!oldByKey.has(key)) oldByKey.set(key, [])
    oldByKey.get(key).push(item)
  })

  const newByKey = new Map()
  newData.forEach(item => {
    const key = articleKey(item)
    if (!newByKey.has(key)) newByKey.set(key, [])
    newByKey.get(key).push(item)
  })

  const remap = []
  const unchanged = []
  const ambiguous = []
  const missing = []

  newData.forEach(newItem => {
    const key = articleKey(newItem)
    const oldMatches = oldByKey.get(key) || []

    if (oldMatches.length === 0) {
      missing.push({
        moduleId: newItem.moduleId || newItem.category,
        newContentId: newItem.contentId,
        day: newItem.day,
        title: (newItem.title || '').slice(0, 60)
      })
      return
    }

    const oldItem = oldMatches[0]
    const newCid = String(newItem.contentId || '').trim()
    const oldCid = String(oldItem.contentId || '').trim()
    const canonicalNewCid = `${normalizeCategory(newItem.category || newItem.moduleId)}-day-${newItem.day}`

    if (oldCid === newCid) {
      unchanged.push({ moduleId: newItem.moduleId || newItem.category, contentId: newCid, day: newItem.day })
      return
    }

    if (oldMatches.length > 1) {
      ambiguous.push({
        moduleId: newItem.moduleId || newItem.category,
        newContentId: newCid,
        day: newItem.day,
        oldCandidates: oldMatches.map(m => m.contentId),
        title: (newItem.title || '').slice(0, 60)
      })
      return
    }

    remap.push({
      moduleId: newItem.moduleId || newItem.category,
      title: (newItem.title || '').slice(0, 60),
      oldContentId: oldCid,
      oldDay: Number(oldItem.day || oldItem.sourceIndex || 0),
      newContentId: newCid,
      newDay: newItem.day,
      canonicalContentId: canonicalNewCid,
      contentIdMatchesCanonical: newCid === canonicalNewCid
    })
  })

  // Count by module
  const modules = {}
  remap.forEach(r => {
    if (!modules[r.moduleId]) modules[r.moduleId] = 0
    modules[r.moduleId]++
  })

  console.log('=== 旧 ID → 新 ID 映射报告 ===')
  console.log(`OLD_TO_NEW_ID_MAPPING_COUNT: ${remap.length}`)
  console.log(`UNCHANGED_ID_COUNT: ${unchanged.length}`)
  console.log(`AMBIGUOUS_MAPPING_COUNT: ${ambiguous.length}`)
  console.log(`MISSING_MAPPING_COUNT: ${missing.length}`)
  console.log('')
  console.log('按模块分布:')
  Object.entries(modules).sort().forEach(([mod, count]) => {
    console.log(`  ${mod}: ${count}`)
  })

  if (remap.length > 0) {
    console.log(`\n=== 映射样例（前 10 条）===`)
    remap.slice(0, 10).forEach(r => {
      console.log(`  ${r.oldContentId} → ${r.newContentId} (day ${r.newDay}, "${r.title}")`)
    })
  }

  if (ambiguous.length > 0) {
    console.log(`\n=== 歧义记录 (${ambiguous.length} 条) ===`)
    ambiguous.slice(0, 5).forEach(a => {
      console.log(`  ${a.moduleId} day=${a.day}: ${a.newContentId} ← candidates: ${a.oldCandidates.join(', ')}`)
    })
  }

  if (missing.length > 0) {
    console.log(`\n=== 新文章（旧数据中不存在）(${missing.length} 条) ===`)
    missing.slice(0, 5).forEach(m => {
      console.log(`  ${m.moduleId} ${m.newContentId} day=${m.day}: "${m.title}"`)
    })
  }

  // Write report
  fs.mkdirSync(REPORTS_DIR, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    oldDataSource: oldPath,
    newDataSource: NEW_CANONICAL,
    oldToNewMappingCount: remap.length,
    unchangedIdCount: unchanged.length,
    ambiguousMappingCount: ambiguous.length,
    missingMappingCount: missing.length,
    moduleBreakdown: modules,
    remap: remap.slice(0, 500),
    ambiguous: ambiguous.slice(0, 100),
    missing: missing.slice(0, 100)
  }
  const jsonPath = path.join(REPORTS_DIR, 'training-content-id-remap.json')
  const mdPath = path.join(REPORTS_DIR, 'training-content-id-remap.md')
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')

  let md = `# 训练内容 contentId 旧→新映射报告\n\n`
  md += `生成时间: ${report.generatedAt}\n\n`
  md += `| 指标 | 数量 |\n|------|------|\n`
  md += `| OLD_TO_NEW_ID_MAPPING_COUNT | ${remap.length} |\n`
  md += `| UNCHANGED_ID_COUNT | ${unchanged.length} |\n`
  md += `| AMBIGUOUS_MAPPING_COUNT | ${ambiguous.length} |\n`
  md += `| MISSING_MAPPING_COUNT | ${missing.length} |\n\n`
  md += `## 按模块分布\n\n`
  Object.entries(modules).sort().forEach(([mod, count]) => {
    md += `- ${mod}: ${count}\n`
  })
  fs.writeFileSync(mdPath, md, 'utf8')

  console.log(`\n报告已保存: ${jsonPath}`)
  console.log(`报告已保存: ${mdPath}`)

  return { remap: remap.length, unchanged: unchanged.length, ambiguous: ambiguous.length, missing: missing.length }
}

const result = main()
if (result.ambiguous > 0) {
  console.error('\n⚠️  存在歧义映射，必须手动处理后再执行迁移')
  process.exit(1)
}
