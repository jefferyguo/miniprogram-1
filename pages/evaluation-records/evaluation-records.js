const RESULT_STORAGE_KEY = 'expressionTestResults'
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')

const DIMENSIONS = [
  { key: 'confidence', label: '表达自信' },
  { key: 'structure', label: '逻辑结构' },
  { key: 'fluency', label: '表达流畅' },
  { key: 'voice', label: '声音状态' },
  { key: 'empathy', label: '共情沟通' },
  { key: 'adaptability', label: '场景适应' }
]

function getTimeValue(item) {
  const value = item && item.createdAt
  if (!value) return 0
  if (typeof value === 'number') return value

  const date = new Date(String(value).replace(/-/g, '/'))
  return date.getTime() || 0
}

function formatCreatedAt(value) {
  if (!value) return '暂无时间'
  if (typeof value !== 'number') return value

  const date = new Date(value)
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getAverageScore(scores) {
  if (!scores) return 0

  const total = DIMENSIONS.reduce((sum, item) => sum + Number(scores[item.key] || 0), 0)
  return Math.round(total / DIMENSIONS.length)
}

function getTopDimension(scores) {
  if (!scores) return ''

  const target = DIMENSIONS.reduce((best, item) => {
    return Number(scores[item.key] || 0) > Number(scores[best.key] || 0) ? item : best
  }, DIMENSIONS[0])

  return target.label
}

function getLowDimension(scores) {
  if (!scores) return ''

  const target = DIMENSIONS.reduce((best, item) => {
    return Number(scores[item.key] || 0) < Number(scores[best.key] || 0) ? item : best
  }, DIMENSIONS[0])

  return target.label
}

function getScoreList(scores) {
  const source = scores || {}

  return DIMENSIONS.map(item => ({
    ...item,
    score: Number(source[item.key] || 0)
  }))
}

function getRecordingStatus(recordingAnswer) {
  if (!recordingAnswer || recordingAnswer.skipped) return '未录音'
  return '已录音'
}

function formatResult(item) {
  return {
    ...item,
    displayAverageScore: getAverageScore(item.scores),
    displayTopDimension: getTopDimension(item.scores),
    displayLowDimension: getLowDimension(item.scores),
    displayRecordingStatus: getRecordingStatus(item.recordingAnswer),
    displayCreatedAt: formatCreatedAt(item.createdAt),
    displayScoreList: getScoreList(item.scores),
    displayAiReportSource: item.aiReportSource === 'cloudbase-ai' ? '云开发 AI' : '基础报告',
    displayAiReportModel: item.aiReportModel || '',
    displayRecordingDuration: item.recordingAnswer && !item.recordingAnswer.skipped
      ? (item.recordingAnswer.durationText || `${item.recordingAnswer.duration || 0}秒`)
      : ''
  }
}

Page({
  data: {
    mode: 'list',
    results: [],
    hasResults: false,
    selectedResult: null,
    recordCount: 0,
    latestCreatedAt: '暂无',
    latestProfileType: '暂无'
  },

  onShow() {
    enableShareMenu()
    this.loadResults()
  },

  loadResults() {
    const results = (wx.getStorageSync(RESULT_STORAGE_KEY) || [])
      .slice()
      .sort((a, b) => getTimeValue(b) - getTimeValue(a))
      .map(formatResult)
    const latest = results[0]

    this.setData({
      results,
      hasResults: results.length > 0,
      recordCount: results.length,
      latestCreatedAt: latest ? latest.displayCreatedAt : '暂无',
      latestProfileType: latest ? latest.profileType : '暂无'
    })
  },

  viewResult(e) {
    const id = String(e.currentTarget.dataset.id)
    const selectedResult = this.data.results.find(item => String(item.id) === id)

    if (!selectedResult) {
      wx.showToast({
        title: '记录不存在',
        icon: 'none'
      })
      return
    }

    this.setData({
      mode: 'detail',
      selectedResult
    })
  },

  backToList() {
    this.setData({
      mode: 'list',
      selectedResult: null
    })
  },

  deleteResult(e) {
    const id = String(e.currentTarget.dataset.id)

    wx.showModal({
      title: '删除测评记录',
      content: '删除后无法恢复，确定删除这条测评记录吗？',
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: res => {
        if (!res.confirm) return

        const nextResults = (wx.getStorageSync(RESULT_STORAGE_KEY) || [])
          .filter(item => String(item.id) !== id)
        wx.setStorageSync(RESULT_STORAGE_KEY, nextResults)

        this.loadResults()
        this.setData({
          mode: 'list',
          selectedResult: null
        })

        wx.showToast({
          title: '已删除',
          icon: 'success'
        })
      }
    })
  },

  goEvaluation() {
    wx.navigateTo({
      url: '/pages/ai-evaluation/ai-evaluation'
    })
  },

  onShareAppMessage() {
    // 不分享当前用户的分数和报告，只邀请好友进入测评入口。
    return getDefaultShareMessage({
      title: '表达力测评｜测一测你的表达状态',
      path: '/pages/ai-evaluation/ai-evaluation?source=share',
      imageUrl: getShareImage('assessment')
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '表达力测评｜测一测你的表达状态',
      targetPage: 'ai-evaluation',
      imageUrl: getShareImage('assessment')
    })
  }
})
