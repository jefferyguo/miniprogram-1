const {
  formatDateTime,
  getAllSubmittedWorks,
  getFavoriteFolders,
  getFavoriteWorks,
  saveFavoriteFolders,
  saveFavoriteWorks
} = require('../../utils/local-data')
const { getVideoPath, previewVideoByPath } = require('../../utils/work-media')

function normalizeModuleTitle(title) {
  return String(title || '训练作品').replace(/^21天/, '')
}

function buildFolderView(folder, works, index) {
  return {
    ...folder,
    isDefault: folder.isDefault || folder.name === '默认收藏夹',
    workCount: works.filter(item => String(item.folderId) === String(folder.id)).length
  }
}

function getDisplayWork(item) {
  return {
    ...item,
    displayType: item.workType === 'video' ? '录像作品' : '录音作品',
    displayActionText: item.workType === 'video' ? '查看' : '播放',
    displayTitle: `${normalizeModuleTitle(item.moduleTitle)}${item.day ? ` Day ${item.day}` : ''}`,
    teacherStatusText: item.teacherFeedback || item.teacherFeedbackStatus === 'done' ? '老师已点评' : '待老师点评',
    aiStatusText: item.aiFeedbackStatus === 'done'
      ? 'AI已反馈'
      : (item.aiFeedbackStatus === 'blocked'
        ? '时长不够'
        : (item.aiFeedbackStatus === 'error' || item.aiFeedbackError ? '生成失败' : '暂无AI反馈'))
  }
}

