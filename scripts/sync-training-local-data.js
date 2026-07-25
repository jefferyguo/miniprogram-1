#!/usr/bin/env node

/**
 * 将 DOCX 解析结果同步到小程序本地数据。
 * reading / retelling 只保留轻量索引，完整正文由 CloudBase trainingContents 提供；
 * speech 保留完整正文，确保现有演讲训练离线可用。
 */

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const IMPORT_DIR = path.join(ROOT_DIR, 'data', 'import')
const GENERATED_FILE = path.join(ROOT_DIR, 'utils', 'generated-training-data.js')
const EXTENDED_FILE = path.join(ROOT_DIR, 'utils', 'extended-training-data.js')
const CONTENT_VERSION = 'v4'
const CHECK = process.argv.includes('--check')

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(IMPORT_DIR, name), 'utf8'))
}

function assertItems(items, category, expectedCount) {
  if (!Array.isArray(items) || items.length !== expectedCount) {
    throw new Error(`${category} 数量应为 ${expectedCount}，当前为 ${Array.isArray(items) ? items.length : 0}`)
  }

  const ids = new Set()
  items.forEach((item, index) => {
    const day = index + 1
    if (Number(item.day) !== day) throw new Error(`${category} Day ${day} 排序不连续`)
    if (!item.contentId || ids.has(item.contentId)) throw new Error(`${category} Day ${day} contentId 缺失或重复`)
    if (!String(item.title || '').trim()) throw new Error(`${category} Day ${day} 标题为空`)
    if (!String(item.content || '').trim()) throw new Error(`${category} Day ${day} 正文为空`)
    ids.add(item.contentId)
  })
}

function getVersionedContentId(category, day) {
  return `${category}-${CONTENT_VERSION}-day-${day}`
}

function buildLiteFallback(items, category) {
  return items.map(item => {
    const day = Number(item.day)
    const isPaid = day > 21
    return {
      contentId: getVersionedContentId(category, day),
      day,
      title: item.title,
      author: item.author || '',
      material: '内容正在加载，请稍后重试。',
      targetSeconds: Number(item.targetSeconds || 60),
      membershipLevel: isPaid ? 'member' : 'free'
    }
  })
}

function buildFullFallback(items, category) {
  return items.map(item => ({
    ...item,
    contentId: getVersionedContentId(category, Number(item.day))
  }))
}

function writeJs(filePath, commentLines, declarations, exportsObject) {
  const content = [
    ...commentLines.map(line => `// ${line}`),
    // 训练正文体积较大，紧凑输出可显著降低小程序主包大小。
    ...Object.entries(declarations).map(([name, value]) => `const ${name}=${JSON.stringify(value)}`),
    '',
    `module.exports=${JSON.stringify(exportsObject)}`
      .replace(/"__REFERENCE__([A-Za-z0-9_]+)"/g, '$1'),
    ''
  ].join('\n\n')
  if (CHECK) {
    const current = fs.readFileSync(filePath, 'utf8')
    if (current !== content) {
      throw new Error(`${path.relative(ROOT_DIR, filePath)} 与当前导入数据不一致`)
    }
    return
  }
  fs.writeFileSync(filePath, content, 'utf8')
}

function main() {
  const reading = readJson('reading_import_v3.json')
  const retelling = readJson('retell_import_v3.json')
  const speech = readJson('speech_items_v3.json')

  assertItems(reading, 'reading', 214)
  assertItems(retelling, 'retelling', 255)
  assertItems(speech, 'speech', 111)

  // 在覆盖文件前先加载需保留的其他训练模块。
  delete require.cache[require.resolve(GENERATED_FILE)]
  delete require.cache[require.resolve(EXTENDED_FILE)]
  const currentGenerated = require(GENERATED_FILE)
  const currentExtended = require(EXTENDED_FILE)
  const generatedTrainingDays = {
    reading: buildLiteFallback(reading, 'reading'),
    retell: buildLiteFallback(retelling, 'retelling'),
    topic: currentGenerated.generatedTrainingDays.topic,
    mandarin: currentGenerated.generatedTrainingDays.mandarin
  }
  const generatedTrainingMeta = {
    source: 'cloud-first-lite-fallback',
    sourceFile: 'data/import/reading_import_v3.json, data/import/retell_import_v3.json',
    importedAt: '2026-07-22',
    notes: 'reading 和 retell 本地仅保留轻量索引与加载提示，完整正文通过 CloudBase trainingContents 分页读取；topic 和 mandarin 保持原数据。',
    counts: {
      reading: reading.length,
      retell: retelling.length,
      topic: generatedTrainingDays.topic.length,
      mandarin: generatedTrainingDays.mandarin.length
    }
  }

  writeJs(
    GENERATED_FILE,
    [
      '由 scripts/parse_docx.py 与 scripts/sync-training-local-data.js 生成。',
      '朗诵/复述只保留轻量 fallback，完整正文必须从 CloudBase trainingContents 加载。'
    ],
    { generatedTrainingDays, generatedTrainingMeta },
    {
      generatedTrainingDays: '__REFERENCE__generatedTrainingDays',
      generatedTrainingMeta: '__REFERENCE__generatedTrainingMeta'
    }
  )

  writeJs(
    EXTENDED_FILE,
    [
      'speechTrainingItems 由演讲0720.docx 原样解析生成。',
      'leaderSpeechTrainingItems 保持现有数据不变。'
    ],
    {
      speechTrainingItems: buildFullFallback(speech, 'speech'),
      leaderSpeechTrainingItems: currentExtended.leaderSpeechTrainingItems
    },
    {
      speechTrainingItems: '__REFERENCE__speechTrainingItems',
      leaderSpeechTrainingItems: '__REFERENCE__leaderSpeechTrainingItems'
    }
  )

  console.log(`[sync-training-local-data] ${CHECK ? '校验通过' : '完成'}`, {
    reading: reading.length,
    retelling: retelling.length,
    speech: speech.length,
    topic: generatedTrainingDays.topic.length,
    mandarin: generatedTrainingDays.mandarin.length,
    leaderSpeech: currentExtended.leaderSpeechTrainingItems.length
  })
}

main()
