#!/usr/bin/env node

// 旧的 Level 0/1/2 测试入口保留为兼容命令，但契约已收敛为 Guest/手机号登录两态。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  getAuthLevel,
  isAuthenticatedUser,
  isPhoneBoundUser
} = require('../utils/auth-state')

const ROOT = path.resolve(__dirname, '..')
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
assert.equal((appSource.match(/wx\.cloud\.init\s*\(/g) || []).length, 1, 'app.js 只能有一个 wx.cloud.init')
assert.ok(/ensureCloudReady/.test(appSource), 'app.js 必须保留云初始化屏障')

const guest = {
  _id: 'legacy-level-one',
  nickname: '旧昵称',
  nicknameSource: 'custom',
  profileCompleted: true
}
assert.equal(getAuthLevel(guest), 0, '旧昵称 Level 1 必须降级为 Guest')
assert.equal(isAuthenticatedUser(guest), false)

const authenticated = {
  _id: 'server-user',
  nickname: '口才学员ABC234',
  nicknameSource: 'random',
  profileCompleted: true,
  phoneBound: true,
  phone: '13800138000'
}
assert.equal(getAuthLevel(authenticated), 2)
assert.equal(isPhoneBoundUser(authenticated), true)

const finalSuite = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-phone-login-final.js')], {
  cwd: ROOT,
  encoding: 'utf8'
})
process.stdout.write(finalSuite.stdout || '')
process.stderr.write(finalSuite.stderr || '')
if (finalSuite.status !== 0) process.exit(finalSuite.status || 1)

console.log('[check-unified-auth] PASS：Guest/手机号登录两态与 74 项最终契约均通过')
