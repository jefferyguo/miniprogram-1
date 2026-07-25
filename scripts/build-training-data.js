const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT_DIR = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, 'resources', 'training-source')
const OUTPUT_FILE = path.join(ROOT_DIR, 'utils', 'generated-training-data.js')
const SHUFFLE_SEED = 20260619

const SOURCE_FILES = {
  reading: '朗诵训练60篇.docx',
  retell: '60篇复述.docx',
  topic: '60个话题.docx',
  mandarin: '60个普通话训练.docx'
}

const DEFAULT_TIPS = {
  reading: [
    '第一遍先慢读，保证每个字清楚。',
    '第二遍打开声音，注意停顿和重音。',
    '录音后回听一次，观察声音是否稳定、句尾是否完整。'
  ],
  retell: [
    '先通读材料，找出人物、事件和结果。',
    '复述时不要背原文，用自己的话讲清楚。',
    '尽量按照“开头、经过、结果、启发”的顺序表达。'
  ],
  topic: [
    '先用一句话说出核心观点。',
    '再补充一个经历、例子或理由。',
    '结尾用一句总结收住，不要突然停下。'
  ],
  mandarin: [
    '先慢读，注意口型和舌位。',
    '每组词至少读两遍，第二遍要更清晰。',
    '录音后重点检查是否有平翘舌、鼻边音或前后鼻音混淆。'
  ]
}

const MODULE_CONFIG = {
  reading: {
    title: '主题朗读训练',
    targetSeconds: 60,
    tips: DEFAULT_TIPS.reading
  },
  retell: {
    title: '故事复述训练',
    targetSeconds: 90,
    tips: DEFAULT_TIPS.retell
  },
  topic: {
    title: '即兴话题训练',
    targetSeconds: 60,
    tips: DEFAULT_TIPS.topic
  },
  mandarin: {
    title: '普通话专项训练',
    targetSeconds: 60,
    tips: DEFAULT_TIPS.mandarin
  }
}

