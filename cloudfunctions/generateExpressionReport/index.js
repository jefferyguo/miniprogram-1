const cloud = require('wx-server-sdk')
const MODEL = process.env.CLOUDBASE_AI_MODEL || 'hy3-preview'

// CloudBase 控制台中建议将 generateExpressionReport 执行超时设置为 60 秒。
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000
})

const db = cloud.database()

async function hasBoundPhone() {
  try {
    const openid = cloud.getWXContext().OPENID || ''
    if (!openid) return false
    const res = await db.collection('users').where({ openid, phoneBound: true }).limit(1).get()
    const user = res.data && res.data[0]
    return Boolean(user && /^1\d{10}$/.test(String(user.phone || '')))
  } catch (error) {
    console.warn('[generateExpressionReport] phone binding check failed:', error.message)
    return false
  }
}

function normalizeReport(report) {
  if (!report || typeof report !== 'object') return null

  const summary = String(report.summary || '').trim()
  if (!summary) return null

  return {
    summary,
    strengths: Array.isArray(report.strengths) ? report.strengths.slice(0, 2) : [],
    weaknesses: Array.isArray(report.weaknesses) ? report.weaknesses.slice(0, 2) : [],
    trainingAdvice: Array.isArray(report.trainingAdvice) ? report.trainingAdvice.slice(0, 3) : [],
    recommendedModule: report.recommendedModule ? String(report.recommendedModule).slice(0, 15) : '',
    encouragement: report.encouragement ? String(report.encouragement).slice(0, 20) : ''
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

function getAIResponseText(response) {
  if (!response) return ''
  if (typeof response === 'string') return response
  if (response.text) return response.text
  if (response.content) return response.content
  if (response.output_text) return response.output_text
  if (response.data && typeof response.data === 'string') return response.data
  if (response.data && response.data.text) return response.data.text
  if (response.data && response.data.content) return response.data.content
  if (response.data && response.data.output_text) return response.data.output_text
  if (response.result && typeof response.result === 'string') return response.result
  if (response.result && response.result.text) return response.result.text
  if (response.result && response.result.content) return response.result.content
  if (response.result && response.result.output_text) return response.result.output_text

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
  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')
  const messages = [
    {
      role: 'user',
      content: prompt
    }
  ]

  const result = await model.generateText({
    model: MODEL,
    messages
  })

  console.log('[generateExpressionReport] ai result raw:', result)
  console.log('[generateExpressionReport] cloudbase ai result:', {
    type: typeof result,
    hasText: Boolean(getAIResponseText(result)),
    hasUsage: Boolean(result && result.usage)
  })

  return {
    text: getAIResponseText(result),
    usage: result && result.usage ? result.usage : null
  }
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
  if (!(await hasBoundPhone())) {
    return {
      success: false,
      error: true,
      source: 'none',
      model: 'none',
      message: '生成表达力测评报告需要先绑定手机号。',
      debugCode: 'phone_required'
    }
  }

  console.log('[generateExpressionReport] start')
  console.log('[generateExpressionReport] model:', MODEL)

  const data = {
    scores: event.scores || {},
    profileType: event.profileType || '',
    profileDesc: event.profileDesc || '',
    answersSummary: event.answersSummary || '',
    recordingAnswer: event.recordingAnswer || null
  }
  const payloadSummary = {
    profileType: data.profileType,
    hasScores: Boolean(data.scores),
    hasAnswersSummary: Boolean(data.answersSummary),
    hasRecordingAnswer: Boolean(data.recordingAnswer)
  }
  console.log('[generateExpressionReport] payload summary:', payloadSummary)

  try {
    const aiResult = await callCloudBaseAI(buildPrompt(data))
    const report = normalizeReport(parseJsonOutput(aiResult.text))

    if (!report) {
      throw new Error('invalid report payload')
    }

    return {
      success: true,
      report,
      model: MODEL,
      source: 'cloudbase-ai',
      usage: aiResult.usage
    }
  } catch (error) {
    console.error('[generateExpressionReport] error:', error)

    return {
      success: false,
      error: true,
      model: 'none',
      source: 'none',
      message: error.message || 'AI报告生成失败',
      debugCode: error.code || error.errCode || error.name || 'generate_expression_report_failed'
    }
  }
}
