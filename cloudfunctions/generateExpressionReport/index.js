const cloud = require('wx-server-sdk')
const MODEL = process.env.CLOUDBASE_AI_MODEL || 'qwen3.5-flash'

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const DIMENSIONS = [
  { key: 'confidence', label: '表达自信', recommendedModule: '21天话题训练' },
  { key: 'structure', label: '逻辑结构', recommendedModule: '21天复述训练' },
  { key: 'fluency', label: '表达流畅', recommendedModule: '21天朗读训练' },
  { key: 'voice', label: '声音状态', recommendedModule: '21天朗读训练' },
  { key: 'empathy', label: '共情沟通', recommendedModule: '随机话题训练' },
  { key: 'adaptability', label: '场景适应', recommendedModule: '随机话题训练' }
]

function getSortedDimensions(scores) {
  const source = scores || {}

  return DIMENSIONS.map(item => ({
    ...item,
    score: Number(source[item.key] || 0)
  })).sort((a, b) => b.score - a.score)
}

function getShortModuleName(value) {
  return String(value || '21天话题训练').slice(0, 15)
}

function buildFallbackReport(data) {
  const sorted = getSortedDimensions(data.scores)
  const topTwo = sorted.slice(0, 2)
  const lowTwo = sorted.slice(-2).reverse()
  const lowest = lowTwo[0]

  return {
    summary: `你的表达画像偏向“${data.profileType || '表达成长型'}”。目前已有一定表达基础，优势维度可以继续放大；接下来建议重点练习${lowest.label}，用短时、多次、可复盘的方式，让表达更稳定。`,
    strengths: topTwo.map(item => `${item.label}表现较好，说明你已经有可继续巩固的表达基础。`),
    weaknesses: lowTwo.map(item => `${item.label}还有提升空间，可以先从简单场景开始练习。`),
    trainingAdvice: [
      `每天用 1 分钟练一次${lowest.label}相关任务。`,
      '表达前先写 3 个关键词，帮助自己抓住重点。',
      '练完后听一次回放，只改一个最明显的问题。'
    ],
    recommendedModule: getShortModuleName(lowest.recommendedModule),
    encouragement: '完成测评就是第一步。'
  }
}

function normalizeReport(report, fallbackReport) {
  if (!report || typeof report !== 'object') return fallbackReport

  return {
    summary: report.summary || fallbackReport.summary,
    strengths: Array.isArray(report.strengths) && report.strengths.length > 0 ? report.strengths.slice(0, 2) : fallbackReport.strengths,
    weaknesses: Array.isArray(report.weaknesses) && report.weaknesses.length > 0 ? report.weaknesses.slice(0, 2) : fallbackReport.weaknesses,
    trainingAdvice: Array.isArray(report.trainingAdvice) && report.trainingAdvice.length > 0 ? report.trainingAdvice.slice(0, 3) : fallbackReport.trainingAdvice,
    recommendedModule: report.recommendedModule ? String(report.recommendedModule).slice(0, 15) : fallbackReport.recommendedModule,
    encouragement: report.encouragement ? String(report.encouragement).slice(0, 20) : fallbackReport.encouragement
  }
}

function getRecordingStatus(recordingAnswer) {
  if (!recordingAnswer || recordingAnswer.skipped) return '未完成录音题'
  return '已完成录音题'
}

