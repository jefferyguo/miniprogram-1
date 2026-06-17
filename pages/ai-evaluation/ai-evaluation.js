const RESULT_STORAGE_KEY = 'expressionTestResults'

const DIMENSIONS = [
  {
    key: 'confidence',
    label: '表达自信',
    shortLabel: '自信',
    profileType: '主动表达型',
    profileDesc: '你具备主动开口和持续表达的潜力，适合通过更多真实场景练习建立稳定的表达状态。',
    strengthText: '你在开口意愿和表达主动性上有基础，遇到表达任务时更容易进入状态。',
    suggestionText: '可以从短时话题表达开始，每天完成一次 60 秒表达，逐步降低紧张感。',
    recommendedTraining: '21天话题训练'
  },
  {
    key: 'structure',
    label: '逻辑结构',
    shortLabel: '结构',
    profileType: '结构清晰型',
    profileDesc: '你更重视表达的条理和重点，适合继续强化观点、原因、例子和总结的组织能力。',
    strengthText: '你比较容易抓住表达重点，也更愿意用结构帮助别人理解。',
    suggestionText: '建议练习复述和总结，把复杂内容压缩成清楚的三点表达。',
    recommendedTraining: '21天复述训练'
  },
  {
    key: 'fluency',
    label: '表达流畅',
    shortLabel: '流畅',
    profileType: '自然流畅型',
    profileDesc: '你在表达时比较看重自然度和连续性，适合通过朗读和复述提升稳定输出能力。',
    strengthText: '你具备较好的连续表达意识，日常沟通中更容易自然展开。',
    suggestionText: '可以用朗读和 30 秒复述训练降低卡顿，让嘴和思路更同步。',
    recommendedTraining: '21天朗读训练'
  },
  {
    key: 'voice',
    label: '声音状态',
    shortLabel: '声音',
    profileType: '声音感染型',
    profileDesc: '你对声音清晰度、气息和感染力比较敏感，适合继续训练朗读、停顿和普通话发音。',
    strengthText: '你已经开始关注声音是否清楚、有力量，这会直接影响表达的说服力。',
    suggestionText: '建议练习慢速朗读、停顿和气息控制，让声音更稳、更清楚。',
    recommendedTraining: '21天朗读训练 / 21天普通话训练'
  },
  {
    key: 'empathy',
    label: '共情沟通',
    shortLabel: '共情',
    profileType: '沟通共情型',
    profileDesc: '你比较关注听众感受和沟通氛围，适合在观点表达中加入更清楚的结构和行动建议。',
    strengthText: '你能注意到对方的感受，表达更容易让人愿意听下去。',
    suggestionText: '建议练习先回应对方，再表达观点，让共情和清晰表达同时出现。',
    recommendedTraining: '随机话题 / 21天话题训练'
  },
  {
    key: 'adaptability',
    label: '场景适应',
    shortLabel: '适应',
    profileType: '现场反应型',
    profileDesc: '你具备根据场景调整表达的意识，适合继续训练即兴表达和临场回应能力。',
    strengthText: '你会观察对象和场景，并尝试调整表达方式，现场适应力有潜力。',
    suggestionText: '可以多练随机话题和临场提问，训练快速组织观点的能力。',
    recommendedTraining: '随机话题 / 21天话题训练'
  }
]

const DIMENSION_LABEL_MAP = DIMENSIONS.reduce((map, item) => {
  map[item.key] = item.label
  return map
}, {})

const DIMENSION_KEYS = DIMENSIONS.map(item => item.key)

const SCALE_OPTIONS = [
  { label: '非常符合', value: 5 },
  { label: '比较符合', value: 4 },
  { label: '一般', value: 3 },
  { label: '不太符合', value: 2 },
  { label: '完全不符合', value: 1 }
]

