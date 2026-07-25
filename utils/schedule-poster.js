function waitForSetData(page, data) {
  return new Promise(resolve => page.setData(data, resolve))
}

function getPosterDimensions(schedule = {}) {
  const courseCount = Math.max((schedule.courses || []).length, 1)
  return {
    width: 375,
    height: 300 + courseCount * 142
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height - r)
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
  ctx.lineTo(x + r, y + height)
  ctx.arcTo(x, y + height, x, y + height - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function drawWrappedText(ctx, text, x, y, maxChars, lineHeight, maxLines = 2) {
  const value = String(text || '')
  const lines = []
  for (let index = 0; index < value.length; index += maxChars) {
    lines.push(value.slice(index, index + maxChars))
  }
  const displayLines = lines.slice(0, maxLines)
  if (lines.length > maxLines && displayLines.length) {
    displayLines[maxLines - 1] = `${displayLines[maxLines - 1].slice(0, Math.max(maxChars - 1, 1))}…`
  }
  displayLines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  return displayLines.length
}

function base64ToTempFile(dataUrl) {
  return new Promise((resolve, reject) => {
    const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
    if (!match) {
      reject(new Error('图片数据格式不支持'))
      return
    }
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
    const filePath = `${wx.env.USER_DATA_PATH}/schedule_qr_${Date.now()}.${extension}`
    wx.getFileSystemManager().writeFile({
      filePath,
      data: match[2],
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: reject
    })
  })
}

async function normalizeImageUrl(url) {
  const source = String(url || '')
  if (!source) return ''
  if (source.indexOf('data:image/') === 0) return base64ToTempFile(source)
  if (source.indexOf('cloud://') === 0 && wx.cloud) {
    const res = await wx.cloud.getTempFileURL({ fileList: [source] })
    const item = res.fileList && res.fileList[0]
    return item && item.tempFileURL ? item.tempFileURL : ''
  }
  return source
}

async function getLocalImagePath(url) {
  const source = await normalizeImageUrl(url)
  if (!source) return ''

  return new Promise(resolve => {
    wx.getImageInfo({
      src: source,
      success: res => resolve(res.path || source),
      fail: () => resolve('')
    })
  })
}

function exportCanvas(page, canvasId, dimensions) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvasId,
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
      destWidth: dimensions.width * 2,
      destHeight: dimensions.height * 2,
      fileType: 'png',
      quality: 1,
      success: res => resolve(res.tempFilePath),
      fail: reject
    }, page)
  })
}

async function generateSchedulePoster(page, schedule = {}, options = {}) {
  const canvasId = options.canvasId || 'schedulePosterCanvas'
  const dimensions = getPosterDimensions(schedule)
  await waitForSetData(page, {
    posterCanvasWidth: dimensions.width,
    posterCanvasHeight: dimensions.height
  })

  const ctx = wx.createCanvasContext(canvasId, page)
  const courses = Array.isArray(schedule.courses) && schedule.courses.length
    ? schedule.courses
    : [{ courseTitle: '课程安排待更新' }]
  const qrPath = await getLocalImagePath(options.qrUrl || schedule.miniProgramQrUrl || schedule.miniProgramQrFileID || '')
  const logoPath = await getLocalImagePath(options.logoUrl || '/images/yangqin-logo.jpg')

  ctx.setFillStyle('#f4f8f6')
  ctx.fillRect(0, 0, dimensions.width, dimensions.height)

  ctx.setFillStyle('#17352d')
  ctx.fillRect(0, 0, dimensions.width, 126)
  if (logoPath) ctx.drawImage(logoPath, 24, 22, 42, 42)
  ctx.setFillStyle('#ffffff')
  ctx.setFontSize(15)
  ctx.fillText('杨勤口才训练 KEEP', logoPath ? 78 : 24, 48)
  ctx.setFontSize(27)
  ctx.fillText('本周课程安排', 24, 84)
  ctx.setFillStyle('rgba(255,255,255,0.78)')
  ctx.setFontSize(13)
  ctx.fillText(schedule.weekLabel || '课程日期待更新', 24, 108)

  let y = 146
  courses.forEach(course => {
    roundRect(ctx, 18, y, dimensions.width - 36, 126, 14)
    ctx.setFillStyle('#ffffff')
    ctx.fill()
    ctx.setFillStyle('#07c160')
    ctx.fillRect(18, y + 18, 4, 90)

    ctx.setFillStyle('#17352d')
    ctx.setFontSize(13)
    ctx.fillText(`${course.date || ''} ${course.weekday || ''}`.trim() || '日期待定', 34, y + 28)
    ctx.setFillStyle('#3478f6')
    ctx.fillText(course.time || [course.startTime, course.endTime].filter(Boolean).join('-') || '时间待定', 224, y + 28)

    ctx.setFillStyle('#111827')
    ctx.setFontSize(18)
    drawWrappedText(ctx, course.courseTitle || '课程安排', 34, y + 58, 17, 21, 2)

    ctx.setFillStyle('#687280')
    ctx.setFontSize(12)
    const details = [course.teacher || '杨勤老师', course.location || '杨勤口才教室', course.audience || '学员'].join('  ·  ')
    drawWrappedText(ctx, details, 34, y + 103, 26, 16, 1)
    y += 142
  })

  const footerY = dimensions.height - 118
  ctx.setFillStyle('#17352d')
  ctx.setFontSize(15)
  ctx.fillText('扫码进入小程序', 24, footerY + 28)
  ctx.setFillStyle('#7a8192')
  ctx.setFontSize(12)
  ctx.fillText('查看训练与课程安排', 24, footerY + 50)

  if (qrPath) {
    ctx.drawImage(qrPath, dimensions.width - 98, footerY + 8, 74, 74)
  } else {
    ctx.setStrokeStyle('#cbd5df')
    ctx.setLineWidth(1)
    ctx.strokeRect(dimensions.width - 98, footerY + 8, 74, 74)
    ctx.setFillStyle('#9aa1ad')
    ctx.setFontSize(11)
    ctx.fillText('小程序码', dimensions.width - 89, footerY + 49)
  }

  ctx.setFillStyle('#a0a7b2')
  ctx.setFontSize(11)
  ctx.fillText('每天 3 分钟，练成好口才', 24, dimensions.height - 22)

  await new Promise(resolve => ctx.draw(false, () => setTimeout(resolve, 120)))
  return exportCanvas(page, canvasId, dimensions)
}

module.exports = {
  getPosterDimensions,
  generateSchedulePoster
}
