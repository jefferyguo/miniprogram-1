#!/usr/bin/env node

// 兼容旧命令；不再生成 extended-training-data 或把完整正文写入主包。
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2).filter(arg => arg === '--check')
console.warn('[sync-training-local-data] 已迁移到 scripts/build-training-content-0728.py')
const result = spawnSync('python3', [path.join(__dirname, 'build-training-content-0728.py'), ...args], {
  cwd: root,
  stdio: 'inherit'
})
process.exitCode = result.status == null ? 1 : result.status