const RECORD_TOPICS = [
  '请用一分钟介绍你自己。',
  '你认为一个人为什么需要练习表达？',
  '你最近一次克服紧张是什么时候？',
  '请分享一个你想提升的能力。',
  '你觉得会说话的人有什么特点？',
  '请谈谈你对自信的理解。',
  '如果让你推荐一本书或一部电影，你会怎么说？',
  '请讲一件让你有成就感的小事。',
  '你认为沟通中最重要的是什么？',
  '如果你要感谢一个帮助过你的人，你会怎么表达？'
]

const QUESTIONS = [
  { id: 1, dimension: 'confidence', subDimension: '自我感知', title: '在多人面前讲话时，我能比较快地进入表达状态。', reverse: false },
  { id: 2, dimension: 'confidence', subDimension: '开口意愿', title: '即使有些紧张，我也愿意尝试把话说出来。', reverse: false },
  { id: 3, dimension: 'confidence', subDimension: '行动意愿', title: '当需要临时发言时，我通常不会马上逃避。', reverse: false },
  { id: 4, dimension: 'confidence', subDimension: '观点表达', title: '我在表达观点时，能够比较坚定地说出自己的想法。', reverse: false },
  { id: 5, dimension: 'confidence', subDimension: '表达顾虑', title: '我常常担心自己说得不好，所以尽量少发言。', reverse: true },
  { id: 6, dimension: 'confidence', subDimension: '主动表达', title: '在课堂、会议或活动中，我愿意主动争取发言机会。', reverse: false },
  { id: 7, dimension: 'confidence', subDimension: '现场稳定', title: '当别人看着我说话时，我还能保持基本稳定。', reverse: false },
  { id: 8, dimension: 'structure', subDimension: '重点意识', title: '我说话前通常会先想清楚重点。', reverse: false },
  { id: 9, dimension: 'structure', subDimension: '顺序组织', title: '我表达观点时，会尽量按照一定顺序来说。', reverse: false },
  { id: 10, dimension: 'structure', subDimension: '结构框架', title: '我能够用“观点、原因、例子、总结”的方式组织表达。', reverse: false },
  { id: 11, dimension: 'structure', subDimension: '结构稳定', title: '我说话时容易想到哪里说到哪里。', reverse: true },
  { id: 12, dimension: 'structure', subDimension: '因果表达', title: '我能把一件事情的前因后果讲清楚。', reverse: false },
  { id: 13, dimension: 'structure', subDimension: '提炼能力', title: '当内容比较多时，我能提炼出几个关键点。', reverse: false },
  { id: 14, dimension: 'structure', subDimension: '结尾收束', title: '我表达结束时，通常能做一个简单收束。', reverse: false },
  { id: 15, dimension: 'fluency', subDimension: '连贯表达', title: '我说话时整体比较连贯，不容易长时间卡住。', reverse: false },
  { id: 16, dimension: 'fluency', subDimension: '即兴流畅', title: '即兴表达时，我能边想边说，保持基本流畅。', reverse: false },
  { id: 17, dimension: 'fluency', subDimension: '词语调取', title: '我经常因为找不到合适的词而中断表达。', reverse: true },
  { id: 18, dimension: 'fluency', subDimension: '复述能力', title: '我能够用自己的话复述一段内容。', reverse: false },
  { id: 19, dimension: 'fluency', subDimension: '语速控制', title: '我说话时语速基本稳定，不会忽快忽慢。', reverse: false },
  { id: 20, dimension: 'fluency', subDimension: '延展表达', title: '当别人追问时，我能继续补充说明。', reverse: false },
  { id: 21, dimension: 'fluency', subDimension: '完整表达', title: '我能在一分钟左右完整表达一个简单观点。', reverse: false },
  { id: 22, dimension: 'voice', subDimension: '清晰度', title: '我的声音通常能让别人听清楚。', reverse: false },
  { id: 23, dimension: 'voice', subDimension: '音量稳定', title: '我说话时音量比较稳定，不会明显忽大忽小。', reverse: false },
  { id: 24, dimension: 'voice', subDimension: '声音打开', title: '我在正式表达时，声音容易变小。', reverse: true },
  { id: 25, dimension: 'voice', subDimension: '停顿重音', title: '我朗读或讲话时，能注意停顿和重音。', reverse: false },
  { id: 26, dimension: 'voice', subDimension: '吐字清晰', title: '我说话时吐字比较清楚。', reverse: false },
  { id: 27, dimension: 'voice', subDimension: '声音感染', title: '我的声音能够传递一定的情绪和感染力。', reverse: false },
  { id: 28, dimension: 'empathy', subDimension: '听众意识', title: '和别人交流时，我会关注对方是否听懂。', reverse: false },
  { id: 29, dimension: 'empathy', subDimension: '倾听回应', title: '当别人表达不同意见时，我能先听完再回应。', reverse: false },
  { id: 30, dimension: 'empathy', subDimension: '情绪感知', title: '我会根据对方的感受调整自己的表达方式。', reverse: false },
  { id: 31, dimension: 'empathy', subDimension: '互动意识', title: '我表达时容易只顾自己说，不太注意对方反应。', reverse: true },
  { id: 32, dimension: 'empathy', subDimension: '情感表达', title: '我能够用比较真诚自然的方式表达感谢或歉意。', reverse: false },
  { id: 33, dimension: 'empathy', subDimension: '关系维护', title: '我在沟通中能够尽量避免让对方感到被否定。', reverse: false },
  { id: 34, dimension: 'empathy', subDimension: '双向沟通', title: '我能把自己的想法说清楚，也能照顾对方的立场。', reverse: false },
  { id: 35, dimension: 'adaptability', subDimension: '场合意识', title: '我能根据不同场合调整说话方式。', reverse: false },
  { id: 36, dimension: 'adaptability', subDimension: '临场反应', title: '面对突发提问时，我能先稳定下来再回答。', reverse: false },
  { id: 37, dimension: 'adaptability', subDimension: '表达调整', title: '如果听众反应不明显，我会尝试换一种说法。', reverse: false },
  { id: 38, dimension: 'adaptability', subDimension: '场景切换', title: '在正式、轻松、陌生等不同场景中，我都能找到合适的表达状态。', reverse: false },
  { id: 39, dimension: 'adaptability', subDimension: '抗干扰', title: '当表达被打断时，我容易忘记自己要说什么。', reverse: true },
  { id: 40, dimension: 'adaptability', subDimension: '时间控制', title: '我能根据时间限制，把内容说长或说短。', reverse: false }
].map(question => ({
  ...question,
  dimensionLabel: DIMENSION_LABEL_MAP[question.dimension]
}))

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatSeconds(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value))
}

