#!/usr/bin/env node

// 兼容旧审计命令；标准数据审计统一由完整检查脚本执行。
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const result = spawnSync(process.execPath, [path.join(__dirname, 'check-training-content-full.js')], {
  cwd: root,
  stdio: 'inherit'
})
process.exitCode = result.status == null ? 1 : result.status
