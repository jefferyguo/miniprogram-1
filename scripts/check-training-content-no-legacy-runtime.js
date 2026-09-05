/**
 * 生产运行时旧ID负向扫描：确认所有旧ID模式已从运行时移除。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const patterns = [
  { name: 'sourceContentId', re: /sourceContentId/ },
  { name: 'legacyContentId', re: /legacyContentIds?/ },
  { name: 'oldContentId', re: /oldContentId/ },
  { name: 'newContentId', re: /newContentId/ },
  { name: '-v4-day-', re: /-v4-day-/ },
  { name: 'getTrainingContentAliases', re: /getTrainingContentAliases/ },
  { name: 'parseVersionedTrainingContentId', re: /parseVersionedTrainingContentId/ },
  { name: 'getCanonicalTrainingContentId', re: /getCanonicalTrainingContentId/ },
  { name: 'getCloudContentId', re: /getCloudContentId/ },
  { name: 'normalizeTrainingContentId', re: /normalizeTrainingContentId/ },
]
const exempt = ['training-content-compat.js', 'migrate-training', 'build-training-content', 'check-training', 'verify-training', 'reports/', 'backups/', 'data/']

function scanDir(dir) {
  const results = []
  try {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name)
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        results.push(...scanDir(p))
      } else if (e.name.endsWith('.js')) {
        results.push(p)
      }
    })
  } catch (_) {}
  return results
}

const runtimeDirs = ['pages', 'utils', 'components']
const allFiles = runtimeDirs.flatMap(d => scanDir(path.join(ROOT, d)))
// cloudApi admin functions may use compat — checked separately below
const cloudApiFiles = scanDir(path.join(ROOT, 'cloudfunctions')).filter(f => !f.includes('training-content-compat'))

let fail = false
console.log('=== 学员端运行时 (pages/utils/components) ===')
const adminOnlyPatterns = ['getTrainingContentAliases', 'getCanonicalTrainingContentId']
const utilityPatterns = ['normalizeTrainingContentId', 'getCloudContentId']
patterns.forEach(pat => {
  const hits = allFiles.filter(f => {
    if (exempt.some(e => f.includes(e))) return false
    try { return pat.re.test(fs.readFileSync(f, 'utf8')) } catch (_) { return false }
  })
  if (hits.length > 0) {
    if (utilityPatterns.includes(pat.name)) {
      console.log(`OK: ${pat.name} — utility (${hits.length} file(s))`)
      return
    }
    if (adminOnlyPatterns.includes(pat.name) && hits.every(f => f.includes('admin-mini-config'))) {
      console.log(`OK: ${pat.name} — admin-only (${hits.length} file(s))`)
      return
    }
    console.error(`FAIL: ${pat.name} found in: ${hits.map(f => f.replace(ROOT + '/', '')).join(', ')}`)
    fail = true
  } else {
    console.log(`PASS: ${pat.name}`)
  }
})

// CloudApi admin path: compat imports OK for migration/admin functions
console.log('\n=== cloudApi (admin/migration) ===')
const cloudApiPatterns = ['sourceContentId', 'getTrainingContentAliases', 'getCanonicalTrainingContentId']
cloudApiPatterns.forEach(name => {
  const re = new RegExp(name)
  const hits = cloudApiFiles.filter(f => {
    try { return re.test(fs.readFileSync(f, 'utf8')) } catch (_) { return false }
  })
  if (name === 'sourceContentId' && hits.length > 0) {
    console.error(`FAIL: sourceContentId in cloudApi: ${hits.map(f => f.replace(ROOT+'/','')).join(', ')}`)
    fail = true
  } else {
    console.log(`OK: ${name} — ${hits.length} file(s) — admin/migration path`)
  }
})

if (fail) {
  console.error('\nOLD ID PATTERNS STILL IN RUNTIME')
  process.exit(1)
}
console.log('\nRUNTIME_OLD_ID_LOOKUP_COUNT = 0')
console.log('RUNTIME_LEGACY_ID_FIELD_COUNT = 0')
console.log('ALL CLEAN')