function createDimensionStats() {
  return DIMENSIONS.reduce((stats, item) => {
    stats[item.key] = {
      total: 0,
      count: 0
    }
    return stats
  }, {})
}

function getScaleScore(value, reverse) {
  return reverse ? 6 - value : value
}

function getAnsweredCount(answers) {
  return answers.filter(item => item).length
}

function getTimeValue(item) {
  const value = item && item.createdAt
  if (!value) return 0

  if (typeof value === 'number') return value

  const date = new Date(String(value).replace(/-/g, '/'))
  return date.getTime() || 0
}

function getAverageScore(scores) {
  if (!scores) return 0

  const total = DIMENSION_KEYS.reduce((sum, key) => sum + Number(scores[key] || 0), 0)
  return Math.round(total / DIMENSION_KEYS.length)
}

function getTopDimension(scores) {
  if (!scores) return ''

  const topKey = DIMENSION_KEYS.reduce((bestKey, key) => {
    return Number(scores[key] || 0) > Number(scores[bestKey] || 0) ? key : bestKey
  }, DIMENSION_KEYS[0])

  return DIMENSION_LABEL_MAP[topKey]
}

function getLowDimension(scores) {
  if (!scores) return ''

  const lowKey = DIMENSION_KEYS.reduce((bestKey, key) => {
    return Number(scores[key] || 0) < Number(scores[bestKey] || 0) ? key : bestKey
  }, DIMENSION_KEYS[0])

  return DIMENSION_LABEL_MAP[lowKey]
}

