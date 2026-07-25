const { getAdminProfile, initSuperAdmin } = require('../../utils/cloud-api')

const MENU_ITEMS = [
  {
    id: 'members',
    iconText: '权',
    title: '会员/权限管理',
    desc: '管理学员手机号、会员身份和有效期',
    url: '/pages/admin-members/admin-members',
    theme: 'menu-green'
  },
  {
    id: 'adultSchedule',
    iconText: '成',
    title: '成人课表',
    desc: '编辑成人课程安排',
    url: '/pages/admin-weekly-schedule/admin-weekly-schedule?category=adult',
    theme: 'menu-blue'
  },
  {
    id: 'collegeSchedule',
    iconText: '大',
    title: '大学生课表',
    desc: '编辑大学生课程安排',
    url: '/pages/admin-weekly-schedule/admin-weekly-schedule?category=college',
    theme: 'menu-violet'
  },
  {
    id: 'miniConfig',
    iconText: '配',
    title: '小程序配置',
    desc: '入口、展示内容和运营配置',
    url: '/pages/admin-mini-config/admin-mini-config',
    theme: 'menu-amber'
  }
]

function getAdminSourceText(source) {
  if (source === 'admins_collection') return '正式管理员'
  if (source === 'env_bootstrap') return '环境变量临时权限'
  if (source === 'phone_entitlement') return '手机号授权管理员'
  return '未识别来源'
}

Page({
  data: {
    checkingAdmin: true,
    isAdmin: false,
    adminRoleText: '暂无',
    adminSourceText: '',
    showInitSuperAdminButton: false,
    initSuperAdminButtonText: '初始化超级管理员',
    initSuperAdminTip: '',
    menuItems: MENU_ITEMS
  },

  onShow() {
    this.loadAdminProfile()
  },

  async loadAdminProfile() {
    this.setData({ checkingAdmin: true })
    try {
      const profile = await getAdminProfile()
      const isAdmin = profile.isAdmin === true && ['super_admin', 'admin'].includes(profile.role)
      const isBootstrapSuperAdmin = isAdmin && profile.role === 'super_admin' && profile.source === 'env_bootstrap'
      this.setData({
        checkingAdmin: false,
        isAdmin,
        adminRoleText: profile.role === 'super_admin' ? '超级管理员' : (profile.role === 'admin' ? '管理员' : '暂无管理员权限'),
        adminSourceText: getAdminSourceText(profile.source),
        showInitSuperAdminButton: !isAdmin || isBootstrapSuperAdmin,
        initSuperAdminButtonText: isBootstrapSuperAdmin ? '初始化为正式超级管理员' : '初始化超级管理员',
        initSuperAdminTip: isBootstrapSuperAdmin
          ? '当前使用环境变量临时权限，初始化后会写入 admins 集合。'
          : '请先在 cloudApi 环境变量 ADMIN_OPENIDS 中配置当前 openId。'
      })
    } catch (error) {
      this.setData({ checkingAdmin: false, isAdmin: false })
      wx.showToast({ title: error.message || '管理员身份读取失败', icon: 'none' })
    }
  },

  initSuperAdmin() {
    wx.showModal({
      title: '初始化超级管理员',
      content: '确认将当前账号初始化为正式超级管理员吗？',
      confirmText: '初始化',
      success: async result => {
        if (!result.confirm) return
        try {
          const res = await initSuperAdmin()
          wx.showToast({ title: res.initialized ? '初始化成功' : '已完成初始化', icon: 'success' })
          await this.loadAdminProfile()
        } catch (error) {
          wx.showToast({ title: error.message || '初始化失败', icon: 'none' })
        }
      }
    })
  },

  openMenu(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.menuItems[index]
    if (!item) return
    wx.navigateTo({ url: item.url })
  }
})
