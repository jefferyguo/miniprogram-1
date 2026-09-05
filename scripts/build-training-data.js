#!/usr/bin/env node

// 兼容旧命令；六套训练内容现在只有一个确定性生成入口。
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2).filter(arg => arg === '--check')
console.warn('[build-training-data] 已迁移到 scripts/build-training-content-0728.py')
const result = spawnSync('python3', [path.join(__dirname, 'build-training-content-0728.py'), ...args], {
  cwd: root,
  stdio: 'inherit'
})
process.exitCode = result.status == null ? 1 : result.status
