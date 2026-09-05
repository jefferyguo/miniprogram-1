#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) || null },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const EXPECTED_COUNTS = { topic: 276, reading: 216, leaderSpeech: 24, retell: 257, speech: 116, mandarin: 77 }
const { generatedTrainingDays } = require('../utils/generated-training-data')
const trainingData = require('../utils/training-data')
const { CONTENT_STATE, getTrainingContentStateView } = require('../utils/training-content-state')

function permanentId(number) {
  return `tc_${Number(number).toString(16).padStart(32, '0')}`
}

async function main() {
  trainingData.clearCloudTrainingContents()
  const localModules = trainingData.getTrainingModules()
  for (const [moduleId, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
    assert.equal(localModules.find(item => item.id === moduleId).days.length, expectedCount, `${moduleId}: 本地目录数量错误`)
  }

  const remoteTopic = generatedTrainingDays.topic.map(item => ({
    ...item,
    title: `[云端] ${item.title}`,
    updatedAt: '2026-08-01 10:00:00'
  }))
  assert.equal(trainingData.setCloudTrainingContents(remoteTopic, { moduleId: 'topic' }), true)
  let topic = trainingData.getModuleById('topic')
  assert.equal(topic.days.length, 276)
  assert.ok(topic.days.every(item => item.title.startsWith('[云端] ')), '有效云端目录必须整模块替换')

  const invalidMergedTopic = remoteTopic.concat(remoteTopic)
  assert.equal(trainingData.setCloudTrainingContents(invalidMergedTopic, { moduleId: 'topic' }), false)
  topic = trainingData.getModuleById('topic')
  assert.equal(topic.days.length, 276, '无效 552 条目录不得覆盖已验证目录')
  assert.ok(topic.days.every(item => item.title.startsWith('[云端] ')), '校验失败不能形成逐条拼接或半替换')

  trainingData.clearCloudTrainingContents('topic')
  topic = trainingData.getModuleById('topic')
  assert.equal(topic.days.length, 276)
  assert.ok(topic.days.every(item => !item.title.startsWith('[云端] ')), '清除远程目录后必须回到本地 fallback')

  const readyView = getTrainingContentStateView(CONTENT_STATE.READY)
  assert.equal(readyView.contentReady, true)
  assert.equal(readyView.trainingContentUnavailable, false)
  const notFoundView = getTrainingContentStateView(CONTENT_STATE.NOT_FOUND)
  assert.equal(notFoundView.trainingContentMessage, '内容同步中或暂时无法获取。')
  assert.ok(!notFoundView.trainingContentMessage.includes('下架'), 'not found 不得误报已下架')
  const inactiveView = getTrainingContentStateView(CONTENT_STATE.INACTIVE)
  assert.equal(inactiveView.trainingContentMessage, '该训练内容已下架。')

  let contentHandler = async () => { throw Object.assign(new Error('network unavailable'), { code: 'NETWORK_ERROR' }) }
  const cloudApiPath = require.resolve('../utils/cloud-api')
  const originalCloudApiCache = require.cache[cloudApiPath]
  require.cache[cloudApiPath] = {
    id: cloudApiPath,
    filename: cloudApiPath,
    loaded: true,
    exports: {
      getTrainingCatalogByModule: async () => ({ success: false, source: 'none', contents: [] }),
      getTrainingContents: async () => ({ success: false, source: 'none', contents: [] }),
      getTrainingContentById: (...args) => contentHandler(...args)
    }
  }
  const remotePath = require.resolve('../utils/remote-training')
  delete require.cache[remotePath]
  const remote = require('../utils/remote-training')

  const networkId = permanentId(1001)
  let result = await remote.ensureTrainingContentById({ contentId: networkId })
  assert.equal(result.status, 'networkError')
  assert.ok(!String(result.message).includes('下架'), '网络失败不得误报下架')

  const missingId = permanentId(1002)
  contentHandler = async () => ({ success: true, source: 'cloud', found: false, code: 'content_not_found', content: null })
  result = await remote.ensureTrainingContentById({ contentId: missingId })
  assert.equal(result.status, 'notFound')

  const inactiveId = permanentId(1003)
  contentHandler = async () => ({ success: true, source: 'cloud', found: true, code: 'content_inactive', content: null })
  result = await remote.ensureTrainingContentById({ contentId: inactiveId })
  assert.equal(result.status, 'inactive')

  const readyId = permanentId(1004)
  contentHandler = async contentId => ({
    success: true,
    source: 'cloud',
    found: true,
    content: {
      contentId,
      moduleId: 'reading',
      day: 5,
      sortOrder: 5,
      title: '缓存测试',
      content: '这是用于验证精确永久 ID 和版本缓存的完整训练正文。',
      contentVersion: 1,
      status: 'active'
    }
  })
  result = await remote.ensureTrainingContentById({ contentId: readyId })
  assert.equal(result.status, 'ready')
  assert.equal(result.content.contentId, readyId)
  assert.ok(result.content.content)
  contentHandler = async () => { throw Object.assign(new Error('network unavailable'), { code: 'NETWORK_ERROR' }) }
  const cachedResult = await remote.ensureTrainingContentById({ contentId: readyId, contentVersion: 1 })
  assert.equal(cachedResult.source, 'content_cache')

  contentHandler = async () => ({ success: true, source: 'cloud', found: true, code: 'content_inactive', content: null })
  const inactiveAfterCache = await remote.ensureTrainingContentById({ contentId: readyId, contentVersion: 1 })
  assert.equal(inactiveAfterCache.status, 'inactive', '云端下架状态必须覆盖旧缓存')
  assert.equal(remote.__test__.loadContentCache(readyId, 1), null, '下架内容必须从正文缓存移除')

  const concurrentVersionId = permanentId(1005)
  const concurrentResolvers = {}
  let concurrentCallCount = 0
  contentHandler = async contentId => {
    concurrentCallCount += 1
    const version = concurrentCallCount
    await new Promise(resolve => { concurrentResolvers[version] = resolve })
    return {
      success: true,
      source: 'cloud',
      found: true,
      content: {
        contentId,
        moduleId: 'reading',
        day: 6,
        sortOrder: 6,
        title: `并发版本 ${version}`,
        content: `用于验证并发请求版本隔离的正文 ${version}`,
        contentVersion: version,
        status: 'active'
      }
    }
  }
  const versionOneRequest = remote.ensureTrainingContentById({ contentId: concurrentVersionId, contentVersion: 1 })
  const versionTwoRequest = remote.ensureTrainingContentById({ contentId: concurrentVersionId, contentVersion: 2 })
  assert.equal(concurrentCallCount, 2, '不同期望版本必须发起独立正文请求')
  concurrentResolvers[2]()
  const versionTwoResult = await versionTwoRequest
  concurrentResolvers[1]()
  const versionOneResult = await versionOneRequest
  assert.ok(versionOneResult.content.contentVersion >= 1)
  assert.equal(versionTwoResult.content.contentVersion, 2)
  assert.equal(remote.__test__.loadContentCache(concurrentVersionId, 2).contentVersion, 2, '较晚返回的旧响应不得回退缓存版本')

  storage.clear()
  for (let index = 1; index <= 45; index += 1) {
    remote.__test__.saveContentCache({
      contentId: permanentId(index),
      moduleId: 'reading',
      day: index,
      sortOrder: index,
      title: `缓存 ${index}`,
      content: `正文 ${index}`,
      contentVersion: 1,
      status: 'active'
    })
  }
  const cacheIndex = storage.get('training-content-cache-index')
  assert.equal(cacheIndex.length, remote.__test__.MAX_CONTENT_CACHE_ITEMS)
  for (let index = 1; index <= 5; index += 1) {
    assert.equal(storage.has(`training-content:${permanentId(index)}`), false, 'LRU 必须淘汰最旧内容')
  }

  const versionId = permanentId(2001)
  remote.__test__.saveContentCache({ contentId: versionId, moduleId: 'reading', title: '版本', content: '版本一', contentVersion: 1, status: 'active' })
  assert.equal(remote.__test__.loadContentCache(versionId, 1).content, '版本一')
  remote.__test__.saveContentCache({ contentId: versionId, moduleId: 'reading', title: '版本', content: '版本二', contentVersion: 2, status: 'active' })
  assert.equal(remote.__test__.loadContentCache(versionId, 2).content, '版本二')
  storage.set(`training-content:${versionId}`, { schemaVersion: 1, contentId: versionId, status: 'active', title: '损坏', content: '', contentVersion: 2 })
  assert.equal(remote.__test__.loadContentCache(versionId, 2), null)
  assert.equal(storage.has(`training-content:${versionId}`), false, '损坏缓存必须删除')

  const moduleDetailSource = fs.readFileSync(path.join(ROOT, 'pages/module-detail/module-detail.js'), 'utf8')
  assert.ok(moduleDetailSource.includes('completedContentIds'), '完成状态必须按 contentId 关联')
  assert.ok(!moduleDetailSource.includes('completedDays'), '完成状态不得按 Day 关联')

  if (originalCloudApiCache) require.cache[cloudApiPath] = originalCloudApiCache
  else delete require.cache[cloudApiPath]
  delete require.cache[remotePath]

  console.log(JSON.stringify({
    success: true,
    topicVisibleTotal: 276,
    retellVisibleTotal: 257,
    invalidMergedCatalogRejected: true,
    networkFailureReportedAsInactive: false,
    concurrentVersionRequestsIsolated: true,
    cacheLimit: remote.__test__.MAX_CONTENT_CACHE_ITEMS,
    cacheVersionUpdate: true,
    completionIdentity: 'contentId'
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
