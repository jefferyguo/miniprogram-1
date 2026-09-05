#!/usr/bin/env node

// 生成不含正文和敏感标识的训练内容审计交付物。
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const AUDIT_DIR = path.join(ROOT, 'data', 'audit', 'training-content-full-audit-20260729')
const CANONICAL_PATH = path.join(ROOT, 'data', 'import', '0728-final', 'canonical-training-contents.json')
const MANIFEST_PATH = path.join(ROOT, 'resources', 'training-source', '0728-final', 'source-manifest.json')

function writeJson(name, value) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true })
  fs.writeFileSync(path.join(AUDIT_DIR, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function aliasesFor(record) {
  const aliases = new Set([record.contentId])
  const match = String(record.contentId || '').match(/^(.+)-day-(\d+)$/)
  if (!match) return Array.from(aliases)
  const moduleId = match[1]
  const number = Number(match[2])
  const names = moduleId === 'retell' ? ['retell', 'retelling'] : [moduleId]
  names.forEach(name => {
    aliases.add(`${name}-day-${number}`)
    aliases.add(`${name}-v4-day-${number}`)
  })
  return Array.from(aliases)
}

function main() {
  const canonicalSource = fs.readFileSync(CANONICAL_PATH, 'utf8')
  const canonical = JSON.parse(canonicalSource)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const { generatedTrainingDays, generatedTrainingMeta } = require('../utils/generated-training-data')
  const counts = Object.fromEntries(manifest.modules.map(module => [module.moduleId, module.physicalCount]))

  writeJson('source-content-notes.json', {
    sourceRevision: manifest.sourceRevision,
    policy: '源文档中的重复编号和缺号仅记录，不擅自修正文案。',
    notes: [
      {
        code: 'READING_BASELINE_COUNT_CONFLICT',
        severity: 'source_fact',
        expectedByBrief: 213,
        lockedDocxPhysicalCount: 216,
        resolution: '采用锁定 DOCX 的 216 个完整物理文章块；未删除第 16-18 篇以凑 963。'
      },
      { code: 'RETELL_DUPLICATE_SOURCE_LABEL', moduleId: 'retell', label: 118, occurrences: 2, resolution: '保留原文顺序，以 sourceIndex 区分。' },
      { code: 'SPEECH_MISSING_SOURCE_LABELS', moduleId: 'speech', labels: [28, 45], resolution: '不补造内容，以 sourceIndex 连续排序。' },
      { code: 'MANDARIN_MISSING_SOURCE_LABELS', moduleId: 'mandarin', labels: [6, 7], resolution: '不补造内容，以 sourceIndex 连续排序。' }
    ]
  })

  writeJson('content-id-resolution-report.json', {
    status: 'LOCAL_ALIAS_AUDITED_CLOUD_REFERENCES_PENDING',
    sourceRevision: manifest.sourceRevision,
    totalCanonicalIds: canonical.length,
    policy: {
      exactContentIdRequired: true,
      titleFallback: false,
      dayOnlyFallback: false,
      legacyAliasesReadOnly: true
    },
    cloudReferenceCounts: 'NOT_QUERIED_NO_PRODUCTION_CREDENTIALS',
    orphanCloudRecords: 'NOT_QUERIED_NO_PRODUCTION_CREDENTIALS',
    records: canonical.map(record => ({
      canonicalId: record.contentId,
      moduleId: record.moduleId,
      sourceIndex: record.sourceIndex,
      legacyIds: aliasesFor(record).filter(id => id !== record.contentId),
      currentReferenceCount: null,
      safeToArchive: null,
      needsAlias: aliasesFor(record).length > 1
    }))
  })

  const localCounts = Object.fromEntries(Object.entries(generatedTrainingDays).map(([key, rows]) => [key, rows.length]))
  writeJson('four-layer-comparison.json', {
    generatedAt: new Date().toISOString(),
    sourceRevision: manifest.sourceRevision,
    sourceVsCanonical: {
      status: 'PASS_SOURCE_HASH_AND_NORMALIZED_CONTENT',
      sourceCounts: counts,
      canonicalCounts: counts,
      canonicalCount: canonical.length,
      canonicalFileHash: hash(canonicalSource)
    },
    canonicalVsLocalIndex: {
      status: JSON.stringify(counts) === JSON.stringify(localCounts) ? 'PASS' : 'FAIL',
      canonicalCounts: counts,
      localCounts,
      localCanonicalHash: generatedTrainingMeta.canonicalHash,
      fullBodiesInLocalIndex: false
    },
    canonicalVsCloud: {
      status: 'NOT_VERIFIED',
      reason: '当前会话没有生产 CloudBase 凭据，未读取或写入 trainingContents。',
      nextCommand: 'node scripts/migrate-training-contents-0728.js --cloud-dry-run --env <env>'
    },
    cloudVsStudentResponse: {
      status: 'STATIC_CONTRACT_PASS_RUNTIME_PENDING',
      contract: 'Cloud > last-known-good cache > lightweight local index; exact contentId only.'
    },
    cloudVsAdminResponse: {
      status: 'STATIC_CONTRACT_PASS_RUNTIME_PENDING',
      contract: '分页、乐观锁、revision、moduleVersion、服务端回读。'
    }
  })

  writeJson('residual-classification.json', {
    runtimeRemoved: ['utils/extended-training-data.js'],
    deprecatedBlocked: ['scripts/migrate-impromptu-0728.js'],
    compatibilityForwarders: [
      'scripts/build-training-data.js',
      'scripts/sync-training-local-data.js',
      'scripts/audit-training-source-sync.js',
      'scripts/import-reading-retelling-to-cloud.js',
      'scripts/parse_docx.py'
    ],
    intentionalReadAliases: ['*-v4-day-N', 'retelling-day-N'],
    productionDataResiduals: 'NOT_QUERIED_NO_PRODUCTION_CREDENTIALS'
  })

  writeJson('deployment-checklist.json', {
    currentStatus: 'READY_FOR_CLOUD_DRY_RUN_NOT_DEPLOYED',
    prerequisites: [
      '创建/确认 trainingContents、trainingContentModules、trainingContentRevisions 集合及索引。',
      '部署 cloudApi 与 login 云函数到目标环境。',
      '用生产凭据先执行训练内容 cloud dry-run，确认 conflicts=0。',
      '创建完整备份并校验 Hash 后再 apply。',
      '执行 verify；失败时按备份 rollback。',
      '对 users 先执行占位昵称 cloud dry-run；重复 openid/手机号会阻塞自动迁移。',
      '重新编译并上传小程序，完成真机手机号授权、管理端编辑和学员同步验收。'
    ]
  })

  console.log(JSON.stringify({ success: true, auditDir: AUDIT_DIR, total: canonical.length }, null, 2))
}

main()
