const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  collectVisibleSquarePage,
  computeSquareStats,
  isPublicSquareWork,
  isVideoWorkRecord,
  querySquareStats
} = require('./square-stats')

async function collectAllPages(records, pageSize = 20, batchSize = 50) {
  const pages = []
  const collected = []
  let cursor = ''
  let hasMore = true
  while (hasMore) {
    const page = await collectVisibleSquarePage(
      async (offset, limit) => records.slice(offset, offset + limit),
      { cursor, pageSize, batchSize }
    )
    pages.push(page.records.length)
    collected.push(...page.records)
    cursor = page.nextCursor
    hasMore = page.hasMore
  }
  return { collected, pages }
}

const PUBLIC_AT_BEIJING_DAY = [
  '2026-08-28 15:59:59',
  '2026-08-28 16:00:00',
  '2026-08-29 15:59:59',
  '2026-08-29 16:00:00'
]

function buildWorks(total = 73) {
  return Array.from({ length: total }, (_, index) => ({
    _id: `public-${index + 1}`,
    isPublic: true,
    status: 'active',
    publicStatus: 'published',
    workType: 'audio',
    audioUrl: `https://example.com/public-${index + 1}.mp3`,
    ownerOpenid: index < 15 ? 'current-user' : 'someone-else',
    publicAt: index < PUBLIC_AT_BEIJING_DAY.length
      ? PUBLIC_AT_BEIJING_DAY[index]
      : '2026-08-20 08:00:00'
  }))
}

function matches(record, condition) {
  if (condition && condition.op === 'and') return condition.values.every(item => matches(record, item))
  if (condition && condition.op === 'or') return condition.values.some(item => matches(record, item))
  return Object.entries(condition || {}).every(([field, expected]) => {
    const actual = record[field]
    if (!expected || typeof expected !== 'object' || !expected.op) return actual === expected
    if (expected.op === 'neq') return actual !== expected.value
    if (expected.op === 'nin') return !expected.values.includes(actual)
    if (expected.op === 'gte') return actual >= expected.value
    if (expected.op === 'lt') return actual < expected.value
    return false
  })
}

function createFakeQuery(records) {
  const command = {
    and: values => ({ op: 'and', values }),
    or: values => ({ op: 'or', values }),
    neq: value => ({ op: 'neq', value }),
    nin: values => ({ op: 'nin', values }),
    gte: value => ({ op: 'gte', value }),
    lt: value => ({ op: 'lt', value })
  }
  const collection = {
    where(condition) {
      let offset = 0
      let limit = records.length
      const query = {
        skip(value) {
          offset = Number(value || 0)
          return query
        },
        limit(value) {
          limit = Number(value || records.length)
          return query
        },
        async get() {
          return {
            data: records
              .filter(record => matches(record, condition))
              .slice(offset, offset + limit)
          }
        },
        async count() {
          return { total: records.filter(record => matches(record, condition)).length }
        }
      }
      return query
    }
  }
  return { collection, command }
}

test('73 database public works stay 73 when the visible list only contains 50', () => {
  const records = buildWorks(73)
  const visiblePage = records.slice(0, 50)
  const stats = computeSquareStats(records, {
    viewer: { openid: 'current-user' },
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })

  assert.equal(visiblePage.length, 50)
  assert.equal(stats.publicCount, 73)
  assert.equal(stats.myPublicCount, 15)
})

test('database count queries return full totals independently of list pagination', async () => {
  const records = buildWorks(73)
  const query = createFakeQuery(records)
  const stats = await querySquareStats({
    ...query,
    viewer: { openid: 'current-user' },
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })

  assert.deepEqual(
    { publicCount: stats.publicCount, todayCount: stats.todayCount, myPublicCount: stats.myPublicCount },
    { publicCount: 73, todayCount: 2, myPublicCount: 15 }
  )
})

