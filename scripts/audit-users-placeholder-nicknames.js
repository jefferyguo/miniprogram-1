#!/usr/bin/env node

/*
 * users 占位昵称审计与迁移。
 * 默认不连接云端；云端读取、写入、验证和回滚都需要显式模式与环境。
 * 控制台只输出脱敏标识，完整备份仅写入已排除打包/提交的 data/backup。
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const APP_PATH = path.join(ROOT, 'app.js')
const USERS_COLLECTION = 'users'
const PAGE_SIZE = 100
const SERVER_USERNAME_PREFIX = '口才学员'
const SERVER_USERNAME_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PLACEHOLDER_NICKNAMES = new Set(['', '同学', '微信用户', '默认用户', '游客', '未登录用户'])

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function isValidPhone(value) {
  return /^1\d{10}$/.test(normalizePhone(value))
}

function maskPhone(value) {
  const phone = normalizePhone(value)
  if (!phone) return ''
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***'
}

function digestId(value) {
  const text = String(value || '')
  if (!text) return ''
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 10)
}

function redactId(value, label = 'id') {
  const text = String(value || '')
  return text ? `${label}:${digestId(text)}` : ''
}

function isPlaceholderNickname(value) {
  const nickname = normalizeText(value)
  if (PLACEHOLDER_NICKNAMES.has(nickname)) return true
  return /^微信用户\d*$/.test(nickname) || /^游客\d*$/.test(nickname)
}

function isAdminUser(user = {}) {
  const roles = [user.role, user.adminRole, user.userRole].map(normalizeText)
  return user.isAdmin === true || roles.some(role => ['admin', 'super_admin'].includes(role))
}

function hasActiveMembership(user = {}, now = Date.now()) {
  const type = normalizeText(user.membershipType || user.memberType)
  if (!['monthly', 'yearly'].includes(type)) return false
  const expiry = new Date(user.membershipExpireAt || user.memberExpireAt || user.expireAt || 0).getTime()
  return !Number.isFinite(expiry) || expiry <= 0 || expiry > now
}

function sanitizeUserForLog(user = {}) {
  return {
    idRef: redactId(user._id || user.id || user.userId, 'user'),
    openidRef: redactId(user.openid || user.openId || user._openid, 'openid'),
    phoneMasked: maskPhone(user.phone || user.phoneNumber || user.mobile),
    phoneBound: user.phoneBound === true,
    profileCompleted: user.profileCompleted === true,
    admin: isAdminUser(user),
    membership: hasActiveMembership(user),
    nicknameState: isPlaceholderNickname(user.nickname || user.nickName) ? 'placeholder' : 'kept'
  }
}

function createServerRandomUsername(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(6)
  let suffix = ''
  for (let index = 0; index < bytes.length; index += 1) {
    suffix += SERVER_USERNAME_ALPHABET[bytes[index] % SERVER_USERNAME_ALPHABET.length]
  }
  return `${SERVER_USERNAME_PREFIX}${suffix}`
}

function buildNicknamePatch(user = {}, options = {}) {
  const nickname = normalizeText(user.nickname || user.nickName)
  if (!isPlaceholderNickname(nickname)) return null
  const now = options.now || new Date().toISOString()
  const nextNickname = options.nextNickname || createServerRandomUsername(options.randomBytes)
  return {
    nickname: nextNickname,
    nickName: nextNickname,
    nicknameSource: 'random',
    nicknameMigratedFromPlaceholder: true,
    nicknameMigratedAt: now,
    nicknameUpdatedAt: now,
    updatedAt: now,
    avatarText: nextNickname.slice(0, 1)
  }
}

function duplicateGroups(users, valueGetter, label) {
  const groups = new Map()
  users.forEach(user => {
    const value = valueGetter(user)
    if (!value) return
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value).push(user)
  })
  return Array.from(groups.values())
    .filter(group => group.length > 1)
    .map(group => ({
      type: label,
      count: group.length,
      users: group.map(sanitizeUserForLog)
    }))
}

function auditUsers(users = [], options = {}) {
  const planned = []
  const skipped = []
  const now = options.now || new Date().toISOString()
  const migrationId = options.migrationId || `users-placeholder-${Date.now()}`
  const seenNicknames = new Set(users.map(user => normalizeText(user.nickname || user.nickName)).filter(Boolean))
  const duplicateOpenids = duplicateGroups(users, user => normalizeText(user.openid || user.openId || user._openid), 'duplicate_openid')
  const duplicatePhones = duplicateGroups(users, user => normalizePhone(user.phone || user.phoneNumber || user.mobile), 'duplicate_phone')

  users.forEach((user, index) => {
    const safeUser = sanitizeUserForLog(user)
    const nickname = normalizeText(user.nickname || user.nickName)
    if (!isPlaceholderNickname(nickname)) {
      skipped.push({ index, reason: 'nickname_kept', user: safeUser })
      return
    }
    if (isAdminUser(user)) {
      skipped.push({ index, reason: 'admin_requires_manual_review', user: safeUser })
      return
    }
    if (user.phoneBound !== true || !isValidPhone(user.phone || user.phoneNumber || user.mobile)) {
      skipped.push({ index, reason: 'not_phone_authenticated', user: safeUser })
      return
    }

    const patch = buildNicknamePatch(user, { ...options, now })
    let nicknameCandidate = patch.nickname
    let attempt = 0
    while (seenNicknames.has(nicknameCandidate) && attempt < 20) {
      nicknameCandidate = createServerRandomUsername(options.randomBytes)
      attempt += 1
    }
    if (seenNicknames.has(nicknameCandidate)) {
      skipped.push({ index, reason: 'nickname_collision_retry_exhausted', user: safeUser })
      return
    }
    seenNicknames.add(nicknameCandidate)
    planned.push({
      index,
      user: safeUser,
      before: { nicknameState: 'placeholder' },
      patch: {
        ...patch,
        nickname: nicknameCandidate,
        nickName: nicknameCandidate,
        avatarText: nicknameCandidate.slice(0, 1),
        nicknameMigrationId: migrationId
      }
    })
  })

  const stats = {
    total: users.length,
    phoneBoundTrue: users.filter(user => user.phoneBound === true).length,
    phoneBoundFalse: users.filter(user => user.phoneBound !== true).length,
    placeholderNickname: users.filter(user => isPlaceholderNickname(user.nickname || user.nickName)).length,
    profileCompletedWithoutPhone: users.filter(user => user.profileCompleted === true && !isValidPhone(user.phone || user.phoneNumber || user.mobile)).length,
    phoneBoundWithoutValidPhone: users.filter(user => user.phoneBound === true && !isValidPhone(user.phone || user.phoneNumber || user.mobile)).length,
    admins: users.filter(isAdminUser).length,
    activeMembers: users.filter(hasActiveMembership).length
  }

  return {
    collection: USERS_COLLECTION,
    migrationId,
    dryRun: options.apply !== true,
    scanned: users.length,
    plannedCount: planned.length,
    skippedCount: skipped.length,
    blockerCount: duplicateOpenids.length + duplicatePhones.length,
    stats,
    blockers: [...duplicateOpenids, ...duplicatePhones],
    planned,
    skipped
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readUsers(file) {
  const parsed = readJson(file)
  return Array.isArray(parsed) ? parsed : (parsed.data || parsed.users || [])
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    mode: 'local',
    input: '',
    backup: '',
    rollback: '',
    env: '',
    confirmEnv: '',
    allowProduction: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--cloud-dry-run') args.mode = 'cloud-dry-run'
    else if (item === '--apply') { args.apply = true; args.mode = 'apply' }
    else if (item === '--verify') args.mode = 'verify'
    else if (item === '--rollback') { args.mode = 'rollback'; args.rollback = argv[++index] || '' }
    else if (item === '--input') args.input = argv[++index] || ''
    else if (item === '--backup') args.backup = argv[++index] || ''
    else if (item === '--env') args.env = argv[++index] || ''
    else if (item === '--confirm-env') args.confirmEnv = argv[++index] || ''
    else if (item === '--allow-production') args.allowProduction = true
    else if (item === '--help' || item === '-h') args.help = true
    else throw new Error(`未知参数：${item}`)
  }
  return args
}

function getAppCloudEnv() {
  if (!fs.existsSync(APP_PATH)) return ''
  const match = fs.readFileSync(APP_PATH, 'utf8').match(/const\s+CLOUD_ENV\s*=\s*['"]([^'"]+)['"]/) 
  return match ? match[1] : ''
}

function assertApplyGuards(args) {
  const writeMode = args.mode || (args.apply ? 'apply' : '')
  if (!args.apply && writeMode !== 'rollback') return
  if (!args.env) throw new Error('写操作必须提供 --env')
  if (args.confirmEnv !== args.env) throw new Error('--confirm-env 必须与 --env 完全一致')
  if (writeMode === 'apply' && !args.backup) throw new Error('--apply 必须提供 --backup')
  if (writeMode === 'rollback' && !args.rollback) throw new Error('--rollback 必须指定备份文件')
  if (process.env.USERS_NICKNAME_MIGRATION_CONFIRM !== args.env) {
    throw new Error('必须设置 USERS_NICKNAME_MIGRATION_CONFIRM=<env> 后才能写入')
  }
  const productionEnv = getAppCloudEnv()
  if (productionEnv && args.env === productionEnv) {
    const expected = `${args.env}:APPLY`
    if (!args.allowProduction || process.env.USERS_NICKNAME_PRODUCTION_CONFIRM !== expected) {
      throw new Error('正式环境写入还需 --allow-production 和 USERS_NICKNAME_PRODUCTION_CONFIRM=<env>:APPLY')
    }
  }
}

function getCloudDatabase(args) {
  if (!args.env) throw new Error('云端操作必须提供 --env')
  assertApplyGuards(args)
  const secretId = process.env.CLOUDBASE_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || ''
  const secretKey = process.env.CLOUDBASE_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || ''
  if (!secretId || !secretKey) throw new Error('缺少 CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY')
  let cloudbase
  try {
    cloudbase = require('@cloudbase/node-sdk')
  } catch (error) {
    throw new Error('缺少 @cloudbase/node-sdk；请在迁移机安装后再操作云端')
  }
  return cloudbase.init({ env: args.env, secretId, secretKey }).database()
}

async function fetchAllUsers(db) {
  const users = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await db.collection(USERS_COLLECTION).skip(offset).limit(PAGE_SIZE).get()
    const page = result.data || []
    users.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return users
}

function backupHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function createBackup(args, plan, users) {
  const selected = plan.planned.map(item => users[item.index]).filter(Boolean)
  const payload = {
    env: args.env,
    migrationId: plan.migrationId,
    createdAt: new Date().toISOString(),
    collection: USERS_COLLECTION,
    note: 'Sensitive backup. Do not commit or package.',
    users: selected
  }
  const backup = { ...payload, sha256: backupHash(payload) }
  writeJson(path.resolve(args.backup), backup)
  const reloaded = readJson(path.resolve(args.backup))
  const { sha256, ...reloadedPayload } = reloaded
  if (sha256 !== backupHash(reloadedPayload)) throw new Error('用户备份回读 Hash 校验失败')
  return backup
}

async function applyCloudPlan(args, db, plan, users) {
  if (plan.blockerCount) throw new Error(`发现 ${plan.blockerCount} 组重复身份，拒绝自动迁移`)
  createBackup(args, plan, users)
  for (const item of plan.planned) {
    const rawUser = users[item.index] || {}
    const rawId = rawUser._id || rawUser.id
    if (!rawId) throw new Error(`待迁移用户缺少 _id：${item.user.idRef}`)
    console.log('[users-nickname-migration] apply:', {
      user: item.user,
      nicknameSource: item.patch.nicknameSource
    })
    await db.collection(USERS_COLLECTION).doc(rawId).update(item.patch)
    const saved = await db.collection(USERS_COLLECTION).doc(rawId).get()
    const current = saved.data && !Array.isArray(saved.data) ? saved.data : (saved.data || [])[0]
    if (!current || current.nickname !== item.patch.nickname || current.nicknameMigrationId !== plan.migrationId) {
      throw new Error(`迁移回读校验失败：${item.user.idRef}`)
    }
  }
}

async function rollbackCloud(args, db) {
  const backup = readJson(path.resolve(args.rollback))
  const { sha256, ...payload } = backup
  if (backup.env !== args.env) throw new Error('备份环境与 --env 不一致')
  if (sha256 !== backupHash(payload)) throw new Error('备份 Hash 校验失败')
  let restored = 0
  for (const user of backup.users || []) {
    const rawId = user._id || user.id
    if (!rawId) continue
    const currentResult = await db.collection(USERS_COLLECTION).doc(rawId).get()
    const current = currentResult.data && !Array.isArray(currentResult.data)
      ? currentResult.data
      : (currentResult.data || [])[0]
    if (!current || current.nicknameMigrationId !== backup.migrationId) continue
    await db.collection(USERS_COLLECTION).doc(rawId).update({
      nickname: user.nickname || '',
      nickName: user.nickName || '',
      nicknameSource: user.nicknameSource || '',
      nicknameMigratedFromPlaceholder: user.nicknameMigratedFromPlaceholder || false,
      nicknameMigratedAt: user.nicknameMigratedAt || '',
      nicknameUpdatedAt: user.nicknameUpdatedAt || '',
      nicknameMigrationId: user.nicknameMigrationId || '',
      avatarText: user.avatarText || ''
    })
    restored += 1
  }
  return { success: true, migrationId: backup.migrationId, restored }
}

function publicPlan(plan) {
  return {
    collection: plan.collection,
    migrationId: plan.migrationId,
    dryRun: plan.dryRun,
    scanned: plan.scanned,
    plannedCount: plan.plannedCount,
    skippedCount: plan.skippedCount,
    blockerCount: plan.blockerCount,
    stats: plan.stats,
    blockers: plan.blockers,
    planned: plan.planned.map(item => ({ user: item.user, nicknameSource: item.patch.nicknameSource })),
    skipped: plan.skipped
  }
}

function printHelp() {
  console.log([
    '本地审计：node scripts/audit-users-placeholder-nicknames.js --input users-export.json',
    '云端 dry-run：node scripts/audit-users-placeholder-nicknames.js --cloud-dry-run --env <env>',
    '写入：USERS_NICKNAME_MIGRATION_CONFIRM=<env> node scripts/audit-users-placeholder-nicknames.js --apply --env <env> --confirm-env <env> --backup <file>',
    '验证：node scripts/audit-users-placeholder-nicknames.js --verify --env <env>',
    '回滚：USERS_NICKNAME_MIGRATION_CONFIRM=<env> node scripts/audit-users-placeholder-nicknames.js --rollback <backup> --env <env> --confirm-env <env>',
    '正式环境还需 --allow-production 与 USERS_NICKNAME_PRODUCTION_CONFIRM=<env>:APPLY。'
  ].join('\n'))
}

async function main() {
  const args = parseArgs()
  if (args.help) return printHelp()

  if (args.mode === 'local') {
    if (!args.input) {
      console.log(JSON.stringify({ dryRun: true, scanned: 0, plannedCount: 0, note: '未提供 --input；未访问云端。' }, null, 2))
      return
    }
    console.log(JSON.stringify(publicPlan(auditUsers(readUsers(path.resolve(args.input)))), null, 2))
    return
  }

  const db = getCloudDatabase(args)
  await db.collection(USERS_COLLECTION).limit(1).get()
  if (args.mode === 'rollback') {
    console.log(JSON.stringify(await rollbackCloud(args, db), null, 2))
    return
  }

  const users = await fetchAllUsers(db)
  const plan = auditUsers(users, { apply: args.mode === 'apply' })
  console.log(JSON.stringify(publicPlan(plan), null, 2))
  if (args.mode === 'cloud-dry-run') return
  if (args.mode === 'verify') {
    if (plan.blockerCount || plan.plannedCount) process.exitCode = 2
    return
  }
  await applyCloudPlan(args, db, plan, users)
  const verifyPlan = auditUsers(await fetchAllUsers(db))
  if (verifyPlan.blockerCount || verifyPlan.plannedCount) {
    throw new Error('迁移后验证未通过，请按备份执行回滚')
  }
  console.log(JSON.stringify({ success: true, status: 'APPLIED_AND_VERIFIED', migrationId: plan.migrationId }, null, 2))
}

if (require.main === module) {
  main().catch(error => {
    console.error('[users-nickname-migration] failed:', error.message || error)
    process.exitCode = 1
  })
}

module.exports = {
  PLACEHOLDER_NICKNAMES,
  SERVER_USERNAME_ALPHABET,
  SERVER_USERNAME_PREFIX,
  auditUsers,
  assertApplyGuards,
  buildNicknamePatch,
  createServerRandomUsername,
  digestId,
  hasActiveMembership,
  isAdminUser,
  isPlaceholderNickname,
  isValidPhone,
  maskPhone,
  normalizePhone,
  parseArgs,
  redactId,
  sanitizeUserForLog
}
