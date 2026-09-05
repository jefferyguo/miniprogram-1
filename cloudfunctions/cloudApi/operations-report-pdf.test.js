'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const fontkit = require('fontkit')

const { buildOperationsPdf } = require('./operations-report-pdf')

test('经营报告字体覆盖待注册授权新增文案', () => {
  const font = fontkit.openSync(path.join(__dirname, 'NotoSansCJKsc-AdminReport.ttf'))
  const requiredText = '待注册授权统计期新增预授权统计期领取预授权'
  const missing = Array.from(new Set(Array.from(requiredText)))
    .filter(character => !font.hasGlyphForCodePoint(character.codePointAt(0)))
  assert.deepEqual(missing, [])
})

test('经营报告生成有效 PDF 且不包含手机号明细', async () => {
  const buffer = await buildOperationsPdf({
    title: '2026年8月 用户与会员经营报告',
    startDate: '2026-08-01',
    endDate: '2026-08-08',
    generatedAt: '2026-08-08 12:00:00',
    overview: {
      counts: {
        all: 10,
        ordinary: 6,
        active: 3,
        expired: 1,
        paidConversionRate: 0.2,
        thirtyDayNewUsers: 4,
        expiring7: 1,
        expiring30: 2,
        pendingPreauthorizations: 7,
        periodPreauthorizationsCreated: 3,
        periodPreauthorizationsClaimed: 2
      },
      trends: {
        userTrend: [{ label: '2026-08-07', count: 1 }, { label: '2026-08-08', count: 3 }],
        membershipTrend: [{ label: '2026-08-07', total: 0 }, { label: '2026-08-08', total: 2 }]
      },
      // 报告只允许统计 KPI，不应枚举待注册手机号。
      preauthorizations: [{ phone: '18712343503', status: 'pending' }]
    },
    revenue: {
      metrics: {
        today: { confirmedFen: 3990 },
        week: { confirmedFen: 3990 },
        month: { confirmedFen: 9980 },
        year: { confirmedFen: 9980 }
      },
      trend: [{ label: '2026-08-07', confirmedFen: 0 }, { label: '2026-08-08', confirmedFen: 3990 }],
      packages: [{ membershipLabel: '季度会员', orderCount: 1, confirmedFen: 3990, share: 1 }],
      manualGrantCount: 2
    }
  })
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
  assert.ok(buffer.length > 5000)
  assert.equal(buffer.includes(Buffer.from('18712343503')), false)
})
