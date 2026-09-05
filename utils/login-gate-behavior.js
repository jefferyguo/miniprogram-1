/**
 * login-gate 组件页面接入 behavior。
 *
 * 需要登录门控的页面引入此 behavior，并在 WXML 中添加：
 *   <login-gate id="login-gate" />
 *
 * 登录会话由 login-gate 自身的关闭回调和 sessionId 管理。
 */
module.exports = Behavior({
  pageLifetimes: {
    // tab 切换不清理其他页面的有效认证流程。
  },

  methods: {
    /**
     * 获取当前页面的 login-gate 组件实例。
     */
    getLoginGate() {
      if (this.selectComponent) {
        return this.selectComponent('#login-gate') || null
      }
      return null
    }
  }
})