function readDocxText(fileName) {
  const filePath = path.join(SOURCE_DIR, fileName)

  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少训练源文件：${filePath}`)
  }

  // 使用 macOS textutil 作为开发期转换工具，小程序运行时不会读取 docx。
  return execFileSync('textutil', ['-convert', 'txt', '-stdout', filePath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  })
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
}

function compactMaterial(lines) {
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function estimateChars(text) {
  return String(text || '').replace(/\s/g, '').length
}

function seededRandom(seed) {
  let state = seed >>> 0

  return function random() {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleWithSeed(items, seed) {
  const result = items.slice()
  const random = seededRandom(seed)

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }

  return result
}

function simplifyReadingTitle(title) {
  const rawTitle = String(title || '').trim()
  const quotedTitle = rawTitle.match(/《([^》]+)》/)

  if (quotedTitle && quotedTitle[1]) {
    return `${quotedTitle[1].trim()}主题朗读`
  }

  return rawTitle
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/节选|原文/g, '')
    .trim()
}

function parseReading(text) {
  const lines = normalizeText(text).split('\n')
  const items = []
  let current = null

  lines.forEach(rawLine => {
    const line = rawLine.trim()
    const match = line.match(/^(\d{1,3})\s+(.{2,80})$/)
    const isHeading = Boolean(match)

    if (isHeading) {
      if (current) {
        items.push(current)
      }

      current = {
        sourceNo: Number(match[1]),
        sourceTitle: match[2].trim(),
        contentTitle: simplifyReadingTitle(match[2]),
        materialLines: []
      }
      return
    }

    if (current) {
      current.materialLines.push(rawLine)
    }
  })

  if (current) {
    items.push(current)
  }

  return items
    .map(item => ({
      sourceNo: item.sourceNo,
      sourceTitle: item.sourceTitle,
      contentTitle: item.contentTitle,
      material: compactMaterial(item.materialLines)
    }))
    .filter(item => item.contentTitle && item.material)
}

function parseRetell(text) {
  const lines = normalizeText(text).split('\n')
  const items = []
  let current = null

  lines.forEach(rawLine => {
    const line = rawLine.trim()
    const match = line.match(/^第\s*(\d{1,3})\s*篇[:：]\s*(.+)$/)

    if (match) {
      if (current) {
        items.push(current)
      }

      current = {
        sourceNo: Number(match[1]),
        contentTitle: match[2].trim(),
        materialLines: []
      }
      return
    }

    if (current) {
      current.materialLines.push(rawLine)
    }
  })

  if (current) {
    items.push(current)
  }

  return items
    .map(item => ({
      sourceNo: item.sourceNo,
      contentTitle: item.contentTitle,
      material: compactMaterial(item.materialLines)
    }))
    .filter(item => item.contentTitle && item.material)
}

function parseTopic(text) {
  return normalizeText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line !== '60个话题')
    .map((topic, index) => ({
      sourceNo: index + 1,
      contentTitle: topic,
      material: `请围绕「${topic}」进行 1 分钟即兴表达。表达时先给出你的核心观点，再说明 1-2 个理由，最后用一句话收束总结。不要追求完美，重点是把想法说完整、说清楚。`
    }))
}

function parseMandarin(text) {
  const lines = normalizeText(text).split('\n')
  const items = []
  let current = null

  lines.forEach(rawLine => {
    const line = rawLine.trim()
    const match = line.match(/^([一二三四五六七八九十百〇零]+)[、.．]\s*(.+)$/)

    if (match) {
      if (current) {
        items.push(current)
      }

      current = {
        sourceNo: items.length + 1,
        contentTitle: match[2].trim(),
        materialLines: []
      }
      return
    }

    if (current) {
      current.materialLines.push(rawLine)
    }
  })

  if (current) {
    items.push(current)
  }

  return items
    .map(item => ({
      sourceNo: item.sourceNo,
      contentTitle: item.contentTitle,
      material: compactMaterial(item.materialLines)
    }))
    .filter(item => item.contentTitle && item.material)
}

function buildDays(items, moduleId) {
  const config = MODULE_CONFIG[moduleId]

  return items.map((item, index) => {
    const day = index + 1
    const material = item.material
    const isPaid = day > 21

    return {
      day,
      title: config.title,
      contentTitle: item.contentTitle,
      material,
      tips: config.tips,
      duration: `${config.targetSeconds}秒`,
      targetSeconds: config.targetSeconds,
      estimatedChars: estimateChars(material),
      goal: '',
      requirement: '',
      isPaid,
      unlockType: isPaid ? 'paid' : 'free'
    }
  })
}

function buildAllData() {
  const reading = shuffleWithSeed(
    parseReading(readDocxText(SOURCE_FILES.reading)),
    SHUFFLE_SEED
  )
  const retell = shuffleWithSeed(
    parseRetell(readDocxText(SOURCE_FILES.retell)),
    SHUFFLE_SEED
  )
  const topic = shuffleWithSeed(
    parseTopic(readDocxText(SOURCE_FILES.topic)),
    SHUFFLE_SEED
  )
  const mandarin = parseMandarin(readDocxText(SOURCE_FILES.mandarin))

  const generatedTrainingDays = {
    reading: buildDays(reading, 'reading'),
    retell: buildDays(retell, 'retell'),
    topic: buildDays(topic, 'topic'),
    mandarin: buildDays(mandarin, 'mandarin')
  }

  const generatedTrainingMeta = {
    source: 'docx',
    sourceDir: 'resources/training-source',
    shuffleSeed: SHUFFLE_SEED,
    shuffledModules: ['reading', 'retell', 'topic'],
    orderedModules: ['mandarin'],
    counts: Object.keys(generatedTrainingDays).reduce((result, moduleId) => {
      result[moduleId] = generatedTrainingDays[moduleId].length
      return result
    }, {})
  }

  return {
    generatedTrainingDays,
    generatedTrainingMeta
  }
}

function writeOutput(data) {
  const fileContent = [
    '// 由 scripts/build-training-data.js 根据 resources/training-source 下的 docx 生成。',
    '// 小程序运行时只读取本 JS 文件，不读取 docx。',
    '',
    `const generatedTrainingDays = ${JSON.stringify(data.generatedTrainingDays, null, 2)}`,
    '',
    `const generatedTrainingMeta = ${JSON.stringify(data.generatedTrainingMeta, null, 2)}`,
    '',
    'module.exports = {',
    '  generatedTrainingDays,',
    '  generatedTrainingMeta',
    '}',
    ''
  ].join('\n')

  fs.writeFileSync(OUTPUT_FILE, fileContent, 'utf8')
}

const data = buildAllData()
writeOutput(data)

console.log('生成训练数据完成：')
console.log(data.generatedTrainingMeta.counts)
