Page({
  data: {
    // 第一版仅做本地反馈交互，不接后端
    feedbackText: '',
    questions: [
      '如何开始一次训练？',
      '录音或录像保存在哪里？',
      '为什么提交后还没有点评？',
      '如何查看成长记录？'
    ]
  },

  handleQuestionTap() {
    wx.showToast({
      title: '功能开发中',
      icon: 'none'
    })
  },

  onFeedbackInput(e) {
    this.setData({
      feedbackText: e.detail.value
    })
  },

  submitFeedback() {
    if (!this.data.feedbackText.trim()) {
      wx.showToast({
        title: '请先输入反馈内容',
        icon: 'none'
      })
      return
    }

    this.setData({
      feedbackText: ''
    })
    wx.showToast({
      title: '反馈已收到',
      icon: 'success'
    })
  },

  contactService() {
    wx.showToast({
      title: '客服功能开发中',
      icon: 'none'
    })
  }
})
