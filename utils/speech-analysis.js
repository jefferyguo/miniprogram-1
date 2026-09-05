const STRUCTURE_MARKERS = [
  '首先', '然后', '最后', '因为', '所以', '因此', '总之', '总结',
  '第一', '第二', '第三', '一方面', '另一方面', '例如', '举个例子'
]

const KEYWORD_STOP_CHARS = new Set('的了和是在我们你他她它一个也都就而与及或这那有为到得着'.split(''))

function normalizePlainText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[^一-鿿A-Za-z0-9]/g, '')
}

function buildKeywordSet(text) {
  const clean = normalizePlainText(text)
  const set = new Set()

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (!KEYWORD_STOP_CHARS.has(char)) set.add(char.toLowerCase())

    if (index < clean.length - 1) {
      const pair = clean.slice(index, index + 2).toLowerCase()
      if (!Array.from(pair).every(item => KEYWORD_STOP_CHARS.has(item))) {
        set.add(pair)
      }
    }
  }

  return set
}

function getContentMatchScore(transcript, material) {
  const transcriptSet = buildKeywordSet(transcript)
  const materialSet = buildKeywordSet(material)

  if (!transcriptSet.size || !materialSet.size) return null

  let matched = 0
  materialSet.forEach(item => {
    if (transcriptSet.has(item)) matched += 1
  })

  return Math.round((matched / materialSet.size) * 100)
}

function getContentMatchLevel(score) {
  if (score === null || score === undefined) return 'unknown'
  if (score >= 55) return 'high'
  if (score >= 25) return 'medium'
  return 'low'
}

function getRepetitionRiskLevel(transcript) {
  const clean = normalizePlainText(transcript)
  if (clean.length < 12) return clean.length ? 'low' : 'unknown'

  const pairCounts = {}
  let repeatedPairs = 0
  for (let index = 0; index < clean.length - 1; index += 1) {
    const pair = clean.slice(index, index + 2)
    pairCounts[pair] = Number(pairCounts[pair] || 0) + 1
  }

  Object.keys(pairCounts).forEach(pair => {
    if (pairCounts[pair] >= 3) repeatedPairs += pairCounts[pair] - 2
  })

  const sentences = String(transcript || '')
    .split(/[，。！？；,.!?;\n]/)
    .map(item => normalizePlainText(item))
    .filter(item => item.length >= 4)
  const sentenceCounts = {}
  sentences.forEach(item => {
    sentenceCounts[item] = Number(sentenceCounts[item] || 0) + 1
  })
  const repeatedSentence = Object.keys(sentenceCounts).some(item => sentenceCounts[item] >= 2)
  const ratio = repeatedPairs / Math.max(clean.length - 1, 1)

  if (repeatedSentence || ratio >= 0.2) return 'high'
  if (ratio >= 0.08) return 'medium'
  return 'low'
}

function getStructureLevel(transcript, isStructuredTraining) {
  if (!isStructuredTraining) return 'unknown'

  const text = String(transcript || '')
  if (normalizePlainText(text).length < 12) return 'weak'

  const markerCount = STRUCTURE_MARKERS.reduce((count, marker) => (
    text.indexOf(marker) > -1 ? count + 1 : count
  ), 0)

  if (markerCount >= 3) return 'clear'
  if (markerCount >= 1) return 'basic'
  return 'weak'
}

function buildOverallRuleScore(analysis) {
  if (analysis.possibleEmptyRecording) return 5

  let score = 78
  if (analysis.contentMatchLevel === 'high') score += 8
  if (analysis.contentMatchLevel === 'low') score -= 18
  if (analysis.possibleOffTopic) score -= 15
  if (analysis.possibleIncomplete) score -= 15
  if (analysis.repetitionRiskLevel === 'high') score -= 12
  if (analysis.repetitionRiskLevel === 'medium') score -= 5
  if (analysis.structureLevel === 'clear') score += 6
  if (analysis.structureLevel === 'weak') score -= 8

  return Math.max(0, Math.min(100, Math.round(score)))
}

