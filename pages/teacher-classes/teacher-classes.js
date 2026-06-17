const {
  createClass,
  getClasses
} = require('../../utils/local-data')

Page({
  data: {
    classes: []
  },

  onShow() {
    this.loadClasses()
  },

  loadClasses() {
    this.setData({
      classes: getClasses()
    })
  },

  createClass() {
    wx.showModal({
      title: '创建班级',
      editable: true,
      placeholderText: '请输入班级名称，例如：暑期口才训练营1班',
      confirmText: '创建',
      success: res => {
        if (!res.confirm) return

        const className = String(res.content || '').trim()

        if (!className) {
          wx.showToast({
            title: '请输入班级名称',
            icon: 'none'
          })
          return
        }

        createClass(className)
        this.loadClasses()

        wx.showToast({
          title: '班级创建成功',
          icon: 'success'
        })
      }
    })
  },

  copyClassCode(e) {
    const classCode = e.currentTarget.dataset.code

    wx.setClipboardData({
      data: classCode,
      success: () => {
        wx.showToast({
          title: '班级码已复制',
          icon: 'success'
        })
      }
    })
  },

  viewWorks(e) {
    const classId = e.currentTarget.dataset.id

    wx.navigateTo({
      url: `/pages/teacher-review/teacher-review?type=all&classId=${classId}`
    })
  },

  switchTeacherTab(e) {
    const url = e.currentTarget.dataset.url

    if (!url || url === '/pages/teacher-classes/teacher-classes') return

    wx.redirectTo({
      url
    })
  }
})
