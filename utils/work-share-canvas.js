const DESIGN_WIDTH = 1000
const DESIGN_HEIGHT = 800
const SHARE_WIDTH = 750
const SHARE_HEIGHT = 600

function cleanText(value, fallback = '') {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text || fallback
}

function parseDurationSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(Math.floor(value), 0)
  const text = cleanText(value)
  if (!text || ['暂无', '--'].includes(text)) return 0

  const colon = text.match(/^(\d+):(\d{1,2})$/)
  if (colon) return Number(colon[1]) * 60 + Number(colon[2])
  const chinese = text.match(/(?:(\d+)\s*分(?:钟)?)?\s*(?:(\d+)\s*秒)?/)
  if (chinese && (chinese[1] || chinese[2])) return Number(chinese[1] || 0) * 60 + Number(chinese[2] || 0)
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(Math.floor(Number(text)), 0)
  return 0
}

function formatDuration(work = {}) {
  const seconds = parseDurationSeconds(
    work.durationSeconds || work.duration || work.durationText
  )
  if (!seconds) return '--'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function getMediaLabel(work = {}) {
  const type = cleanText(work.mediaType || work.workType || work.submitType || work.type).toLowerCase()
  return type.includes('video') ? '视频作品' : '音频作品'
}

function getWorkTitle(work = {}) {
  const title = cleanText(
    work.titleText || work.title || work.taskTitle || work.contentTitle,
    '我的口才训练作品'
  )
  return title === '训练作品' ? '我的口才训练作品' : title
}

function getAuthorName(work = {}) {
  const author = cleanText(work.authorName || work.publicNickname || work.nickname, '口才训练学员')
  return author === '同学' ? '口才训练学员' : author
}

function buildTrainingInfo(work = {}) {
  const dayNumber = Number(work.dayNumber || work.day || 0)
  const candidates = [
    dayNumber > 0 ? `Day ${dayNumber}` : '',
    cleanText(work.moduleTitle),
    cleanText(work.taskTitle)
  ].filter(Boolean)
  return Array.from(new Set(candidates)).join(' · ') || '日常表达训练'
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius)
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius)
  ctx.arcTo(x, y + height, x, y, safeRadius)
  ctx.arcTo(x, y, x + width, y, safeRadius)
  ctx.closePath()
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.save()
  roundRectPath(ctx, x, y, width, height, radius)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(cleanText(text, '我的口才训练作品'))
  const lines = []
  let currentLine = ''

  chars.forEach(char => {
    const nextLine = `${currentLine}${char}`
    if (currentLine && ctx.measureText(nextLine).width > maxWidth) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = nextLine
    }
  })
  if (currentLine) lines.push(currentLine)

  const visibleLines = lines.slice(0, maxLines)
  if (lines.length > maxLines && visibleLines.length) {
    let lastLine = visibleLines[visibleLines.length - 1]
    while (lastLine && ctx.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = Array.from(lastLine).slice(0, -1).join('')
    }
    visibleLines[visibleLines.length - 1] = `${lastLine}…`
  }

  visibleLines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })
  return visibleLines.length
}

function getCanvasNode(canvasId, componentThis) {
  return new Promise((resolve, reject) => {
    if (!componentThis) {
      reject(new Error('WORK_SHARE_CANVAS_CONTEXT_MISSING'))
      return
    }
    const query = typeof componentThis.createSelectorQuery === 'function'
      ? componentThis.createSelectorQuery()
      : wx.createSelectorQuery().in(componentThis)
    query.select(`#${canvasId}`).fields({ node: true, size: true }).exec(result => {
      const canvas = result && result[0] && result[0].node
      if (!canvas) {
        reject(new Error('WORK_SHARE_CANVAS_NOT_FOUND'))
        return
      }
      resolve(canvas)
    })
  })
}

function loadCanvasImage(canvas, source) {
  return new Promise(resolve => {
    if (!source || !canvas || typeof canvas.createImage !== 'function') {
      resolve(null)
      return
    }
    const image = canvas.createImage()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, 1500)
    image.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    }
    image.src = source
  })
}

function exportCanvas(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      destWidth: SHARE_WIDTH,
      destHeight: SHARE_HEIGHT,
      fileType: 'jpg',
      quality: 0.75,
      success(result) {
        if (!result || !result.tempFilePath) {
          reject(new Error('WORK_SHARE_IMAGE_PATH_EMPTY'))
          return
        }
        resolve(result.tempFilePath)
      },
      fail(error) {
        reject(error || new Error('WORK_SHARE_CANVAS_EXPORT_FAILED'))
      }
    })
  })
}

function waitForCanvasPaint(canvas) {
  return new Promise(resolve => {
    if (canvas && typeof canvas.requestAnimationFrame === 'function') {
      canvas.requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 32)
  })
}

function getDevicePixelRatio() {
  try {
    const systemInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    return Math.max(1, Math.min(Number(systemInfo.pixelRatio || 1), 2))
  } catch (error) {
    console.warn('[work-share-canvas] read pixel ratio failed, use fallback')
    return 1
  }
}

