'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('作品列表只为语音显示分享与发布入口', () => {
  const myWorks = source('pages/my-works/my-works.wxml')
  const review = source('pages/review/review.wxml')
  const task = source('pages/task-detail/task-detail.wxml')
  const extra = source('pages/extra-training/extra-training.wxml')

  assert.match(myWorks, /wx:if="{{item\.shareAllowed && item\.isPublic}}"[\s\S]*?open-type="share"/)
  assert.match(myWorks, /wx:if="{{item\.shareAllowed && !item\.isPublic}}"[\s\S]*?showPrivateShareTip/)
  assert.match(myWorks, /wx:if="{{item\.shareAllowed && !item\.isPublic}}"[\s\S]*?publishWork/)
  assert.match(review, /wx:if="{{item\.shareAllowed && item\.isPublic}}"[\s\S]*?open-type="share"/)
  assert.match(review, /wx:if="{{item\.shareAllowed && !item\.isPublic}}"[\s\S]*?publishWork/)
  assert.match(task, /wx:if="{{item\.shareAllowed && !item\.isPublic}}"[\s\S]*?publishDraftToSquare/)
  assert.match(extra, /wx:if="{{item\.shareAllowed && !item\.isPublic}}"[\s\S]*?publishDraftToSquare/)
})

test('公开视频页只保留语音且视频详情关闭系统分享并拒绝路由绕过', () => {
  const squareWxml = source('pages/square/square.wxml')
  const squareJs = source('pages/square/square.js')
  const detailWxml = source('pages/work-detail/work-detail.wxml')
  const detailJs = source('pages/work-detail/work-detail.js')

  assert.doesNotMatch(squareWxml, /previewVideoWork|video-play-btn/)
  assert.doesNotMatch(squareJs, /previewVideoWork|previewVideoByPath/)
  assert.match(detailWxml, /wx:if="{{work\.shareAllowed}}"[\s\S]*?open-type="share"/)
  assert.match(detailJs, /disableShareMenu\(\)/)
  assert.match(detailJs, /VIDEO_SHARE_DISABLED_MESSAGE/)
  assert.match(detailJs, /videoShareBlocked/)
  assert.match(detailJs, /videoShareBlocked: videoShareDisabled/)
  assert.match(detailJs, /if \(!isWorkShareAllowed\(work\)\)/)
  assert.match(detailJs, /onShareAppMessage\(\)[\s\S]*?if \(!isWorkShareAllowed\(this\.data\.work/)
  assert.match(detailJs, /onShareTimeline\(\)[\s\S]*?if \(!isWorkShareAllowed\(this\.data\.work/)
})

test('客户端与云端都禁止视频发布、公开列表和公开详情', () => {
  const workPublic = source('utils/work-public.js')
  const cloudApi = source('cloudfunctions/cloudApi/index.js')
  const squareStats = source('cloudfunctions/cloudApi/square-stats.js')

  assert.match(workPublic, /if \(!isWorkShareAllowed\(work\)\)[\s\S]*VIDEO_SHARE_DISABLED_MESSAGE/)
  assert.match(cloudApi, /const canPublish = work\.isPublic === true && !isVideoWorkRecord\(work\)/)
  assert.match(cloudApi, /getSquareWorks[\s\S]*?collectVisibleSquarePage\(/)
  assert.match(cloudApi, /getSquareWorkDetail[\s\S]*?VIDEO_SHARE_DISABLED/)
  assert.match(cloudApi, /updateWorkPublicStatus[\s\S]*?VIDEO_SHARE_DISABLED/)
  assert.match(squareStats, /isPublicSquareWork[\s\S]*?isVideoWorkRecord\(work\)[\s\S]*?return false/)
})

test('视频录制、上传、AI 点评和本人回看入口保持存在', () => {
  const task = source('pages/task-detail/task-detail.js')
  const extra = source('pages/extra-training/extra-training.js')
  const myWorks = source('pages/my-works/my-works.js')
  const review = source('pages/review/review.js')

  for (const page of [task, extra]) {
    assert.match(page, /createVideoDraft\(/)
    assert.match(page, /syncSubmissionToCloud\(/)
    assert.match(page, /submitWorkRecord\(/)
    assert.match(page, /generateFeedbackForSubmission\(/)
    assert.match(page, /previewVideoByPath\(/)
  }
  assert.match(myWorks, /previewVideoByPath\(/)
  assert.match(review, /previewVideoByPath\(/)
})

test('视频回看仅使用本机短期凭据且预览页关闭系统分享', () => {
  const workMedia = source('utils/work-media.js')
  const videoPreview = source('pages/video-preview/video-preview.js')

  assert.match(workMedia, /setStorageSync\(previewKey/)
  assert.match(workMedia, /video-preview\?previewKey=/)
  assert.doesNotMatch(workMedia, /video-preview\?src=/)
  assert.match(videoPreview, /disableShareMenu\(\)/)
  assert.match(videoPreview, /getStorageSync\(previewKey\)/)
  assert.doesNotMatch(videoPreview, /options\.src/)
})