test('private, deleted and unpublished records are excluded using square visibility rules', () => {
  const records = buildWorks(2).concat([
    { isPublic: false, status: 'active', publicStatus: 'unpublished' },
    { isPublic: true, status: 'deleted', publicStatus: 'published' },
    { isPublic: true, status: 'active', publicStatus: 'deleted' },
    { isPublic: true, status: 'active', publicStatus: 'unpublished' },
    { isPublic: true, status: 'hidden', publicStatus: 'published' },
    { isPublic: true, status: 'rejected', publicStatus: 'published' },
    { isPublic: true, status: 'active', publicStatus: 'hidden' },
    { isPublic: true, status: 'active', publicStatus: 'published', visibility: 'private' },
    { isPublic: true, status: 'active', publicStatus: 'published', squareStatus: 'blocked' }
  ])

  assert.equal(records.filter(isPublicSquareWork).length, 2)
  assert.equal(computeSquareStats(records, { nowMs: Date.parse('2026-08-29T04:00:00Z') }).publicCount, 2)
})

test('公开语音必须包含当前列表可播放的音频数据', () => {
  const records = [
    { isPublic: true, status: 'active', publicStatus: 'published', workType: 'audio', audioUrl: 'https://example.com/a.mp3' },
    { isPublic: true, status: 'active', publicStatus: 'published', mediaType: 'audio', cloudFileID: 'cloud://env/a.mp3' },
    { isPublic: true, status: 'active', publicStatus: 'published', type: 'audio' }
  ]
  assert.equal(records.filter(isPublicSquareWork).length, 2)
})

test('video records are excluded from public square totals', async () => {
  const records = buildWorks(2).concat([
    {
      isPublic: true,
      status: 'active',
      publicStatus: 'published',
      workType: 'video',
      publicAt: '2026-08-29 02:00:00'
    },
    {
      isPublic: true,
      status: 'active',
      publicStatus: 'published',
      workType: 'audio',
      videoUrl: 'https://example.com/legacy.mp4',
      publicAt: '2026-08-29 02:00:00'
    }
  ])

  assert.equal(isVideoWorkRecord(records[2]), true)
  assert.equal(isVideoWorkRecord(records[3]), true)
  assert.equal(records.filter(isPublicSquareWork).length, 2)
  assert.equal(computeSquareStats(records).publicCount, 2)
  const stats = await querySquareStats({
    ...createFakeQuery(records),
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })
  assert.equal(stats.publicCount, 2)
})

test('统计分页后仍排除混合字段视频，不会只检查第一页', async () => {
  const records = buildWorks(205)
  records[150] = {
    ...records[150],
    workType: 'audio',
    mediaType: 'video'
  }
  const stats = await querySquareStats({
    ...createFakeQuery(records),
    viewer: { openid: 'current-user' },
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })

  assert.equal(stats.publicCount, 204)
})

test('today count uses the Beijing natural-day UTC boundaries', () => {
  const stats = computeSquareStats(buildWorks(4), {
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })

  assert.equal(stats.todayCount, 2)
})

test('publish and delete are reflected by a fresh stats read', () => {
  const records = buildWorks(73)
  const options = { nowMs: Date.parse('2026-08-29T04:00:00Z') }
  assert.equal(computeSquareStats(records, options).publicCount, 73)

  records.push({
    _id: 'new-public',
    isPublic: true,
    status: 'active',
    publicStatus: 'published',
    workType: 'audio',
    audioUrl: 'https://example.com/new-public.mp3',
    publicAt: '2026-08-29 02:00:00'
  })
  assert.equal(computeSquareStats(records, options).publicCount, 74)

  records[0] = { ...records[0], isPublic: false, publicStatus: 'deleted' }
  assert.equal(computeSquareStats(records, options).publicCount, 73)
})

