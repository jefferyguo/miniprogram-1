'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { analyzeSpeechForTraining } = require('./speech-analysis')
const { analyzeSpeechForTraining: analyzeClientSpeech } = require('../../utils/speech-analysis')
const {
  hasDurationEvaluation,
  sanitizeDurationEvaluationText,
  sanitizeDurationEvaluationList
} = require('./duration-feedback-policy')

const ROOT = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const TRANSCRIPT = '首先我认为持续练习非常重要，因为表达能力来自一次次真实尝试。其次我们要及时复盘，找到内容重复和结构松散的地方。最后把观点说清楚，并用具体例子支持自己的判断。'
const TYPES = [
  ['reading', '朗诵训练'],
  ['retelling', '复述训练'],
  ['topic', '即兴话题'],
  ['speech', '演讲训练'],
  ['mandarin', '普通话训练'],
  ['leaderSpeech', '领导发言'],
  ['hosting', '主持训练'],
  ['other', '其他训练']
]

test('30 秒到 10 分钟作品使用完全相同的规则评分', () => {
  const durations = [30, 60, 120, 300, 600]
  const results = durations.map(durationSeconds => analyzeSpeechForTraining({
    transcript: TRANSCRIPT,
    durationSeconds,
    targetSeconds: 60,
    moduleId: 'topic',
    moduleTitle: '即兴话题',
    taskTitle: '坚持的意义'
  }))

  results.slice(1).forEach(result => {
    assert.equal(result.overallRuleScore, results[0].overallRuleScore)
    assert.deepEqual(result.ruleTags, results[0].ruleTags)
    assert.equal(result.ruleSummary, results[0].ruleSummary)
  })
  results.forEach(result => {
    assert.equal(Object.hasOwn(result, 'durationLevel'), false)
    assert.equal(Object.hasOwn(result, 'durationSeconds'), false)
    assert.equal(Object.hasOwn(result, 'targetSeconds'), false)
    assert.equal(Object.hasOwn(result, 'speechRate'), false)
    assert.equal(Object.hasOwn(result, 'speechRateLevel'), false)
    assert.doesNotMatch(`${result.ruleTags.join(' ')} ${result.ruleSummary}`, /时长|分钟|秒/)
  })
})

test('内容重复仍按内容评价，不转化为时长建议', () => {
  const result = analyzeSpeechForTraining({
    transcript: '我的观点很重要。我的观点很重要。我的观点很重要。接下来我会说明原因。',
    durationSeconds: 600,
    targetSeconds: 60,
    moduleId: 'topic'
  })
  assert.equal(result.repetitionRiskLevel, 'high')
  assert.match(result.ruleTags.join(' '), /重复/)
  assert.doesNotMatch(`${result.ruleTags.join(' ')} ${result.ruleSummary}`, /时长|分钟|秒|压缩|缩短/)
})

test('所有训练类型继承无时长点评规则', () => {
  TYPES.forEach(([moduleId, moduleTitle]) => {
    const short = analyzeSpeechForTraining({ transcript: TRANSCRIPT, durationSeconds: 30, targetSeconds: 60, moduleId, moduleTitle })
    const long = analyzeSpeechForTraining({ transcript: TRANSCRIPT, durationSeconds: 600, targetSeconds: 60, moduleId, moduleTitle })
    assert.equal(short.overallRuleScore, long.overallRuleScore, moduleTitle)
    assert.deepEqual(short.ruleTags, long.ruleTags, moduleTitle)
  })
})

test('客户端兼容分析层同样不按 duration 评分', () => {
  const short = analyzeClientSpeech({ transcript: TRANSCRIPT, durationSeconds: 30, targetSeconds: 60, moduleId: 'speech' })
  const long = analyzeClientSpeech({ transcript: TRANSCRIPT, durationSeconds: 600, targetSeconds: 60, moduleId: 'speech' })
  assert.equal(short.overallRuleScore, long.overallRuleScore)
  assert.deepEqual(short.ruleTags, long.ruleTags)
  assert.equal(Object.hasOwn(short, 'durationSeconds'), false)
  assert.equal(Object.hasOwn(short, 'speechRate'), false)
})

test('AI prompt 根部禁止时长评价且不发送 duration 字段', () => {
  const feedbackSource = read('cloudfunctions/generateTrainingFeedback/index.js')
  const reportSource = read('cloudfunctions/generateExpressionReport/index.js')
  const clientSource = read('utils/ai-feedback.js')

  assert.match(feedbackSource, /最高优先级[\s\S]*不得评价[^\n]*时长/)
  assert.match(reportSource, /最高优先级[\s\S]*不得评价[^\n]*时长/)
  assert.doesNotMatch(feedbackSource, /结合真实 transcript、训练时长/)
  const promptStart = feedbackSource.indexOf('function buildPrompt')
  const promptEnd = feedbackSource.indexOf('function estimateTokenCount', promptStart)
  const promptBuilder = feedbackSource.slice(promptStart, promptEnd)
  assert.doesNotMatch(promptBuilder, /durationSeconds:|targetSeconds:|durationLevel:|speechRate:/)
  assert.doesNotMatch(clientSource, /duration_too_short|MIN_AI_FEEDBACK_DURATION_SECONDS/)
})

test('输出守卫覆盖具体秒数、分钟和时长建议', () => {
  const feedbackSource = read('cloudfunctions/generateTrainingFeedback/index.js')
  const reportSource = read('cloudfunctions/generateExpressionReport/index.js')
  ;['60秒', '1分钟', '90秒', '时长略长', '压缩到', '缩短表达时间', '延长时间'].forEach(text => {
    assert.match(feedbackSource, /sanitizeDurationEvaluation|DURATION_EVALUATION/, text)
    assert.match(reportSource, /sanitizeDurationEvaluation|DURATION_EVALUATION/, text)
  })

  const unsafe = [
    '内容有些长，建议压缩到60秒。',
    '时长略长，可以控制在1分钟以内。',
    '建议延长时间到90秒。',
    '整体过短，可以再讲几分钟。'
  ]
  unsafe.forEach(text => {
    assert.equal(hasDurationEvaluation(text), true, text)
    assert.equal(sanitizeDurationEvaluationText(text), '', text)
  })
  assert.equal(
    sanitizeDurationEvaluationText('第二部分与前面的观点重复，可以合并，使主线更集中。'),
    '第二部分与前面的观点重复，可以合并，使主线更集中。'
  )
  assert.deepEqual(
    sanitizeDurationEvaluationList(['观点清晰。', '建议压缩到60秒。']),
    ['观点清晰。']
  )
})
