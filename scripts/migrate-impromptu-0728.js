#!/usr/bin/env node

/*
 * 旧的单模块即兴训练迁移入口已经停用。
 * 六类训练内容现在只能经统一的 0728 受控迁移工具处理，避免旧脚本覆盖管理员修改。
 */

const { spawnSync } = require('child_process')
const path = require('path')

const replacement = path.join(__dirname, 'migrate-training-contents-0728.js')
const args = process.argv.slice(2)
const safeLocalModes = new Set(['--help', '-h', '--offline-validate'])

if (!args.length || args.every(arg => safeLocalModes.has(arg))) {
  console.warn('[deprecated] migrate-impromptu-0728.js 已停用，改用六模块统一校验。')
  const commandArgs = args.includes('--help') || args.includes('-h') ? ['--help'] : []
  const result = spawnSync(process.execPath, [replacement, ...commandArgs], { stdio: 'inherit' })
  process.exitCode = result.status == null ? 1 : result.status
} else {
  console.error([
    '[blocked] 旧的即兴训练迁移命令可能覆盖正式数据，已拒绝执行。',
    '请改用：node scripts/migrate-training-contents-0728.js --cloud-dry-run --env <env>',
    '正式写入还必须提供 --confirm-env、--backup 和 TRAINING_CONTENT_MIGRATION_CONFIRM。'
  ].join('\n'))
  process.exitCode = 2
}
