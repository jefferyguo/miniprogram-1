const cloud = require('wx-server-sdk')
const MODEL = process.env.CLOUDBASE_AI_MODEL || 'qwen3.5-flash'

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function normalizeFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object') return null

  const summary = String(feedback.summary || '').trim()

  if (!summary) return null

  return {
    summary,
    highlights: Array.isArray(feedback.highlights) ? feedback.highlights.slice(0, 2) : [],
    improvements: Array.isArray(feedback.improvements) ? feedback.improvements.slice(0, 2) : [],
    suggestions: Array.isArray(feedback.suggestions) ? feedback.suggestions.slice(0, 3) : [],
    score: Math.max(0, Math.min(100, Number(feedback.score || 0))),
    level: String(feedback.level || '').trim()
  }
}

function buildPrompt(submission) {
  const sourceType = submission.sourceType === 'extra' ? '额外训练' : '主训练'
  const workType = submission.workType === 'video' ? '录像作品' : '录音作品'

  return `你是一名专业口才训练老师，请根据学员提交的训练作品信息，生成简短、温和、具体的表达训练点评。

要求：
1. 不做医学诊断。
2. 不做心理诊断。
3. 不夸大 AI 能力。
4. 第一版没有真实语音识别，只能基于训练任务、训练材料摘要、作品类型、提交时长和提交信息给建议。
5. 不要假装已经听到声音，不要写“你的语速是多少”“你停顿几次”“口头禅出现几次”等无法得出的结论。
6. 语言像老师点评学生，鼓励但不空泛。
7. 总字数控制在 160–240 字。
8. 输出必须是 JSON，不要输出 markdown，不要添加解释文字。

作品信息：
来源：${sourceType}
模块：${submission.moduleTitle || ''}
Day：${submission.day || ''}
任务：${submission.taskTitle || ''}
训练要求：${submission.requirement || ''}
训练材料摘要：${submission.materialSummary || ''}
作品类型：${workType}
时长：${submission.durationSeconds || 0} 秒
目标时长：${submission.targetSeconds || 0} 秒
最低点评时长：${submission.minRequiredSeconds || 0} 秒
班级：${submission.className || '未加入班级'}
提交时间：${submission.createdAt || ''}

请严格输出 JSON：
{
  "summary": "",
  "highlights": [],
  "improvements": [],
  "suggestions": [],
  "score": 0,
  "level": ""
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
  const submission = event.submission || {}

  try {
    const outputText = await callCloudBaseAI(buildPrompt(submission))
    const feedback = normalizeFeedback(parseJsonOutput(outputText))

    if (!feedback) {
      throw new Error('invalid feedback payload')
    }

    return {
      success: true,
      feedback,
      source: 'cloudbase-ai',
      model: MODEL
    }
  } catch (error) {
    console.log('generateTrainingFeedback cloudbase ai failed', error)

    return {
      success: false,
      error: true,
      message: 'AI反馈生成失败',
      source: 'none',
      model: 'none'
    }
  }
}