function buildRuleTags(analysis) {
  const tags = []
  const matchMap = {
    high: '内容匹配较高',
    medium: '内容基本匹配',
    low: '内容匹配偏低'
  }
  const structureMap = {
    clear: '结构较清楚',
    basic: '有基本结构',
    weak: '结构可再加强'
  }

  if (matchMap[analysis.contentMatchLevel]) tags.push(matchMap[analysis.contentMatchLevel])
  if (structureMap[analysis.structureLevel]) tags.push(structureMap[analysis.structureLevel])
  if (analysis.repetitionRiskLevel === 'high') tags.push('重复风险较高')
  if (analysis.possibleIncomplete) tags.push('内容可能不完整')
  if (analysis.possibleOffTopic) tags.push('内容可能偏题')
  if (analysis.possibleEmptyRecording) tags.unshift('未识别到有效表达')

  return Array.from(new Set(tags)).slice(0, 6)
}

function buildRuleSummary(analysis) {
  if (analysis.possibleEmptyRecording) {
    return '未识别到足够的有效表达内容，建议检查麦克风后重新完整录制。'
  }

  const summary = analysis.ruleTags.length
    ? analysis.ruleTags.join('，')
    : '已完成一次有效训练记录'

  return `${summary}。规则参考分${analysis.overallRuleScore}分。`.slice(0, 80)
}

// 规则指标只用于训练参考，不作为考试或医学结论。
function analyzeSpeechForTraining(input = {}) {
  const transcript = String(input.transcript || '')
  const effectiveText = normalizePlainText(transcript)
  const transcriptLength = transcript.trim().length
  const effectiveTextLength = effectiveText.length
  const moduleText = `${input.moduleId || ''} ${input.moduleTitle || ''} ${input.taskTitle || ''}`
  const isReading = input.moduleId === 'reading' || moduleText.indexOf('朗读') > -1 || moduleText.indexOf('朗诵') > -1
  const isMandarin = input.moduleId === 'mandarin' || moduleText.indexOf('普通话') > -1
  const isRetell = input.moduleId === 'retell' || moduleText.indexOf('复述') > -1
  const isTopic = input.moduleId === 'topic' || moduleText.indexOf('话题') > -1 || input.extraType === 'randomTopic'
  const referenceText = input.materialText || input.material || input.materialSummary || input.taskTitle || ''
  const shouldMatchContent = isReading || isMandarin || isRetell || isTopic
  const contentMatchScore = shouldMatchContent
    ? getContentMatchScore(transcript, referenceText)
    : null
  const contentMatchLevel = getContentMatchLevel(contentMatchScore)
  const possibleEmptyRecording = effectiveTextLength < 8
  const possibleOffTopic = Boolean(isTopic && effectiveTextLength >= 20 && contentMatchLevel === 'low')
  const possibleIncomplete = Boolean(
    (isReading || isMandarin || isRetell) &&
    (effectiveTextLength < 20 || (contentMatchLevel === 'low' && effectiveTextLength < 80))
  )
  const repetitionRiskLevel = getRepetitionRiskLevel(transcript)
  const structureLevel = getStructureLevel(transcript, isTopic || isRetell)
  const baseAnalysis = {
    transcriptLength,
    effectiveTextLength,
    contentMatchScore,
    contentMatchLevel,
    possibleEmptyRecording,
    possibleOffTopic,
    possibleIncomplete,
    repetitionRiskLevel,
    structureLevel
  }
  const overallRuleScore = buildOverallRuleScore(baseAnalysis)
  const analysisWithScore = {
    ...baseAnalysis,
    overallRuleScore
  }
  const ruleTags = buildRuleTags(analysisWithScore)
  const ruleSummary = buildRuleSummary({
    ...analysisWithScore,
    ruleTags
  })
  const analysisNotes = []

  if (possibleEmptyRecording) analysisNotes.push('未识别到足够的有效表达文字。')
  if (possibleIncomplete) analysisNotes.push('内容可能未完整覆盖训练材料。')
  if (possibleOffTopic) analysisNotes.push('内容与题目关键词匹配偏低，建议检查是否围绕主题。')

  return {
    ...analysisWithScore,
    ruleTags,
    ruleSummary,
    // 保留旧版字段，避免已有 AI v4 展示逻辑失效。
    isEmptySpeech: possibleEmptyRecording,
    analysisNotes
  }
}

module.exports = {
  analyzeSpeechForTraining,
  normalizePlainText
}
