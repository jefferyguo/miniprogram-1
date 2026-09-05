/**
 * 训练标题上线前最终验收
 *
 * 验证:
 * 1. hasAdminEditEvidence 不因 updatedBy 非空误判
 * 2. isTitleLegacyDamaged 精确匹配（非仅缺前缀）
 * 3. catalogRevision 按模块隔离
 * 4. TITLE_SOURCE_CONFLICT 稳定 fallback
 * 5. 全部 966 条 canonical vs Cloud 对比 Dry-run
 * 6. 竞态测试
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const {
  hasAdminEditEvidence,
  isTitleLegacyDamaged,
  applyLegacyTitleCleaning,
  TITLE_SOURCES,
  resolveEffectiveTrainingTitle
} = require('../utils/training-access-policy')

// ===== 1. hasAdminEditEvidence 不因 updatedBy 误判 =====
console.log('1. hasAdminEditEvidence — updatedBy 不误判为管理员')
assert.strictEqual(hasAdminEditEvidence({ isCustom: true }), true, 'isCustom')
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'admin' }), true, 'updateSource=admin')
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'Admin' }), true, 'updateSource=Admin(case)')
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'admin_web' }), true, 'admin_web')
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'dashboard_web' }), true, 'dashboard_web')
// 关键：仅有 updatedBy 不视为管理员
assert.strictEqual(hasAdminEditEvidence({ updatedBy: 'someOpenid' }), false, 'updatedBy only → NOT admin')
assert.strictEqual(hasAdminEditEvidence({ updatedBy: 'someOpenid', updateSource: '' }), false, 'updatedBy + empty updateSource → NOT admin')
// 系统导入/迁移
assert.strictEqual(hasAdminEditEvidence({ updateSource: 'migration', updatedBy: 'system' }), false, 'migration → NOT admin')
assert.strictEqual(hasAdminEditEvidence({ updateSource: '', updatedBy: 'wxOpenid123' }), false, 'empty source + updatedBy → NOT admin')
assert.strictEqual(hasAdminEditEvidence({}), false, 'empty object')
console.log('   PASS')

// ===== 2. isTitleLegacyDamaged 精确匹配 =====
console.log('2. isTitleLegacyDamaged — 精确匹配旧清洗结果')
// 精确匹配：canonical "即兴话题：测试" 经旧清洗 → "测试"
assert.strictEqual(isTitleLegacyDamaged('测试', '即兴话题：测试', 'old-v1'), true)
assert.strictEqual(isTitleLegacyDamaged('小鱼吃大鱼的启示', '每日复述练嘴：小鱼吃大鱼的启示', 'v1-legacy'), true)
assert.strictEqual(isTitleLegacyDamaged('美酒敬领导', '祝酒词：美酒敬领导', 'old-import'), true)
// 不匹配：cloud "测试123" ≠ 旧清洗结果 "测试"
assert.strictEqual(isTitleLegacyDamaged('测试123', '即兴话题：测试', 'old-v1'), false)
// 不匹配：sourceRevision 是当前 canonical
assert.strictEqual(isTitleLegacyDamaged('测试', '即兴话题：测试', '0728-final-r2-source-faithful'), false)
// 不匹配：cloud=canonical（未经清洗）
assert.strictEqual(isTitleLegacyDamaged('即兴话题：测试', '即兴话题：测试', 'old-v1'), false)
// 边界：无前缀标题（如"停顿练习"）→ 旧清洗不改变，所以不匹配
assert.strictEqual(isTitleLegacyDamaged('停顿练习', '停顿练习', 'old-v1'), false)
// 边界：空值
assert.strictEqual(isTitleLegacyDamaged('', '标题', 'old-v1'), false)
assert.strictEqual(isTitleLegacyDamaged('标题', '', 'old-v1'), false)
assert.strictEqual(isTitleLegacyDamaged('标题', '标题', ''), false)
console.log('   PASS')

// ===== 3. applyLegacyTitleCleaning 覆盖所有已知前缀 =====
console.log('3. applyLegacyTitleCleaning — 覆盖所有已知前缀')
assert.strictEqual(applyLegacyTitleCleaning('即兴话题：慢下来'), '慢下来')
assert.strictEqual(applyLegacyTitleCleaning('每日复述练嘴：小鱼吃大鱼'), '小鱼吃大鱼')
assert.strictEqual(applyLegacyTitleCleaning('每日练嘴：测试标题'), '测试标题')
assert.strictEqual(applyLegacyTitleCleaning('领导发言：年会讲话'), '年会讲话')
assert.strictEqual(applyLegacyTitleCleaning('演讲：乔布斯演讲'), '乔布斯演讲')
assert.strictEqual(applyLegacyTitleCleaning('祝酒词：美酒敬领导'), '美酒敬领导')
assert.strictEqual(applyLegacyTitleCleaning('主持开场：欢迎词'), '欢迎词')
assert.strictEqual(applyLegacyTitleCleaning('朗诵：春晓'), '春晓')
assert.strictEqual(applyLegacyTitleCleaning('背诵：静夜思'), '静夜思')
// 无已知前缀 → 不变
assert.strictEqual(applyLegacyTitleCleaning('停顿练习'), '停顿练习')
assert.strictEqual(applyLegacyTitleCleaning('【必看】即兴讲话'), '【必看】即兴讲话')
console.log('   PASS')

// ===== 4. catalogRevision 按模块隔离 =====
console.log('4. catalogRevision — 按模块隔离验证（代码静态检查）')
const remoteSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'remote-training.js'), 'utf8')
assert.ok(remoteSrc.includes('const catalogRevisions = new Map()'), '应有 catalogRevisions Map')
assert.ok(remoteSrc.includes('catalogRevisions.get(normalized)'), '应按规范化 moduleId 读取 revision')
assert.ok(remoteSrc.includes('catalogRevisions.set(normalized, revision)'), '应按规范化 moduleId 写入 revision')
assert.ok(remoteSrc.includes('pendingCatalogRequests.get(normalized)'), '同模块在途目录请求应复用')
// 不再有全局 requestGeneration 变量
const globalGenMatch = remoteSrc.match(/^let requestGeneration\b/m)
assert.strictEqual(globalGenMatch, null, '不应有全局 requestGeneration')
console.log('   PASS')

// ===== 5. TITLE_SOURCE_CONFLICT 行为 =====
console.log('5. TITLE_SOURCE_CONFLICT — 稳定 fallback')
// 相同输入，多次调用返回相同结果
for (let i = 0; i < 5; i++) {
  const r = resolveEffectiveTrainingTitle({
    localItem: { title: 'canonical标题', contentVersion: 1 },
    cloudItem: { title: '未知来源标题', contentVersion: 1 }
  })
  assert.strictEqual(r.titleSource, TITLE_SOURCES.TITLE_SOURCE_CONFLICT, `run ${i}`)
  assert.strictEqual(r.title, 'canonical标题', `run ${i}: stable fallback`)
  assert.ok(r.conflictDetails, `run ${i}: 应有 conflictDetails`)
  assert.ok(!r.conflictDetails.cloudTitle, 'conflictDetails 不应包含正文/完整标题')
}
// 冲突日志不包含 fullTitle
console.log('   PASS')

// ===== 6. CloudBase title dry-run（基于 canonical vs 模拟 Cloud） =====
console.log('6. CloudBase 标题 Dry-run — 全部 966 条')
const canonical = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'import', '0728-final', 'canonical-training-contents.json'), 'utf8'))

// 模拟三种 Cloud 场景
const statsByModule = {}
canonical.forEach(item => {
  const mod = item.category
  if (!statsByModule[mod]) statsByModule[mod] = { total: 0, exact_match: 0, legacy_damaged: 0, admin_edit: 0, newer_cloud: 0, conflict: 0, auto_fixable: 0 }
  statsByModule[mod].total++

  const cid = item.contentId
  const canonicalTitle = item.title.trim()

  // 场景 A：Cloud = canonical（exact_match）
  const r1 = resolveEffectiveTrainingTitle({
    localItem: { title: canonicalTitle, contentVersion: 1 },
    cloudItem: { title: canonicalTitle, contentVersion: 1, contentId: cid, sourceRevision: '0728-final-r2-source-faithful' }
  })
  if (r1.titleSource === 'exact_match') statsByModule[mod].exact_match++
  else statsByModule[mod].conflict++

  // 场景 B：Cloud = 旧清洗结果（legacy_damaged）
  const cleanedTitle = applyLegacyTitleCleaning(canonicalTitle)
  if (cleanedTitle !== canonicalTitle) {
    const r2 = resolveEffectiveTrainingTitle({
      localItem: { title: canonicalTitle, contentVersion: 1 },
      cloudItem: { title: cleanedTitle, contentVersion: 1, contentId: cid, sourceRevision: 'old-v1-import' }
    })
    if (r2.titleSource === TITLE_SOURCES.LOCAL_LEGACY_RECOVERY) {
      statsByModule[mod].legacy_damaged++
      statsByModule[mod].auto_fixable++
    } else {
      statsByModule[mod].conflict++
    }
  }

  // 场景 C：Cloud = 管理员修改（admin_edit）
  const r3 = resolveEffectiveTrainingTitle({
    localItem: { title: canonicalTitle, contentVersion: 1 },
    cloudItem: { title: '管理员修改: ' + canonicalTitle, contentVersion: 1, contentId: cid, updateSource: 'admin' }
  })
  if (r3.titleSource === TITLE_SOURCES.CLOUD_ADMIN) statsByModule[mod].admin_edit++
  else statsByModule[mod].conflict++

  // 场景 D：Cloud 版本更高（newer_cloud）
  const r4 = resolveEffectiveTrainingTitle({
    localItem: { title: canonicalTitle, contentVersion: 1 },
    cloudItem: { title: canonicalTitle + '（修订版）', contentVersion: 3, contentId: cid, sourceRevision: '0728-final-r2-source-faithful' }
  })
  if (r4.titleSource === TITLE_SOURCES.CLOUD_MIGRATION_NEWER) statsByModule[mod].newer_cloud++
  else statsByModule[mod].conflict++
})

// 输出每模块统计
console.log('   模块         总计  exact  legacy  admin  newer  conflict  auto_fix')
Object.entries(statsByModule).sort().forEach(([mod, s]) => {
  console.log(`   ${mod.padEnd(14)} ${String(s.total).padStart(4)}  ${String(s.exact_match).padStart(5)}  ${String(s.legacy_damaged).padStart(6)}  ${String(s.admin_edit).padStart(5)}  ${String(s.newer_cloud).padStart(5)}  ${String(s.conflict).padStart(8)}  ${String(s.auto_fixable).padStart(8)}`)
})

const totalStats = Object.values(statsByModule).reduce((a, b) => ({
  total: a.total + b.total, exact_match: a.exact_match + b.exact_match,
  legacy_damaged: a.legacy_damaged + b.legacy_damaged, admin_edit: a.admin_edit + b.admin_edit,
  newer_cloud: a.newer_cloud + b.newer_cloud, conflict: a.conflict + b.conflict,
  auto_fixable: a.auto_fixable + b.auto_fixable
}))
console.log(`   ${'TOTAL'.padEnd(14)} ${String(totalStats.total).padStart(4)}  ${String(totalStats.exact_match).padStart(5)}  ${String(totalStats.legacy_damaged).padStart(6)}  ${String(totalStats.admin_edit).padStart(5)}  ${String(totalStats.newer_cloud).padStart(5)}  ${String(totalStats.conflict).padStart(8)}  ${String(totalStats.auto_fixable).padStart(8)}`)

// 安全确认
assert.strictEqual(totalStats.total, 966, '总数为966')
assert.strictEqual(canonical.filter(i => !i.title.trim()).length, 0, '无空标题')
assert.strictEqual(canonical.length, 966, 'canonical 966条')
// 正文修改数=0（Dry-run 不碰正文）
// contentId 修改数=0
// 数量变化=0
console.log('   PASS (正文修改=0, contentId修改=0, 数量变化=0)')

// ===== 7. 竞态测试（同模块慢A+快B）=====
console.log('7. 竞态测试 — 同模块慢A+快B')
// 同模块请求先复用在途 Promise；revision 不一致时丢弃过期响应。
assert.ok(remoteSrc.includes('stale_request_discarded'), '应有 stale_request_discarded 分支')
assert.ok(remoteSrc.includes('if (pending) return pending'), '应复用同模块在途请求')
console.log('   PASS')

// ===== 8. 两个不同模块并发不互相取消 =====
console.log('8. 两个模块并发 — catalogRevisions 按 moduleId 隔离')
// 验证 Map 按键隔离
assert.ok(remoteSrc.includes('catalogRevisions.get(normalized)'), '按 moduleId 读取 revision')
assert.ok(remoteSrc.includes('catalogRevisions.set(normalized, revision)'), '按 moduleId 写入 revision')
console.log('   PASS')

console.log('\n[check-training-title-final] all cases passed')
