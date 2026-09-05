#!/usr/bin/env node

// 兼容旧入口；旧 v4 三模块导入器已停用，所有写入必须走带备份与回滚的六模块迁移器。
const path = require('path')
const { spawnSync } = require('child_process')

function main() {
  console.warn('[import-reading-retelling-to-cloud] 旧 v4 导入器已停用，转交 0728 六模块迁移器。')
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'migrate-training-contents-0728.js'),
    ...process.argv.slice(2)
  ], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit'
  })
  process.exitCode = result.status == null ? 1 : result.status
}

if (require.main === module) main()

module.exports = { main }