test('8 条公开语音加 5 条历史视频时 total 为 8，分页不改变 total', async () => {
  const audio = buildWorks(8).map((work, index) => ({
    ...work,
    workType: 'audio',
    audioUrl: `https://example.com/${index}.mp3`
  }))
  const video = buildWorks(5).map((work, index) => ({
    ...work,
    _id: `legacy-video-${index}`,
    workType: index % 2 ? 'audio' : 'video',
    mediaType: index % 2 ? 'video' : '',
    videoUrl: `https://example.com/${index}.mp4`
  }))
  const stats = await querySquareStats({
    ...createFakeQuery(audio.concat(video)),
    nowMs: Date.parse('2026-08-29T04:00:00Z')
  })
  assert.equal(audio.slice(0, 3).length, 3)
  assert.equal(stats.publicCount, 8)
})

for (const total of [20, 49, 50, 51, 120, 173]) {
  test(`${total} 条公开语音均可通过分页全部访问`, async () => {
    const result = await collectAllPages(buildWorks(total))
    assert.equal(result.collected.length, total)
    assert.equal(new Set(result.collected.map(item => item._id)).size, total)
    assert.ok(result.pages.every((size, index) => index === result.pages.length - 1 || size === 20))
  })
}

test('173 条作品按 20 条分页并以 13 条结束', async () => {
  const result = await collectAllPages(buildWorks(173))
  assert.deepEqual(result.pages, [20, 20, 20, 20, 20, 20, 20, 20, 13])
})

test('过滤发生在分页收集期间，视频和隐藏记录不会造成 50 条最终上限', async () => {
  const records = [
    ...buildWorks(100).map((work, index) => ({ ...work, _id: `video-${index}`, workType: 'video', videoUrl: `https://example.com/${index}.mp4` })),
    ...buildWorks(80).map((work, index) => ({ ...work, _id: `audio-${index}` })),
    ...buildWorks(20).map((work, index) => ({ ...work, _id: `hidden-${index}`, status: 'hidden' }))
  ]
  const result = await collectAllPages(records)
  assert.equal(result.collected.length, 80)
  assert.equal(new Set(result.collected.map(item => item._id)).size, 80)
})

test('首批 50 条仅 8 条有效时继续扫描并尽量填满当前页', async () => {
  const firstBatch = buildWorks(50).map((work, index) => index < 8
    ? work
    : { ...work, workType: 'video', videoUrl: `https://example.com/${index}.mp4` })
  const records = firstBatch.concat(buildWorks(30).map((work, index) => ({ ...work, _id: `later-${index}` })))
  const page = await collectVisibleSquarePage(
    async (offset, limit) => records.slice(offset, offset + limit),
    { pageSize: 20, batchSize: 50 }
  )
  assert.equal(page.records.length, 20)
  assert.equal(page.hasMore, true)
  assert.ok(Number(page.nextCursor) > 50)
})

test('广场进入、下拉刷新和删除成功后都会重新请求真实 total', () => {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../../pages/square/square.js'), 'utf8')
  assert.match(pageSource, /onShow\(\)[\s\S]*?this\.loadPublicWorks\(\{ reset: true \}\)/)
  assert.match(pageSource, /onPullDownRefresh\(\)[\s\S]*?await this\.loadPublicWorks\(\{ reset: true \}\)/)
  assert.match(pageSource, /deleteMySquareWork\(workId\)[\s\S]*?await this\.loadPublicWorks\(\{ reset: true \}\)/)
  assert.doesNotMatch(pageSource, /if \(this\.data\.publicCount\) return/)
})

test('前端触底加载有并发保护、游标续页、追加去重和刷新代际隔离', () => {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../../pages/square/square.js'), 'utf8')
  assert.match(pageSource, /onReachBottom\(\)[\s\S]*?loadingMore[\s\S]*?!this\.data\.hasMore/)
  assert.match(pageSource, /pageSize: SQUARE_PAGE_SIZE, cursor/)
  assert.match(pageSource, /existingWorks\.concat\(cloudList\)/)
  assert.match(pageSource, /dedupeSquareWorks/)
  assert.match(pageSource, /squareLoadGeneration/)
})
