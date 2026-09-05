#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CANONICAL_PATH = path.join(ROOT, 'data', 'import', '0728-final', 'canonical-training-contents.json')
const records = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf8'))
const expectedCounts = {
  topic: 276,
  reading: 216,
  leaderSpeech: 24,
  retell: 257,
  speech: 116,
  mandarin: 77
}

function normalizedText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

Object.entries(expectedCounts).forEach(([category, expectedCount]) => {
  const rows = records.filter(item => item.category === category)
  assert.equal(rows.length, expectedCount, `${category}: 数量不一致`)
  rows.forEach(item => {
    assert.ok(normalizedText(item.title), `${item.contentId}: 标题为空`)
    assert.ok(normalizedText(item.content), `${item.contentId}: 正文为空`)
    assert.ok(normalizedText(item.richContentHtml), `${item.contentId}: 富文本为空`)
    assert.equal(item.contentId, String(item.contentId).trim(), `${item.contentId}: ID 含多余空白`)
  })
})

const { generatedTrainingDays } = require('../utils/generated-training-data')
Object.entries(expectedCounts).forEach(([moduleId, expectedCount]) => {
  const indexRows = generatedTrainingDays[moduleId] || []
  assert.equal(indexRows.length, expectedCount, `${moduleId}: 轻量索引数量不一致`)
  indexRows.forEach(indexItem => {
    const canonical = records.find(item => item.contentId === indexItem.contentId)
    assert.ok(canonical, `${indexItem.contentId}: 标准正文不存在`)
    assert.equal(indexItem.title, canonical.title, `${indexItem.contentId}: 标题与标准数据不一致`)
    assert.equal(indexItem.sourceIndex, canonical.sourceIndex, `${indexItem.contentId}: sourceIndex 不一致`)
    assert.equal(Object.prototype.hasOwnProperty.call(indexItem, 'content'), false, `${indexItem.contentId}: 轻量索引不应含正文`)
  })
})

console.log('[check-training-title-content-consistency] PASS', {
  total: records.length,
  counts: expectedCounts,
  cloudAudit: '使用 migrate-training-contents-0728.js --verify --env <env> 独立执行'
})
