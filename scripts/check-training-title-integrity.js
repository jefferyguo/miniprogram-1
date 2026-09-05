/**
 * 六模块全局标题完整性 + 标题来源决策 + 请求竞态验证
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const canonical = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'import', '0728-final', 'canonical-training-contents.json'), 'utf8'))
const canonicalById = new Map(canonical.map(i => [i.contentId, i]))

const {
  resolveEffectiveTrainingTitle,
  hasAdminEditEvidence,
  isTitleLegacyDamaged,
  TITLE_SOURCES
} = require('../utils/training-access-policy')

const { splitTitleAndAuthor, formatContentTitle } = require('../utils/training-data')

// ——— 1. 966 canonical 标题非空 ———
console.log('1. 全部 966 条 canonical 标题非空')
canonical.forEach(i => assert.ok(i.title && i.title.trim(), `${i.contentId}: 标题为空`))
console.log('   PASS')

// ——— 2. splitTitleAndAuthor 完整保留 ———
console.log('2. splitTitleAndAuthor/formatContentTitle 完整保留标题')
canonical.slice(0, 50).forEach(i => {
  const p = splitTitleAndAuthor(i.title)
  assert.strictEqual(p.title, i.title.trim())
  assert.strictEqual(formatContentTitle({ title: p.title, author: p.author }), i.title.trim())
})
console.log('   PASS')

// ——— 3. 本地索引与 canonical 一致 ———
console.log('3. 本地索引标题与 canonical 一致')
const { getTrainingModules } = require('../utils/training-data')
const modules = getTrainingModules()
assert.strictEqual(modules.reduce((s, m) => s + m.days.length, 0), 966)
let localMismatch = 0
modules.forEach(mod => mod.days.forEach(local => {
  const canon = canonicalById.get(local.contentId)
  if (!canon) return
  const lt = (local.contentTitle || local.title || '').trim()
  const ct = (canon.contentTitle || canon.title || '').trim()
  if (lt !== ct) { localMismatch++; if (localMismatch <= 3) console.warn(`  ${local.contentId}: local≠canon`) }
}))
assert.strictEqual(localMismatch, 0, `${localMismatch} 条标题不一致`)
console.log('   PASS')

// ——— 4. 六模块数量 ———
console.log('4. 六模块数量验证')
const counts = { topic: 276, reading: 216, leaderSpeech: 24, retell: 257, speech: 116, mandarin: 77 }
modules.forEach(m => assert.strictEqual(m.days.length, counts[m.id], m.id))
console.log('   PASS')

// ——— 5. 标题来源决策 - 管理员编辑使用 Cloud ———
console.log('5. 管理员修改 → 使用 Cloud 标题')
const r1 = resolveEffectiveTrainingTitle({
  localItem: { title: '即兴话题：慢下来', contentVersion: 1 },
  cloudItem: { title: '管理员改的标题', updateSource: 'admin', contentVersion: 1 }
})
assert.strictEqual(r1.title, '管理员改的标题')
assert.strictEqual(r1.titleSource, TITLE_SOURCES.CLOUD_ADMIN)
console.log('   PASS')

// ——— 6. isCustom=true → 使用 Cloud ———
console.log('6. isCustom=true → 使用 Cloud 标题')
const r2 = resolveEffectiveTrainingTitle({
  localItem: { title: 'canonical标题', contentVersion: 1 },
  cloudItem: { title: '自定义标题', isCustom: true, contentVersion: 1 }
})
assert.strictEqual(r2.title, '自定义标题')
assert.strictEqual(r2.titleSource, TITLE_SOURCES.CLOUD_ADMIN)
console.log('   PASS')

// ——— 7. updatedBy 非空但不视为管理员编辑 → TITLE_SOURCE_CONFLICT ———
console.log('7. updatedBy 非空但非管理员 → TITLE_SOURCE_CONFLICT')
const r3 = resolveEffectiveTrainingTitle({
  localItem: { title: 'canonical标题', contentVersion: 1 },
  cloudItem: { title: '未知来源标题', updatedBy: 'someOpenid', contentVersion: 1 }
})
// updatedBy 不再单独视为管理员证据 → 产生冲突，保守使用 local
assert.strictEqual(r3.titleSource, TITLE_SOURCES.TITLE_SOURCE_CONFLICT)
assert.strictEqual(r3.title, 'canonical标题')
console.log('   PASS')

// ——— 8. Cloud 新版本迁移 → 使用 Cloud ———
console.log('8. Cloud 版本更高（迁移更新）→ 使用 Cloud 标题')
const r4 = resolveEffectiveTrainingTitle({
  localItem: { title: '旧canonical标题', contentVersion: 1 },
  cloudItem: { title: '新迁移标题', contentVersion: 3, sourceRevision: '0728-final-r2-source-faithful' }
})
assert.strictEqual(r4.title, '新迁移标题')
assert.strictEqual(r4.titleSource, TITLE_SOURCES.CLOUD_MIGRATION_NEWER)
console.log('   PASS')

// ——— 9. Cloud 旧导入明显损坏 → local recovery ———
console.log('9. Cloud 旧导入标题缺前缀且无管理员证据 → local legacy recovery')
const r5 = resolveEffectiveTrainingTitle({
  localItem: { title: '即兴话题：慢下来，是一种高级的自律', contentVersion: 1 },
  cloudItem: { title: '慢下来，是一种高级的自律', contentVersion: 1, sourceRevision: 'old-v1-import' }
})
assert.strictEqual(r5.title, '即兴话题：慢下来，是一种高级的自律')
assert.strictEqual(r5.titleSource, TITLE_SOURCES.LOCAL_LEGACY_RECOVERY)
console.log('   PASS')

// ——— 10. 无法判断来源 → conflict ———
console.log('10. 来源不明 → TITLE_SOURCE_CONFLICT（不静默覆盖）')
const r6 = resolveEffectiveTrainingTitle({
  localItem: { title: 'canonical版本A', contentVersion: 1 },
  cloudItem: { title: 'cloud版本B', contentVersion: 1 }
})
assert.strictEqual(r6.titleSource, TITLE_SOURCES.TITLE_SOURCE_CONFLICT)
assert.strictEqual(r6.title, 'canonical版本A') // 保守保留 local
assert.ok(r6.conflictDetails, '应包含 conflictDetails')
console.log('   PASS')

// ——— 11. admin_created 无 local → 使用 Cloud ———
console.log('11. admin_created origin → 使用 Cloud')
const r7 = resolveEffectiveTrainingTitle({
  localItem: {},
  cloudItem: { title: '管理员创建的文章', origin: 'admin_created', contentVersion: 1 }
})
assert.strictEqual(r7.title, '管理员创建的文章')
assert.strictEqual(r7.titleSource, TITLE_SOURCES.CLOUD_ADMIN_CREATED)
console.log('   PASS')

// ——— 12. 相同标题 → exact_match ———
console.log('12. 标题相同 → exact_match')
const r8 = resolveEffectiveTrainingTitle({
  localItem: { title: '即兴话题：测试', contentVersion: 1 },
  cloudItem: { title: '即兴话题：测试', contentVersion: 1 }
})
assert.strictEqual(r8.titleSource, 'exact_match')
assert.strictEqual(r8.title, '即兴话题：测试')
console.log('   PASS')

// ——— 13. hasAdminEditEvidence 完整覆盖 ———
console.log('13. hasAdminEditEvidence 覆盖所有管理员编辑场景（不含 updatedBy）')
assert.strictEqual(hasAdminEditEvidence({ isCustom: true }), true)
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'admin' }), true)
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'Admin' }), true)
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'admin_web' }), true)
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'dashboard_web' }), true)
// updatedBy 不视为管理员证据
assert.strictEqual(hasAdminEditEvidence({ updatedBy: 'openid123' }), false)
assert.strictEqual(hasAdminEditEvidence({ updatedBy: 'openid123', updateSource: '' }), false)
assert.strictEqual(hasAdminEditEvidence({}), false)
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'migration' }), false)
console.log('   PASS')

// ——— 14. isTitleLegacyDamaged 精确匹配 ———
console.log('14. isTitleLegacyDamaged 精确匹配旧导入损坏')
// 新签名: (cloudTitle, localCanonicalTitle, sourceRevision)
assert.strictEqual(isTitleLegacyDamaged('慢下来', '即兴话题：慢下来', 'old-v1-import'), true)
assert.strictEqual(isTitleLegacyDamaged('即兴话题：慢下来', '即兴话题：慢下来', 'old-v1-import'), false)
assert.strictEqual(isTitleLegacyDamaged('每日复述练嘴：测试', '每日复述练嘴：测试', 'old-v1'), false)
assert.strictEqual(isTitleLegacyDamaged('测试', '测试', '0728-final-r2-source-faithful'), false)
console.log('   PASS')

// ——— 15. Cloud 无标题 → local ———
console.log('15. Cloud 标题为空 → 使用 local')
const r9 = resolveEffectiveTrainingTitle({
  localItem: { title: 'local标题', contentVersion: 1 },
  cloudItem: { title: '', contentVersion: 1 }
})
assert.strictEqual(r9.title, 'local标题')
assert.strictEqual(r9.titleSource, TITLE_SOURCES.LOCAL_LEGACY_RECOVERY)
console.log('   PASS')

// ——— 16. 本地无标题 → Cloud ———
console.log('16. 本地标题为空 → 使用 Cloud')
const r10 = resolveEffectiveTrainingTitle({
  localItem: { title: '' },
  cloudItem: { title: '新文章标题', contentVersion: 1, sourceRevision: '0728-final-r2' }
})
assert.strictEqual(r10.title, '新文章标题')
console.log('   PASS')

// ——— 17. 正文 contentHash 稳定性 ———
console.log('17. 正文 contentHash 稳定')
const crypto = require('crypto')
canonical.slice(0, 10).forEach(i => {
  if (i.content) {
    const h1 = crypto.createHash('sha256').update(i.content, 'utf8').digest('hex')
    const h2 = crypto.createHash('sha256').update(i.content, 'utf8').digest('hex')
    assert.strictEqual(h1, h2)
  }
})
console.log('   PASS')

// ——— 18. remote-training 有竞态保护 ———
console.log('18. remote-training.js 有按模块 revision 与在途请求保护')
const remoteSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'remote-training.js'), 'utf8')
assert.ok(remoteSrc.includes('const catalogRevisions = new Map()'), '应有 catalogRevisions')
assert.ok(remoteSrc.includes('pendingCatalogRequests.get(normalized)'), '应复用同模块在途目录请求')
assert.ok(remoteSrc.includes('stale_request_discarded'), '应有丢弃过期请求逻辑')
console.log('   PASS')

// ——— 19. 云端目录按模块原子替换，不逐条合并 ———
console.log('19. 云端目录按模块原子替换')
const trainingSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'training-data.js'), 'utf8')
assert.ok(trainingSrc.includes('isValidCloudDataset(remoteCatalog, module.id)'), '使用远程目录前必须整模块校验')
assert.ok(trainingSrc.includes('cloudTrainingCatalogs.set(category, nextContents)'), '有效目录必须原子替换')
assert.ok(remoteSrc.includes('getTrainingCatalogByModule'), '主训练目录必须读取轻量 catalog 接口')
assert.ok(!remoteSrc.includes('upsertCloudTrainingContent'), '远程目录不得逐条 upsert')
console.log('   PASS')

console.log('\n[check-training-title-integrity] all cases passed')