function buildPrompt(data) {
  const scores = data.scores || {}
  const recordingAnswer = data.recordingAnswer || {}
  const recordingStatus = getRecordingStatus(recordingAnswer)
  const recordTopic = recordingAnswer.topic || '无'

  return `你是一名专业口才训练教练，请根据用户的表达力测评数据，生成一份简短、温和、具体、可执行的表达训练报告。

要求：
1. 不做心理诊断。
2. 不做医学判断。
3. 不夸大 AI 能力。
4. 只围绕表达训练、声音状态、表达流畅度、逻辑结构、自信表达和沟通适应给建议。
5. 语言要像老师对学员说话，具体、鼓励、有方向。
6. 总体报告控制在 180–260 字左右。
7. 输出必须是 JSON，不要输出 markdown，不要添加解释文字。

用户数据：
表达画像：${data.profileType || ''}
画像说明：${data.profileDesc || ''}
六维分数：
- 表达自信：${scores.confidence || 0}
- 逻辑结构：${scores.structure || 0}
- 表达流畅：${scores.fluency || 0}
- 声音状态：${scores.voice || 0}
- 共情沟通：${scores.empathy || 0}
- 场景适应：${scores.adaptability || 0}
答题摘要：${data.answersSummary || ''}
是否完成录音题：${recordingStatus}
录音题话题：${recordTopic}

请严格输出 JSON：
{
  "summary": "80到120字总体评价",
  "strengths": ["20到40字优势1", "20到40字优势2"],
  "weaknesses": ["20到40字提升点1", "20到40字提升点2"],
  "trainingAdvice": ["20到40字建议1", "20到40字建议2", "20到40字建议3"],
  "recommendedModule": "15字以内推荐训练模块",
  "encouragement": "20字以内鼓励语"
}`
}

function getCloudBaseAIModel() {
  // 兼容 wx-server-sdk 不同版本的云开发 AI 扩展入口。
  if (typeof cloud.ai === 'function') {
    const ai = cloud.ai()
    if (ai && typeof ai.createModel === 'function') {
      return ai.createModel('cloudbase')
    }
  }

  if (cloud.ai && typeof cloud.ai.createModel === 'function') {
    return cloud.ai.createModel('cloudbase')
  }

  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    return cloud.extend.AI.createModel('cloudbase')
  }

  throw new Error('CloudBase AI SDK is unavailable')
}

function getAIResponseText(response) {
  if (!response) return ''
  if (typeof response === 'string') return response
  if (response.text) return response.text
  if (response.output_text) return response.output_text

  const candidates = [
    response.choices,
    response.data && response.data.choices,
    response.result && response.result.choices,
    response.rawResponse && response.rawResponse.choices
  ].filter(Boolean)

  for (const choices of candidates) {
    const content = choices && choices[0] && choices[0].message && choices[0].message.content
    if (content) return content
  }

  if (Array.isArray(response.rawResponses)) {
    for (const item of response.rawResponses) {
      const content = item && item.choices && item.choices[0] && item.choices[0].message && item.choices[0].message.content
      if (content) return content
    }
  }

  return ''
}

async function callCloudBaseAI(prompt) {
  const model = getCloudBaseAIModel()
  const messages = [
    {
      role: 'user',
      content: prompt
    }
  ]

  try {
    const response = await model.generateText({
      model: MODEL,
      messages
    })
    const text = getAIResponseText(response)
    if (text) return text
  } catch (error) {
    console.log('cloudbase ai direct generateText failed, retry with data wrapper', error)
  }

  const response = await model.generateText({
    data: {
      model: MODEL,
      messages
    }
  })

  return getAIResponseText(response)
}

function parseJsonOutput(outputText) {
  const text = String(outputText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  if (!text) {
    throw new Error('empty AI response')
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      return JSON.parse(match[0])
    }
    throw error
  }
}

exports.main = async event => {
  const data = {
    scores: event.scores || {},
    profileType: event.profileType || '',
    profileDesc: event.profileDesc || '',
    answersSummary: event.answersSummary || '',
    recordingAnswer: event.recordingAnswer || null
  }
  const fallbackReport = buildFallbackReport(data)

  try {
    const outputText = await callCloudBaseAI(buildPrompt(data))
    const report = normalizeReport(parseJsonOutput(outputText), fallbackReport)

    return {
      success: true,
      report,
      model: MODEL,
      source: 'cloudbase-ai'
    }
  } catch (error) {
    console.log('generateExpressionReport cloudbase ai failed', error)

    return {
      success: false,
      fallback: true,
      report: fallbackReport,
      model: 'none',
      source: 'fallback',
      message: 'AI报告暂不可用，已生成基础报告'
    }
  }
}
