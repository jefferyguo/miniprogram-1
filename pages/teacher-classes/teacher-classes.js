const {
  createClass,
  getClasses
} = require('../../utils/local-data')
const { generateClassJoinQr } = require('../../utils/qrcode')

Page({
  data: {
    classes: [],
    qrPopupVisible: false,
    currentQrClass: null,
    currentQrUrl: '',
    qrLoadError: false
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

  async showClassQr(e) {
    const classId = Number(e.currentTarget.dataset.id)
    const classes = wx.getStorageSync('classes') || []
    const targetClass = classes.find(item => Number(item.id) === classId)

    if (!targetClass) {
      wx.showToast({
        title: '班级不存在',
        icon: 'none'
      })
      return
    }

    if (targetClass.qrCodeUrl) {
      this.setData({
        qrPopupVisible: true,
        currentQrClass: targetClass,
        currentQrUrl: targetClass.qrCodeUrl,
        qrLoadError: false
      })
      return
    }

    wx.showLoading({
      title: '生成中...'
    })

    try {
      const qrUrl = await generateClassJoinQr(targetClass.classCode)

      const updatedClasses = classes.map(item => {
        if (Number(item.id) === classId) {
          return {
            ...item,
            qrCodeUrl: qrUrl
          }
        }
        return item
      })

      wx.setStorageSync('classes', updatedClasses)

      this.setData({
        classes: updatedClasses,
        qrPopupVisible: true,
        currentQrClass: {
          ...targetClass,
          qrCodeUrl: qrUrl
        },
        currentQrUrl: qrUrl,
        qrLoadError: false
      })
    } catch (err) {
      console.error('生成班级二维码失败：', err)
      wx.showToast({
        title: '二维码生成失败',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  },

  closeQrPopup() {
    this.setData({
      qrPopupVisible: false,
      currentQrClass: null,
      currentQrUrl: '',
      qrLoadError: false
    })
  },

  onQrImageError() {
    this.setData({
      qrLoadError: true
    })
  },

  noop() {},

  switchTeacherTab(e) {
    const url = e.currentTarget.dataset.url

    if (!url || url === '/pages/teacher-classes/teacher-classes') return

    wx.redirectTo({
      url
    })
  }
})
