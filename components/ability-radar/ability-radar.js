function clampScore(value) {
  const score = Math.round(Number(value || 0))
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, score))
}

function normalizeDimensions(radar) {
  const source = radar && Array.isArray(radar.dimensions) ? radar.dimensions : []
  if (source.length < 5 || source.length > 6) return []

  const dimensions = source
    .map(item => ({
      name: String(item && item.name || '').trim().slice(0, 8),
      score: clampScore(item && item.score)
    }))
    .filter(item => item.name)

  return dimensions.length === source.length ? dimensions : []
}

Component({
  properties: {
    radar: {
      type: Object,
      value: null,
      observer: 'handleRadarChange'
    }
  },

  data: {
    hasRadar: false,
    dimensions: []
  },

  lifetimes: {
    ready() {
      this.componentReady = true
      this.updateRadar(this.data.radar)
    },

    detached() {
      this.componentReady = false
      if (this.drawTimer) clearTimeout(this.drawTimer)
    }
  },

  pageLifetimes: {
    show() {
      if (this.data.hasRadar) this.scheduleDraw()
    }
  },

  methods: {
    handleRadarChange(radar) {
      this.updateRadar(radar)
    },

    updateRadar(radar) {
      const dimensions = normalizeDimensions(radar)
      this.setData({
        hasRadar: dimensions.length >= 5,
        dimensions
      }, () => {
        if (this.componentReady && dimensions.length) this.scheduleDraw()
      })
    },

    scheduleDraw() {
      if (this.drawTimer) clearTimeout(this.drawTimer)
      this.drawTimer = setTimeout(() => this.drawRadar(), 30)
    },

    drawRadar() {
      if (!this.componentReady || !this.data.hasRadar) return

      this.createSelectorQuery()
        .select('#abilityRadarCanvas')
        .fields({ node: true, size: true })
        .exec(result => {
          const canvasInfo = result && result[0]
          if (!canvasInfo || !canvasInfo.node || !canvasInfo.width || !canvasInfo.height) return

          const canvas = canvasInfo.node
          const context = canvas.getContext('2d')
          const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
          const pixelRatio = Number(windowInfo.pixelRatio || 1)
          const width = canvasInfo.width
          const height = canvasInfo.height
          const dimensions = this.data.dimensions

          canvas.width = Math.round(width * pixelRatio)
          canvas.height = Math.round(height * pixelRatio)
          context.scale(pixelRatio, pixelRatio)
          context.clearRect(0, 0, width, height)

          const centerX = width / 2
          const centerY = height * 0.49
          const radius = Math.min(width * 0.255, height * 0.29)
          const angleStep = Math.PI * 2 / dimensions.length
          const startAngle = -Math.PI / 2

          // 绘制四层参考网格和坐标轴。
          context.strokeStyle = '#dce2f8'
          context.lineWidth = 1
          for (let level = 1; level <= 4; level += 1) {
            context.beginPath()
            dimensions.forEach((item, index) => {
              const angle = startAngle + angleStep * index
              const levelRadius = radius * level / 4
              const x = centerX + Math.cos(angle) * levelRadius
              const y = centerY + Math.sin(angle) * levelRadius
              if (index === 0) context.moveTo(x, y)
              else context.lineTo(x, y)
            })
            context.closePath()
            context.stroke()
          }

          dimensions.forEach((item, index) => {
            const angle = startAngle + angleStep * index
            context.beginPath()
            context.moveTo(centerX, centerY)
            context.lineTo(
              centerX + Math.cos(angle) * radius,
              centerY + Math.sin(angle) * radius
            )
            context.stroke()
          })

          // 数据区域使用低饱和蓝紫色，与点评页的教育产品风格保持一致。
          context.beginPath()
          dimensions.forEach((item, index) => {
            const angle = startAngle + angleStep * index
            const dataRadius = radius * item.score / 100
            const x = centerX + Math.cos(angle) * dataRadius
            const y = centerY + Math.sin(angle) * dataRadius
            if (index === 0) context.moveTo(x, y)
            else context.lineTo(x, y)
          })
          context.closePath()
          context.fillStyle = 'rgba(85, 104, 217, 0.20)'
          context.strokeStyle = '#5568d9'
          context.lineWidth = 2
          context.fill()
          context.stroke()

          dimensions.forEach((item, index) => {
            const angle = startAngle + angleStep * index
            const dataRadius = radius * item.score / 100
            const x = centerX + Math.cos(angle) * dataRadius
            const y = centerY + Math.sin(angle) * dataRadius
            context.beginPath()
            context.arc(x, y, 3, 0, Math.PI * 2)
            context.fillStyle = '#5568d9'
            context.fill()
          })

          const labelRadius = radius + 30
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          dimensions.forEach((item, index) => {
            const angle = startAngle + angleStep * index
            const rawX = centerX + Math.cos(angle) * labelRadius
            const labelX = Math.max(48, Math.min(width - 48, rawX))
            const labelY = centerY + Math.sin(angle) * labelRadius

            context.fillStyle = '#4c5678'
            context.font = '600 12px sans-serif'
            context.fillText(item.name, labelX, labelY - 7, 88)
            context.fillStyle = '#5568d9'
            context.font = '700 11px sans-serif'
            context.fillText(`${item.score}分`, labelX, labelY + 10)
          })
        })
    }
  }
})