Page({
  data: {
    mode: 'list',
    folders: [],
    favoriteWorks: [],
    currentFolder: null,
    currentWorks: []
  },

  onShow() {
    this.loadFavorites()
  },

  loadFavorites() {
    const folders = getFavoriteFolders()
    const favoriteWorks = getFavoriteWorks()
    const currentFolder = this.data.currentFolder
    const currentWorks = currentFolder
      ? favoriteWorks.filter(item => String(item.folderId) === String(currentFolder.id)).map(getDisplayWork)
      : []

    this.setData({
      folders: folders.map((item, index) => buildFolderView(item, favoriteWorks, index)),
      favoriteWorks,
      currentWorks,
      currentFolder: currentFolder
        ? folders.find(item => String(item.id) === String(currentFolder.id)) || null
        : null
    })
  },

  createFolder() {
    wx.showModal({
      title: '创建收藏夹',
      editable: true,
      placeholderText: '请输入收藏夹名称，例如：优秀表达案例',
      confirmText: '创建',
      success: res => {
        if (!res.confirm) return

        const name = String(res.content || '').trim()
        const folders = getFavoriteFolders()

        if (!name) {
          wx.showToast({
            title: '请输入收藏夹名称',
            icon: 'none'
          })
          return
        }

        if (folders.some(item => item.name === name)) {
          wx.showToast({
            title: '收藏夹名称已存在',
            icon: 'none'
          })
          return
        }

        saveFavoriteFolders([{
          id: Date.now(),
          name,
          desc: '自定义收藏夹',
          createdAt: formatDateTime(),
          isDefault: false
        }].concat(folders))

        this.loadFavorites()
        wx.showToast({
          title: '创建成功',
          icon: 'success'
        })
      }
    })
  },

  openFolder(e) {
    const id = e.currentTarget.dataset.id
    const currentFolder = getFavoriteFolders().find(item => String(item.id) === String(id)) || null

    this.setData({
      mode: 'detail',
      currentFolder
    }, () => {
      this.loadFavorites()
    })
  },

  backToList() {
    this.setData({
      mode: 'list',
      currentFolder: null,
      currentWorks: []
    })
  },

  renameFolder(e) {
    const id = e.currentTarget.dataset.id
    const folders = getFavoriteFolders()
    const target = folders.find(item => String(item.id) === String(id))

    if (!target) return

    wx.showModal({
      title: '重命名收藏夹',
      editable: true,
      placeholderText: target.name,
      confirmText: '保存',
      success: res => {
        if (!res.confirm) return

        const name = String(res.content || '').trim()

        if (!name) {
          wx.showToast({
            title: '请输入收藏夹名称',
            icon: 'none'
          })
          return
        }

        if (folders.some(item => item.name === name && String(item.id) !== String(id))) {
          wx.showToast({
            title: '收藏夹名称已存在',
            icon: 'none'
          })
          return
        }

        saveFavoriteFolders(folders.map(item => (
          String(item.id) === String(id)
            ? {
              ...item,
              name
            }
            : item
        )))
        this.loadFavorites()
        wx.showToast({
          title: '已重命名',
          icon: 'success'
        })
      }
    })
  },

  deleteFolder(e) {
    const id = e.currentTarget.dataset.id
    const folders = getFavoriteFolders()
    const target = folders.find(item => String(item.id) === String(id))

    if (!target) return

    if (target.isDefault || target.name === '默认收藏夹') {
      wx.showToast({
        title: '默认收藏夹不能删除',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '删除收藏夹',
      content: '删除收藏夹不会删除原作品，只会移除该收藏夹下的收藏记录。',
      confirmText: '删除',
      confirmColor: '#d84d4d',
      success: res => {
        if (!res.confirm) return

        saveFavoriteFolders(folders.filter(item => String(item.id) !== String(id)))
        saveFavoriteWorks(getFavoriteWorks().filter(item => String(item.folderId) !== String(id)))
        this.loadFavorites()
        wx.showToast({
          title: '已删除',
          icon: 'none'
        })
      }
    })
  },

  playWork(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.currentWorks.find(item => String(item.id) === String(id))

    if (!target) return

    if (target.workType === 'video') {
      const videoPath = getVideoPath(target)

      if (!videoPath) {
        wx.showToast({
          title: '录像文件不存在',
          icon: 'none'
        })
        return
      }

      previewVideoByPath(videoPath, target.displayTitle || '收藏录像')
      return
    }

    if (!target.filePath) {
      wx.showToast({
        title: '录音文件不存在',
        icon: 'none'
      })
      return
    }

    this.stopAudioContext()
    this.audioContext = wx.createInnerAudioContext()
    this.audioContext.src = target.filePath
    this.audioContext.play()
    wx.showToast({
      title: '开始播放',
      icon: 'none'
    })
  },

  viewFeedback(e) {
    const id = e.currentTarget.dataset.id
    const favorite = this.data.currentWorks.find(item => String(item.id) === String(id))
    const works = getAllSubmittedWorks()
    const original = favorite
      ? works.find(item => (
        String(item.id) === String(favorite.submissionId) &&
        (favorite.sourceType === 'extra' ? item.sourceType === 'extra' : item.sourceType === 'main')
      ))
      : null
    const feedback = original && original.teacherFeedback
      ? original.teacherFeedback
      : (favorite && favorite.teacherFeedback)

    if (!feedback) {
      wx.showToast({
        title: '暂无老师点评',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '老师点评',
      content: [
        `老师：${feedback.teacherName || '杨勤老师'}`,
        `评分：${feedback.score || 5} / 5`,
        `标签：${Array.isArray(feedback.tags) ? feedback.tags.join('、') : '暂无'}`,
        `点评内容：${feedback.content || '暂无'}`,
        `点评时间：${feedback.createdAt || '暂无'}`
      ].join('\n\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  },

  removeFavorite(e) {
    const id = e.currentTarget.dataset.id

    wx.showModal({
      title: '移出收藏',
      content: '确定将这个作品移出当前收藏夹吗？',
      confirmText: '移出',
      confirmColor: '#d84d4d',
      success: res => {
        if (!res.confirm) return

        saveFavoriteWorks(getFavoriteWorks().filter(item => String(item.id) !== String(id)))
        this.loadFavorites()
        wx.showToast({
          title: '已移出',
          icon: 'none'
        })
      }
    })
  },

  switchTeacherTab(e) {
    const url = e.currentTarget.dataset.url

    if (!url || url === '/pages/teacher-favorites/teacher-favorites') return

    wx.redirectTo({
      url
    })
  },

  stopAudioContext() {
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
  },

  onUnload() {
    this.stopAudioContext()
  }
})