async function drawLogoOrFallback(ctx, canvas, logoPath) {
  const centerX = 858
  const centerY = 672
  const radius = 58
  const logoImage = await loadCanvasImage(canvas, logoPath)

  if (logoImage) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(logoImage, centerX - radius, centerY - radius, radius * 2, radius * 2)
    ctx.restore()
    return
  }

  console.log('[work-share-canvas] use fallback logo')
  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.fillStyle = '#16a34a'
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('KEEP', centerX, centerY + 1)
  ctx.restore()
}

/**
 * 生成单个作品的 5:4 分享图。图片资源失败时仍会导出纯文字版本。
 */
async function generateWorkShareImage(options = {}) {
  const {
    canvasId = 'workShareCanvas',
    componentThis,
    work = {},
    fallbackImage = '',
    logoPath = ''
  } = options
  console.log('[work-share-canvas] start generate', {
    hasWork: Boolean(work && (work._id || work.id)),
    hasFallbackImage: Boolean(fallbackImage),
    hasLogoPath: Boolean(logoPath)
  })

  try {
    const canvas = await getCanvasNode(canvasId, componentThis)
    // 限制到 2 倍像素密度，兼顾真机清晰度和内存占用。
    const dpr = getDevicePixelRatio()
    canvas.width = SHARE_WIDTH * dpr
    canvas.height = SHARE_HEIGHT * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('WORK_SHARE_CANVAS_CONTEXT_UNAVAILABLE')
    // 保留原有 1000×800 设计坐标，通过缩放导出更轻量的 750×600 分享图。
    ctx.scale(
      dpr * SHARE_WIDTH / DESIGN_WIDTH,
      dpr * SHARE_HEIGHT / DESIGN_HEIGHT
    )
    console.log('[work-share-canvas] canvas ready', { width: SHARE_WIDTH, height: SHARE_HEIGHT, dpr })

    ctx.fillStyle = '#f6fbf7'
    ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.arc(920, 70, 150, 0, Math.PI * 2)
    ctx.fillStyle = '#dcfce7'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(65, 760, 120, 0, Math.PI * 2)
    ctx.fillStyle = '#ecfdf5'
    ctx.fill()
    ctx.restore()

    fillRoundRect(ctx, 40, 40, 920, 720, 36, '#ffffff')

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#16a34a'
    ctx.font = '700 34px sans-serif'
    ctx.fillText('杨勤口才训练 KEEP', 80, 112)

    const mediaLabel = getMediaLabel(work)
    ctx.font = '700 25px sans-serif'
    const labelWidth = Math.max(ctx.measureText(mediaLabel).width + 42, 142)
    fillRoundRect(ctx, 880 - labelWidth, 78, labelWidth, 52, 26, '#ecfdf5')
    ctx.fillStyle = '#15803d'
    ctx.textAlign = 'center'
    ctx.fillText(mediaLabel, 880 - labelWidth / 2, 112)

    ctx.textAlign = 'left'
    ctx.fillStyle = '#0f172a'
    ctx.font = '800 52px sans-serif'
    drawWrappedText(ctx, getWorkTitle(work), 80, 205, 820, 68, 2)

    ctx.fillStyle = '#64748b'
    ctx.font = '400 28px sans-serif'
    const author = getAuthorName(work)
    const duration = formatDuration(work)
    ctx.fillText(`作者：${author}   ·   时长：${duration}`, 80, 355)

    ctx.fillStyle = '#475569'
    ctx.font = '500 27px sans-serif'
    drawWrappedText(ctx, buildTrainingInfo(work), 80, 402, 790, 40, 1)

    fillRoundRect(ctx, 70, 455, 860, 130, 26, '#f0fdf4')
    ctx.fillStyle = '#111827'
    ctx.font = '700 42px sans-serif'
    ctx.fillText('我完成了一次口才训练', 100, 512)
    ctx.fillStyle = '#64748b'
    ctx.font = '400 29px sans-serif'
    ctx.fillText('打开小程序，查看完整作品', 100, 558)

    ctx.fillStyle = '#16a34a'
    ctx.font = '700 28px sans-serif'
    ctx.fillText('每天练一点', 80, 670)
    ctx.fillStyle = '#334155'
    ctx.font = '500 28px sans-serif'
    ctx.fillText('表达更自信', 80, 710)

    await drawLogoOrFallback(ctx, canvas, logoPath)
    console.log('[work-share-canvas] draw complete')

    await waitForCanvasPaint(canvas)
    const tempFilePath = await exportCanvas(canvas)
    console.log('[work-share-canvas] export success', { hasTempFilePath: Boolean(tempFilePath) })
    return tempFilePath
  } catch (error) {
    console.warn('[work-share-canvas] export fail', {
      errMsg: error && (error.errMsg || error.message) || 'unknown'
    })
    console.log('[work-share-canvas] use fallback', { hasFallbackImage: Boolean(fallbackImage) })
    throw error
  }
}

module.exports = {
  drawWrappedText,
  formatDuration,
  generateWorkShareImage,
  SHARE_HEIGHT,
  SHARE_WIDTH
}