function hydrateResult(item) {
  if (!item) return null

  const scores = item.scores || {}
  const scoreList = DIMENSIONS.map(dimension => ({
    ...dimension,
    score: Number(scores[dimension.key] || 0)
  })).sort((a, b) => b.score - a.score)

  return {
    ...item,
    scoreList: item.scoreList || scoreList,
    averageScore: item.averageScore || getAverageScore(scores),
    aiReport: item.aiReport || null,
    aiReportGenerated: !!item.aiReportGenerated,
    aiReportError: !!item.aiReportError,
    aiReportSource: item.aiReportSource || (item.aiReportError ? 'fallback' : ''),
    aiReportModel: item.aiReportModel || (item.aiReportError ? 'none' : '')
  }
}

function getSortedDimensions(scores) {
  const source = scores || {}

  return DIMENSIONS.map(item => ({
    ...item,
    score: Number(source[item.key] || 0)
  })).sort((a, b) => b.score - a.score)
}

function getShortModuleName(value) {
  return String(value || '21天话题训练').split('/')[0].trim().slice(0, 15)
}

function buildAnswersSummary(resultData) {
  const sorted = getSortedDimensions(resultData.scores)
  const top = sorted[0]
  const low = sorted[sorted.length - 1]

  return `最高维度：${top.label}${top.score}分；最低维度：${low.label}${low.score}分；综合分：${resultData.averageScore}分。`
}

function buildFallbackReport(resultData) {
  const sorted = getSortedDimensions(resultData.scores)
  const topTwo = sorted.slice(0, 2)
  const lowTwo = sorted.slice(-2).reverse()
  const lowest = lowTwo[0]
  const finishedRecording = resultData.recordingAnswer && !resultData.recordingAnswer.skipped

  return {
    summary: `你的表达画像偏向“${resultData.profileType}”。整体看，你已经具备一定表达基础，优势维度较清晰；接下来可以围绕${lowest.label}做短时高频练习，让表达更稳定、更自然。${finishedRecording ? '录音题也能帮助你观察真实表达状态。' : '后续可补充录音题，让结果更贴近真实表达。'}`,
    strengths: topTwo.map(item => `${item.label}表现较好，说明你在相关场景中已有可继续放大的表达基础。`),
    weaknesses: lowTwo.map(item => `${item.label}还有提升空间，建议先从小任务开始，降低练习压力。`),
    trainingAdvice: [
      `每天用 1 分钟完成一次${lowest.label}相关练习，先保持连续性。`,
      '表达前先写 3 个关键词，帮助自己抓住重点和顺序。',
      '练完后听回放，标记一次做得好的地方和一个改进点。'
    ],
    recommendedModule: getShortModuleName(lowest.recommendedTraining),
    encouragement: '完成测评就是第一步。'
  }
}

function normalizeAiReport(report, fallbackReport) {
  if (!report || typeof report !== 'object') return fallbackReport

  return {
    summary: report.summary || fallbackReport.summary,
    strengths: Array.isArray(report.strengths) && report.strengths.length > 0 ? report.strengths.slice(0, 2) : fallbackReport.strengths,
    weaknesses: Array.isArray(report.weaknesses) && report.weaknesses.length > 0 ? report.weaknesses.slice(0, 2) : fallbackReport.weaknesses,
    trainingAdvice: Array.isArray(report.trainingAdvice) && report.trainingAdvice.length > 0 ? report.trainingAdvice.slice(0, 3) : fallbackReport.trainingAdvice,
    recommendedModule: report.recommendedModule || fallbackReport.recommendedModule,
    encouragement: report.encouragement || fallbackReport.encouragement
  }
}

