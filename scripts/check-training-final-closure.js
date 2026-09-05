#!/usr/bin/env node

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DASHBOARD_ROOT = path.resolve(ROOT, '..', '..', 'koucai-content-dashboard')

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
}

function assertRuntimeContract() {
  const cloudApi = fs.readFileSync(path.join(ROOT, 'cloudfunctions/cloudApi/index.js'), 'utf8')
  assert.ok(cloudApi.includes("case 'getTrainingContentById':"))
  assert.ok(cloudApi.includes("case 'getTrainingCatalogByModule':") || cloudApi.includes("action === 'getTrainingCatalogByModule'"))
  assert.ok(cloudApi.includes("case 'adminWebUpsertTrainingContent':\n        return await adminWebUpsertTrainingContent(event)"), '网页管理端必须调用版本化 CloudBase 写接口')
  assert.ok(cloudApi.includes('expectedContentVersion !== currentVersion'), '管理端更新必须使用乐观锁')
  assert.ok(cloudApi.includes('TRAINING_CONTENT_VERIFY_FAILED'), '管理端更新必须回读校验')
  assert.ok(cloudApi.includes('trainingContentRevisions'), '管理端更新必须写修订记录')
  assert.ok(cloudApi.includes('TRAINING_CONTENT_INITIAL_IMPORT_REQUIRED'), '主训练目录新增必须走受控导入')
  assert.ok(cloudApi.includes('TRAINING_CONTENT_STRUCTURE_CHANGE_REQUIRES_IMPORT'), '日常管理接口不得破坏固定目录结构')

  const taskDetail = fs.readFileSync(path.join(ROOT, 'pages/task-detail/task-detail.js'), 'utf8')
  assert.ok(taskDetail.includes('getTrainingContentStateView'))
  assert.ok(taskDetail.includes('getTaskByModuleAndContentId'))
  assert.ok(!taskDetail.includes('getTaskByModuleAndDay'))

  const generated = fs.readFileSync(path.join(ROOT, 'utils/generated-training-data.js'), 'utf8')
  assert.ok(!generated.includes('"content":'), '轻量目录不得包含正文')
  assert.ok(!generated.includes('"material":'), '轻量目录不得包含 material')
  assert.ok(!generated.includes('sourceIndex'), '轻量目录不得包含 sourceIndex')
}

function assertMembershipRegression() {
  const frontend = require('../utils/membership-products').MEMBERSHIP_PRODUCTS
  const cloud = require('../cloudfunctions/cloudApi/membership-products').MEMBERSHIP_PRODUCTS
  for (const products of [frontend, cloud]) {
    assert.equal(products[0].productId, 'quarterly_membership')
    assert.equal(products[0].membershipType, 'monthly')
    assert.equal(products[0].priceFen, 3990)
    assert.equal(products[0].durationDays, 90)
    assert.equal(products[1].productId, 'yearly_membership')
    assert.equal(products[1].priceFen, 5990)
  }
}

function assertDashboardContract() {
  if (!fs.existsSync(DASHBOARD_ROOT)) throw new Error(`管理端项目不存在: ${DASHBOARD_ROOT}`)
  const contract = fs.readFileSync(path.join(DASHBOARD_ROOT, 'lib/trainingContentContract.ts'), 'utf8')
  const center = fs.readFileSync(path.join(DASHBOARD_ROOT, 'lib/contentCenter.ts'), 'utf8')
  assert.ok(contract.includes('^tc_[0-9a-f]{32}$'))
  assert.ok(!contract.includes('_id does not match contentId'), 'CloudBase _id 不得被当作业务 contentId')
  assert.ok(center.includes('adminWebUpsertTrainingContent'))
  assert.ok(center.includes('verifyPublishedTrainingContent'))
  assert.ok(center.includes('verifyCloudWriteResponse'))
  assert.ok(center.includes('publish_failed'))
}

function main() {
  run('python3', ['scripts/test_training_id_manifest.py'])
  run('python3', ['scripts/build-training-content-0728.py', '--check'])
  run('python3', ['scripts/generate-training-source-audit.py'])
  run('node', ['scripts/check-training-content-full.js'])
  run('node', ['scripts/check-training-migration-fixture.js'])
  run('node', ['scripts/check-training-runtime-final.js'])
  run('node', ['scripts/check-training-content-no-legacy-runtime.js'])
  assertRuntimeContract()
  assertMembershipRegression()
  assertDashboardContract()
  console.log(JSON.stringify({
    success: true,
    sourceFileCount: 6,
    canonicalTotal: 966,
    runtimePermanentIdOnly: true,
    dashboardVersionedCloudWrite: true,
    quarterlyProductId: 'quarterly_membership',
    quarterlyPriceFen: 3990,
    quarterlyDurationDays: 90
  }, null, 2))
}

main()
