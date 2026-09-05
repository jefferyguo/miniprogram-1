'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const exists = relative => fs.existsSync(path.join(ROOT, relative))
const functionSource = (source, name, nextName) => {
  const start = source.indexOf(`async function ${name}`)
  assert.notEqual(start, -1, `missing function ${name}`)
  const end = nextName ? source.indexOf(`async function ${nextName}`, start + 1) : source.length
  assert.notEqual(end, -1, `missing function ${nextName}`)
  return source.slice(start, end)
}

const TEACHER_PAGE_ROUTES = [
  'pages/teacher-login/teacher-login',
  'pages/teacher-home/teacher-home',
  'pages/teacher-classes/teacher-classes',
  'pages/teacher-review/teacher-review',
  'pages/teacher-favorites/teacher-favorites'
]

test('正式小程序不注册历史教师页面', () => {
  const appJson = read('app.json')
  TEACHER_PAGE_ROUTES.forEach(route => assert.equal(appJson.includes(route), false, route))

  const privateConfig = read('project.private.config.json')
  assert.doesNotMatch(privateConfig, /pages\/teacher-|老师端/)
})

test('正式产品页面不包含教师端导航入口', () => {
  const productFiles = [
    'pages/index/index.js',
    'pages/training/training.js',
    'pages/mine/mine.js',
    'pages/my-works/my-works.js',
    'pages/review/review.js'
  ]
  productFiles.forEach(relative => {
    const source = read(relative)
    assert.doesNotMatch(source, /pages\/teacher-|teacher-(?:home|login|classes|review|favorites)/, relative)
  })
})

test('云端不提供教师跨用户读取学生作品的 action', () => {
  const cloudApi = read('cloudfunctions/cloudApi/index.js')
  assert.doesNotMatch(cloudApi, /async function (?:teacher|listTeacher|getTeacher)[A-Za-z0-9_]*/)
  assert.doesNotMatch(cloudApi, /case ['"](?:teacher|listTeacher|getTeacher)[^'"]*['"]/)
})

test('普通作品接口使用调用者 openid 隔离，公开视频接口拒绝视频', () => {
  const cloudApi = read('cloudfunctions/cloudApi/index.js')
  const getMyWorks = functionSource(cloudApi, 'getMyWorks', 'getPublicSquareWork')
  const getSquareWorkDetail = functionSource(cloudApi, 'getSquareWorkDetail', 'updateWorkAiFeedback')
  const updateWorkAiFeedback = functionSource(cloudApi, 'updateWorkAiFeedback', 'checkAiUsage')

  assert.match(getMyWorks, /\.where\(\{ ownerOpenid: openid \}\)/)
  assert.doesNotMatch(getMyWorks, /event\.(?:ownerOpenid|userId|studentId)/)
  assert.match(getSquareWorkDetail, /if \(isVideoWorkRecord\(work\)\)[\s\S]*VIDEO_SHARE_DISABLED/)
  assert.match(updateWorkAiFeedback, /_id: id,\s*ownerOpenid: openid/)
})

test('后台跨用户列表仅能通过服务端同步 token 调用', () => {
  const cloudApi = read('cloudfunctions/cloudApi/index.js')
  assert.match(cloudApi, /if \(action\.startsWith\('adminWeb'\)\) \{\s*const tokenError = validateAdminWebToken\(event\)/)
  assert.match(cloudApi, /DASHBOARD_ADMIN_SYNC_TOKEN/)
  assert.match(cloudApi, /case 'adminWebListSubmissions':\s*return await adminWebListSubmissions\(event\)/)
})

test('历史教师页面文件已从正式代码包移除', () => {
  TEACHER_PAGE_ROUTES.forEach(route => {
    ;['js', 'json', 'wxml', 'wxss'].forEach(extension => {
      assert.equal(exists(`${route}.${extension}`), false, `${route}.${extension}`)
    })
  })
})

test('历史教师二维码与本地模拟数据写入口已移除', () => {
  const qrCode = read('utils/qrcode.js')
  const localData = read('utils/local-data.js')

  assert.doesNotMatch(qrCode, /generateTeacherLoginQr|pages\/teacher-login/)
  assert.doesNotMatch(localData, /(?:createClass|updateSubmissionById|getFavoriteFolders|addWorkToFavorites)/)
  assert.doesNotMatch(localData, /teacherSession/)
})