Page({
  data: {
    // step 控制测评流程：intro / question / record / result
    step: 'intro',
    introTags: ['5–7 分钟', '40 道量表题', '1 道可选录音题', '本地生成报告'],
    dimensions: DIMENSIONS,
    questions: QUESTIONS,
    scaleOptions: SCALE_OPTIONS,
    totalQuestions: QUESTIONS.length,
    currentIndex: 0,
    currentQuestion: QUESTIONS[0],
    answers: [],
    selectedValue: 0,
    answeredCount: 0,
    progressPercent: Math.round((1 / QUESTIONS.length) * 100),
    recordTopics: RECORD_TOPICS,
    currentRecordTopic: RECORD_TOPICS[0],
    isRecording: false,
    hasRecording: false,
    recordingSeconds: 0,
    recordingTimeText: '00:00',
    recordingAnswer: null,
    result: null,
    recordCount: 0,
    hasResultRecords: false,
    latestResult: null,
    latestAverageScore: 0,
    latestTopDimension: '',
    latestLowDimension: '',
    isGeneratingReport: false,
    aiReport: null,
    aiReportError: false
  },

  onShow() {
    this.loadResultRecords()
  },

  onUnload() {
    this.clearRecordTimer()
  },

  loadResultRecords() {
    const records = (wx.getStorageSync(RESULT_STORAGE_KEY) || [])
      .slice()
      .sort((a, b) => getTimeValue(b) - getTimeValue(a))
    const latestResult = hydrateResult(records[0])

    this.setData({
      recordCount: records.length,
      hasResultRecords: records.length > 0,
      latestResult,
      latestAverageScore: latestResult ? getAverageScore(latestResult.scores) : 0,
      latestTopDimension: latestResult ? getTopDimension(latestResult.scores) : '',
      latestLowDimension: latestResult ? getLowDimension(latestResult.scores) : ''
    })
  },

  startEvaluation() {
    this.clearRecordTimer()

    this.setData({
      step: 'question',
      currentIndex: 0,
      currentQuestion: QUESTIONS[0],
      answers: [],
      selectedValue: 0,
      answeredCount: 0,
      progressPercent: Math.round((1 / QUESTIONS.length) * 100),
      currentRecordTopic: this.pickRecordTopic(),
      isRecording: false,
      hasRecording: false,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      recordingAnswer: null,
      result: null,
      isGeneratingReport: false,
      aiReport: null,
      aiReportError: false
    })
  },

  selectScaleOption(e) {
    const value = Number(e.currentTarget.dataset.value)
    const question = QUESTIONS[this.data.currentIndex]
    const answers = this.data.answers.slice()

    answers[this.data.currentIndex] = {
      questionId: question.id,
      dimension: question.dimension,
      subDimension: question.subDimension,
      value,
      score: getScaleScore(value, question.reverse),
      reverse: question.reverse
    }

    this.setData({
      answers,
      selectedValue: value,
      answeredCount: getAnsweredCount(answers)
    })
  },

  goPrevQuestion() {
    if (this.data.currentIndex <= 0) return

    this.showQuestion(this.data.currentIndex - 1)
  },

  goNextQuestion() {
    if (!this.data.answers[this.data.currentIndex]) {
      wx.showToast({
        title: '请先选择一个答案',
        icon: 'none'
      })
      return
    }

    if (this.data.currentIndex >= QUESTIONS.length - 1) {
      this.enterRecordStep()
      return
    }

    this.showQuestion(this.data.currentIndex + 1)
  },

  showQuestion(index) {
    const answer = this.data.answers[index]

    this.setData({
      currentIndex: index,
      currentQuestion: QUESTIONS[index],
      selectedValue: answer ? answer.value : 0,
      progressPercent: Math.round(((index + 1) / QUESTIONS.length) * 100)
    })
  },

  enterRecordStep() {
    this.setData({
      step: 'record',
      currentRecordTopic: this.pickRecordTopic(),
      isRecording: false,
      hasRecording: false,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      recordingAnswer: null
    })
  },

  changeRecordTopic() {
    if (this.data.isRecording) {
      wx.showToast({
        title: '录音中不能换题',
        icon: 'none'
      })
      return
    }

    this.setData({
      currentRecordTopic: this.pickRecordTopic(this.data.currentRecordTopic),
      hasRecording: false,
      recordingAnswer: null,
      recordingSeconds: 0,
      recordingTimeText: '00:00'
    })
  },

  toggleRecording() {
    if (this.data.isRecording) {
      this.stopMockRecording()
      return
    }

    this.startMockRecording()
  },

  startMockRecording() {
    this.clearRecordTimer()

    this.setData({
      isRecording: true,
      hasRecording: false,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      recordingAnswer: null
    })

    this.recordTimer = setInterval(() => {
      const nextSeconds = this.data.recordingSeconds + 1
      this.setData({
        recordingSeconds: nextSeconds,
        recordingTimeText: formatSeconds(nextSeconds)
      })
    }, 1000)
  },

  stopMockRecording() {
    this.clearRecordTimer()

    const seconds = Math.max(this.data.recordingSeconds, 1)
    const recordingAnswer = {
      topic: this.data.currentRecordTopic,
      duration: seconds,
      durationText: formatSeconds(seconds),
      createdAt: formatDateTime(new Date()),
      filePath: '',
      skipped: false,
      mock: true
    }

    this.setData({
      isRecording: false,
      hasRecording: true,
      recordingSeconds: seconds,
      recordingTimeText: formatSeconds(seconds),
      recordingAnswer
    })

    wx.showToast({
      title: '录音已保存',
      icon: 'success'
    })
  },

  skipRecording() {
    this.clearRecordTimer()
    this.generateResult({
      skipped: true
    })
  },

  finishWithRecording() {
    if (this.data.isRecording) {
      wx.showToast({
        title: '请先停止录音',
        icon: 'none'
      })
      return
    }

    if (!this.data.hasRecording || !this.data.recordingAnswer) {
      wx.showToast({
        title: '请先录音或跳过',
        icon: 'none'
      })
      return
    }

    this.generateResult(this.data.recordingAnswer)
  },

  async generateResult(recordingAnswer) {
    const dimensionStats = createDimensionStats()

    this.data.answers.forEach(answer => {
      if (!answer || !dimensionStats[answer.dimension]) return

      dimensionStats[answer.dimension].total += answer.score
      dimensionStats[answer.dimension].count += 1
    })

    const scoreMap = DIMENSIONS.reduce((map, item) => {
      const stat = dimensionStats[item.key]
      const avg = stat.count > 0 ? stat.total / stat.count : 3
      let score = Math.round(((avg - 1) / 4) * 50 + 45)

      if (recordingAnswer && !recordingAnswer.skipped && (item.key === 'confidence' || item.key === 'fluency')) {
        score += 3
      }

      map[item.key] = clampScore(score)
      return map
    }, {})

    const scoreList = DIMENSIONS.map(item => ({
      ...item,
      score: scoreMap[item.key],
      rawTotal: dimensionStats[item.key].total,
      questionCount: dimensionStats[item.key].count
    })).sort((a, b) => b.score - a.score)

    const highest = scoreList[0]
    const lowest = scoreList[scoreList.length - 1]
    const strengths = scoreList.slice(0, 2).map(item => ({
      title: item.label,
      content: item.strengthText
    }))
    const suggestions = scoreList.slice(-2).reverse().map(item => ({
      title: item.label,
      content: item.suggestionText
    }))
    const recommendedTraining = lowest.recommendedTraining
    const averageScore = Math.round(scoreList.reduce((sum, item) => sum + item.score, 0) / scoreList.length)

    const result = {
      id: Date.now(),
      createdAt: formatDateTime(new Date()),
      answers: this.data.answers,
      recordingAnswer,
      scores: scoreMap,
      scoreList,
      averageScore,
      profileType: highest.profileType,
      profileDesc: highest.profileDesc,
      strengths,
      suggestions,
      recommendedTraining
    }

    result.answersSummary = buildAnswersSummary(result)
    const fallbackReport = buildFallbackReport(result)

    this.setData({
      step: 'result',
      isRecording: false,
      isGeneratingReport: true,
      aiReport: null,
      aiReportError: false,
      result: hydrateResult({
        ...result,
        aiReport: null,
        aiReportGenerated: false,
        aiReportError: false,
        aiReportSource: '',
        aiReportModel: ''
      })
    })

    let aiReport = fallbackReport
    let aiReportGenerated = false
    let aiReportError = false
    let aiReportSource = 'fallback'
    let aiReportModel = 'none'

    try {
      const res = await this.generateAiReport(result)
      aiReport = normalizeAiReport(res && res.result && res.result.report, fallbackReport)
      aiReportGenerated = !!(res && res.result && res.result.success)
      aiReportError = !aiReportGenerated
      aiReportSource = res && res.result && res.result.source ? res.result.source : (aiReportGenerated ? 'cloudbase-ai' : 'fallback')
      aiReportModel = res && res.result && res.result.model ? res.result.model : (aiReportGenerated ? '' : 'none')
    } catch (error) {
      console.log('generateAiReport failed', error)
      aiReport = fallbackReport
      aiReportGenerated = false
      aiReportError = true
      aiReportSource = 'fallback'
      aiReportModel = 'none'
    }

    const finalResult = hydrateResult({
      ...result,
      aiReport,
      aiReportGenerated,
      aiReportError,
      aiReportSource,
      aiReportModel
    })
    const savedResults = wx.getStorageSync(RESULT_STORAGE_KEY) || []
    const nextResults = [finalResult].concat(savedResults)
    wx.setStorageSync(RESULT_STORAGE_KEY, nextResults)

    this.setData({
      isGeneratingReport: false,
      aiReport,
      aiReportError,
      result: finalResult
    })

    this.loadResultRecords()
  },

  generateAiReport(resultData) {
    if (!wx.cloud || !wx.cloud.callFunction) {
      return Promise.reject(new Error('wx.cloud.callFunction unavailable'))
    }

    return wx.cloud.callFunction({
      name: 'generateExpressionReport',
      data: {
        scores: resultData.scores,
        profileType: resultData.profileType,
        profileDesc: resultData.profileDesc,
        answersSummary: resultData.answersSummary || '',
        recordingAnswer: resultData.recordingAnswer || null
      }
    })
  },

  openEvaluationRecords() {
    wx.navigateTo({
      url: '/pages/evaluation-records/evaluation-records'
    })
  },

  viewLatestResult() {
    if (!this.data.latestResult) return
    const result = hydrateResult(this.data.latestResult)

    this.setData({
      step: 'result',
      result,
      aiReport: result.aiReport || null,
      aiReportError: !!result.aiReportError,
      isGeneratingReport: false
    })
  },

  startRecommendedTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  },

  restartEvaluation() {
    this.clearRecordTimer()

    this.setData({
      step: 'intro',
      currentIndex: 0,
      currentQuestion: QUESTIONS[0],
      answers: [],
      selectedValue: 0,
      answeredCount: 0,
      progressPercent: Math.round((1 / QUESTIONS.length) * 100),
      currentRecordTopic: RECORD_TOPICS[0],
      isRecording: false,
      hasRecording: false,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      recordingAnswer: null,
      result: null,
      isGeneratingReport: false,
      aiReport: null,
      aiReportError: false
    })
  },

  pickRecordTopic(excludeTopic) {
    const topics = RECORD_TOPICS.filter(item => item !== excludeTopic)
    const source = topics.length > 0 ? topics : RECORD_TOPICS
    return source[Math.floor(Math.random() * source.length)]
  },

  clearRecordTimer() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer)
      this.recordTimer = null
    }
  }
})
