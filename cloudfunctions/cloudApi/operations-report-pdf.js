'use strict'

const path = require('path')
const PDFDocument = require('pdfkit')

const FONT_PATH = path.join(__dirname, 'NotoSansCJKsc-AdminReport.ttf')
const COLORS = {
  ink: '#182230',
  muted: '#667085',
  line: '#E4E7EC',
  panel: '#F7F9FC',
  green: '#168F5B',
  greenSoft: '#EAF7F0',
  blue: '#4F67D8',
  blueSoft: '#EEF1FF',
  amber: '#B7791F',
  amberSoft: '#FFF7E6'
}

function money(fen) {
  return `¥${(Number(fen || 0) / 100).toFixed(2)}`
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function buildOperationsPdf(report = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42,
      bufferPages: true,
      info: {
        Title: report.title || '用户与会员经营报告',
        Author: '杨勤口才训练KEEP',
        Subject: '用户、会员与收入经营数据'
      }
    })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.registerFont('NotoSansSC', FONT_PATH)
    doc.font('NotoSansSC')

    const pageWidth = doc.page.width
    const contentWidth = pageWidth - 84

    function ensureSpace(height) {
      if (doc.y + height <= doc.page.height - 46) return
      doc.addPage()
      doc.font('NotoSansSC')
      doc.y = 42
    }

    function sectionTitle(title, note = '') {
      ensureSpace(note ? 54 : 38)
      doc.fillColor(COLORS.ink).fontSize(15).text(title, 42, doc.y, { width: contentWidth })
      if (note) {
        doc.moveDown(0.25)
        doc.fillColor(COLORS.muted).fontSize(8.5).text(note, { width: contentWidth })
      }
      doc.moveDown(0.6)
    }

    function metricGrid(items) {
      const gap = 10
      const columns = 3
      const width = (contentWidth - gap * (columns - 1)) / columns
      const height = 72
      const startY = doc.y
      items.forEach((item, index) => {
        const row = Math.floor(index / columns)
        const column = index % columns
        const x = 42 + column * (width + gap)
        const y = startY + row * (height + gap)
        doc.roundedRect(x, y, width, height, 7).fill(item.background || COLORS.panel)
        doc.fillColor(COLORS.muted).fontSize(8.5).text(item.label, x + 12, y + 11, { width: width - 24 })
        doc.fillColor(item.color || COLORS.ink).fontSize(16).text(String(item.value), x + 12, y + 32, {
          width: width - 24,
          lineBreak: false
        })
      })
      const rows = Math.ceil(items.length / columns)
      doc.y = startY + rows * height + (rows - 1) * gap + 12
    }

    function drawTrend(title, points, valueKey, valueFormatter, color) {
      ensureSpace(158)
      const x = 42
      const y = doc.y
      const width = contentWidth
      const height = 126
      doc.roundedRect(x, y, width, height, 7).fill(COLORS.panel)
      const values = (points || []).map(item => Number(item[valueKey] || 0))
      const total = values.reduce((sum, value) => sum + value, 0)
      doc.fillColor(COLORS.ink).fontSize(11).text(title, x + 14, y + 12, {
        width: width * 0.58,
        lineBreak: false
      })
      doc.fillColor(color).fontSize(8.5).text(`合计 ${valueFormatter(total)}`, x + width * 0.58, y + 14, {
        width: width * 0.38 - 14,
        align: 'right',
        lineBreak: false
      })
      const chartX = x + 34
      const chartY = y + 40
      const chartWidth = width - 56
      const chartHeight = 58
      const max = Math.max(1, ...values)
      doc.strokeColor(COLORS.line).lineWidth(0.7)
      doc.moveTo(chartX, chartY + chartHeight).lineTo(chartX + chartWidth, chartY + chartHeight).stroke()
      const barGap = points.length > 31 ? 1 : 3
      const barWidth = Math.max(2, chartWidth / Math.max(points.length, 1) - barGap)
      ;(points || []).forEach((item, index) => {
        const value = Number(item[valueKey] || 0)
        const barHeight = value > 0 ? Math.max(2, chartHeight * value / max) : 0
        const barX = chartX + index * (chartWidth / Math.max(points.length, 1))
        if (barHeight > 0) doc.rect(barX, chartY + chartHeight - barHeight, barWidth, barHeight).fill(color)
      })
      const first = points && points[0] && points[0].label || ''
      const last = points && points[points.length - 1] && points[points.length - 1].label || ''
      doc.fillColor(COLORS.muted).fontSize(7.5)
        .text(first, chartX, chartY + chartHeight + 7, { width: 90 })
        .text(last, chartX + chartWidth - 90, chartY + chartHeight + 7, { width: 90, align: 'right' })
      doc.y = y + height + 12
    }

    function drawPackageStructure(items) {
      ensureSpace(120)
      const startY = doc.y
      const rows = items && items.length ? items : [{ membershipLabel: '暂无真实支付订单', orderCount: 0, confirmedFen: 0, share: 0 }]
      rows.forEach((item, index) => {
        const y = startY + index * 32
        doc.fillColor(COLORS.ink).fontSize(9.5).text(item.membershipLabel, 48, y + 2, { width: 130 })
        doc.fillColor(COLORS.muted).fontSize(8.5).text(`${item.orderCount} 单`, 186, y + 3, { width: 55 })
        doc.fillColor(COLORS.blue).fontSize(9).text(money(item.confirmedFen), 244, y + 2, { width: 90 })
        const trackX = 342
        const trackWidth = 130
        doc.roundedRect(trackX, y + 6, trackWidth, 7, 3).fill(COLORS.line)
        if (item.share > 0) doc.roundedRect(trackX, y + 6, Math.max(5, trackWidth * item.share), 7, 3).fill(COLORS.blue)
        doc.fillColor(COLORS.muted).fontSize(8).text(percent(item.share), 480, y + 2, { width: 70, align: 'right' })
      })
      doc.y = startY + rows.length * 32 + 6
    }

    const counts = report.overview && report.overview.counts || {}
    const revenue = report.revenue || {}
    const metrics = revenue.metrics || {}
    const trends = report.overview && report.overview.trends || {}

    doc.roundedRect(42, 42, contentWidth, 112, 10).fill('#183D34')
    doc.fillColor('#FFFFFF').fontSize(22).text(report.title || '用户与会员经营报告', 62, 62, { width: contentWidth - 40 })
    doc.fillColor('#DCEBE5').fontSize(9.5)
      .text(`统计周期：${report.startDate || ''} ~ ${report.endDate || ''}`, 62, 101)
      .text(`生成时间：${report.generatedAt || ''}`, 62, 121)
    doc.y = 176

    sectionTitle('数据总览', '会员按用户当前实际访问权限统计，付费转化率只计算真实微信支付用户。')
    metricGrid([
      { label: '总用户', value: `${counts.all || 0} 人`, background: COLORS.panel },
      { label: '普通用户', value: `${counts.ordinary || 0} 人`, background: COLORS.panel },
      { label: '有效会员', value: `${counts.active || 0} 人`, background: COLORS.greenSoft, color: COLORS.green },
      { label: '已过期会员', value: `${counts.expired || 0} 人`, background: COLORS.amberSoft, color: COLORS.amber },
      { label: '待注册授权', value: `${counts.pendingPreauthorizations || 0} 人`, background: COLORS.blueSoft, color: COLORS.blue },
      { label: '付费转化率', value: percent(counts.paidConversionRate), background: COLORS.blueSoft, color: COLORS.blue },
      { label: '统计期新增用户', value: `${counts.periodNewUsers == null ? (counts.thirtyDayNewUsers || 0) : counts.periodNewUsers} 人`, background: COLORS.panel },
      { label: '统计期新增预授权', value: `${counts.periodPreauthorizationsCreated || 0} 人`, background: COLORS.panel },
      { label: '统计期领取预授权', value: `${counts.periodPreauthorizationsClaimed || 0} 人`, background: COLORS.panel }
    ])

    sectionTitle('收入分析', '口径：会员总收益包含已确认微信支付与后台人工会员发放；支付收入单独统计。')
    metricGrid([
      { label: '今日收入', value: money(metrics.today && metrics.today.confirmedFen), background: COLORS.greenSoft, color: COLORS.green },
      { label: '本周收入', value: money(metrics.week && metrics.week.confirmedFen), background: COLORS.greenSoft, color: COLORS.green },
      { label: '本月收入', value: money(metrics.month && metrics.month.confirmedFen), background: COLORS.blueSoft, color: COLORS.blue },
      { label: '今年收入', value: money(metrics.year && metrics.year.confirmedFen), background: COLORS.blueSoft, color: COLORS.blue },
      { label: '7天内到期', value: `${counts.expiring7 || 0} 人`, background: COLORS.amberSoft, color: COLORS.amber },
      { label: '30天内到期', value: `${counts.expiring30 || 0} 人`, background: COLORS.amberSoft, color: COLORS.amber }
    ])

    doc.addPage()
    doc.font('NotoSansSC')
    doc.y = 42
    sectionTitle('用户与会员增长趋势')
    drawTrend('新增用户趋势', trends.userTrend || [], 'count', value => `${value} 人`, COLORS.green)
    drawTrend('新增会员趋势', trends.membershipTrend || [], 'total', value => `${value} 人`, COLORS.blue)

    sectionTitle('收入趋势')
    drawTrend('会员总收益（支付 + 后台人工发放）', revenue.trend || [], 'confirmedFen', money, COLORS.green)

    sectionTitle(
      '会员收入结构',
      `累计支付收入 ${money(revenue.paymentMetrics && revenue.paymentMetrics.all && revenue.paymentMetrics.all.confirmedFen)}；` +
      `累计后台人工会员 ${money(revenue.manualMetrics && revenue.manualMetrics.all && revenue.manualMetrics.all.confirmedFen)}。`
    )
    drawPackageStructure(revenue.packages || [])

    ensureSpace(90)
    doc.moveDown(0.8)
    doc.roundedRect(42, doc.y, contentWidth, 66, 7).fill(COLORS.panel)
    const noteY = doc.y + 13
    doc.fillColor(COLORS.muted).fontSize(8.5).text(
      '备注：支付收入按真实支付成功时间统计，人工会员收益按后台发放时间统计。历史人工记录缺少可靠价格或唯一操作 ID 时不推算金额；退款仅在支付订单存在明确退款字段时扣减。',
      56,
      noteY,
      { width: contentWidth - 28, lineGap: 3 }
    )

    const range = doc.bufferedPageRange()
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex)
      doc.fillColor('#98A2B3').fontSize(7.5).text(
        `杨勤口才训练KEEP  ·  ${pageIndex + 1} / ${range.count}`,
        42,
        doc.page.height - 25,
        { width: contentWidth, height: 10, align: 'center', lineBreak: false }
      )
    }
    doc.end()
  })
}

module.exports = {
  buildOperationsPdf
}
