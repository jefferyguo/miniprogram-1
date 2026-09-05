/**
 * 广场评论功能停用验证
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const squareWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'square', 'square.wxml'), 'utf8')
const squareJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'square', 'square.js'), 'utf8')
const workDetailWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'work-detail', 'work-detail.wxml'), 'utf8')
const workDetailJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'work-detail', 'work-detail.js'), 'utf8')
const cloudApi = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'cloudApi', 'index.js'), 'utf8')
const featureFlags = fs.readFileSync(path.join(__dirname, '..', 'utils', 'feature-flags.js'), 'utf8')
const cloudApiClient = fs.readFileSync(path.join(__dirname, '..', 'utils', 'cloud-api.js'), 'utf8')

let pass = 0

// 1. 广场列表不渲染评论按钮
console.log('1. 广场列表不渲染评论按钮')
assert.ok(!squareWxml.includes('comment-action'), 'comment-action button should not exist')
assert.ok(!squareWxml.includes('onOpenComments'), 'onOpenComments handler should not exist')
pass++
console.log('   PASS')

// 2. 广场列表不显示commentCount
console.log('2. 广场列表不显示commentCount')
// commentCount may still be in normalizeWork for data, but shouldn't be rendered as text
assert.ok(!squareWxml.includes('{{item.commentCount'), 'commentCount binding should not exist')
pass++
console.log('   PASS')

// 3. 作品详情不渲染评论列表
console.log('3. 作品详情不渲染评论列表')
assert.ok(!workDetailWxml.includes('comment-card'), 'comment-card should not exist')
assert.ok(!workDetailWxml.includes('comment-list'), 'comment-list should not exist')
assert.ok(!workDetailWxml.includes('comment-item'), 'comment-item should not exist')
pass++
console.log('   PASS')

// 4. 作品详情不渲染评论输入框
console.log('4. 作品详情不渲染评论输入框')
assert.ok(!workDetailWxml.includes('comment-input'), 'comment-input should not exist')
assert.ok(!workDetailWxml.includes('comment-submit'), 'comment-submit should not exist')
assert.ok(!workDetailWxml.includes('comment-compose'), 'comment-compose should not exist')
pass++
console.log('   PASS')

// 5. 页面不自动调用loadComments
console.log('5. work-detail 不自动调用 loadComments')
assert.ok(!workDetailJs.includes('loadComments()'), 'loadComments call should not exist')
assert.ok(!workDetailJs.includes('async loadComments'), 'loadComments method should not exist')
pass++
console.log('   PASS')

// 6. 页面不导入评论API
console.log('6. work-detail 不导入评论API')
assert.ok(!workDetailJs.includes('addSquareComment'), 'addSquareComment import should not exist')
assert.ok(!workDetailJs.includes('listSquareComments'), 'listSquareComments import should not exist')
assert.ok(!workDetailJs.includes('deleteSquareComment'), 'deleteSquareComment import should not exist')
pass++
console.log('   PASS')

// 7. 评论写入返回COMMENT_FEATURE_DISABLED
console.log('7. 评论写入返回 COMMENT_FEATURE_DISABLED')
assert.ok(cloudApi.includes('COMMENT_FEATURE_DISABLED'), 'COMMENT_FEATURE_DISABLED code should exist')
assert.ok(cloudApi.includes('评论功能暂未开放'), 'disabled message should exist')
pass++
console.log('   PASS')

// 8. commentCount不会增加（云端addSquareComment提前返回）
console.log('8. addSquareComment 提前返回不写DB')
const addCommentIdx = cloudApi.indexOf('async function addSquareComment')
const returnIdx = cloudApi.indexOf('return fail', addCommentIdx)
const dbWriteIdx = cloudApi.indexOf('squareComments).add', addCommentIdx)
assert.ok(returnIdx < dbWriteIdx, 'return fail should be before DB write')
pass++
console.log('   PASS')

// 9. 历史评论数据没有删除逻辑
console.log('9. 历史评论数据没有删除逻辑')
assert.ok(!cloudApi.includes('squareComments).remove'), 'no remove on squareComments')
assert.ok(!cloudApi.includes('squareComments).delete'), 'no bulk delete')
pass++
console.log('   PASS')

// 10. 点赞按钮仍存在
console.log('10. 点赞按钮仍存在')
assert.ok(squareWxml.includes('onToggleLike'), 'square like handler exists')
assert.ok(workDetailWxml.includes('onToggleLike'), 'work-detail like handler exists')
pass++
console.log('   PASS')

// 11. 点赞处理函数仍存在
console.log('11. 点赞处理函数仍存在')
assert.ok(squareJs.includes('async toggleLike'), 'square toggleLike method exists')
assert.ok(workDetailJs.includes('async toggleLike'), 'work-detail toggleLike method exists')
pass++
console.log('   PASS')

// 12. 点赞云端action未被修改
console.log('12. 点赞云端 action 未被修改')
assert.ok(cloudApi.includes('async function toggleSquareLike'), 'cloud toggleSquareLike exists')
pass++
console.log('   PASS')

// 13. 分享按钮仍存在
console.log('13. 分享按钮仍存在')
assert.ok(squareWxml.includes('share-action'), 'square share button exists')
assert.ok(squareWxml.includes('open-type="share"'), 'square open-type=share exists')
assert.ok(workDetailWxml.includes('分享作品'), 'work-detail share text exists')
pass++
console.log('   PASS')

// 14. onShareAppMessage仍存在
console.log('14. onShareAppMessage 仍存在')
assert.ok(squareJs.includes('onShareAppMessage'), 'square onShareAppMessage exists')
assert.ok(workDetailJs.includes('onShareAppMessage'), 'work-detail onShareAppMessage exists')
pass++
console.log('   PASS')

// 15. 广场JS不导入评论API
console.log('15. 广场JS不导入评论API')
assert.ok(!squareJs.includes('addSquareComment'), 'square addSquareComment import removed')
assert.ok(!squareJs.includes('listSquareComments'), 'square listSquareComments import removed')
assert.ok(!squareJs.includes('deleteSquareComment'), 'square deleteSquareComment import removed')
pass++
console.log('   PASS')

// 16. 功能开关存在
console.log('16. 功能开关 squareCommentsEnabled = false')
assert.ok(featureFlags.includes('squareCommentsEnabled'), 'feature flag exists')
assert.ok(featureFlags.includes('squareCommentsEnabled: false'), 'feature flag is false')
pass++
console.log('   PASS')

// 17. cloud-api.js 保留评论 API 导出（历史兼容）
console.log('17. cloud-api.js 保留评论 API 导出')
assert.ok(cloudApiClient.includes('addSquareComment'), 'client addSquareComment export exists')
assert.ok(cloudApiClient.includes('listSquareComments'), 'client listSquareComments export exists')
pass++
console.log('   PASS')

// 18. 评论面板不再渲染
console.log('18. 评论面板不再渲染')
assert.ok(!squareWxml.includes('comment-mask'), 'comment-mask removed')
assert.ok(!squareWxml.includes('comment-panel'), 'comment-panel removed')
assert.ok(!squareWxml.includes('comment-composer'), 'comment-composer removed')
pass++
console.log('   PASS')

// 19. 评论状态字段已清理
console.log('19. 评论状态字段已清理')
assert.ok(!squareJs.includes('commentsVisible'), 'commentsVisible removed from square')
assert.ok(!squareJs.includes('commentsLoading'), 'commentsLoading removed from square')
assert.ok(!squareJs.includes('commentSubmitting'), 'commentSubmitting removed from square')
assert.ok(!workDetailJs.includes('commentsLoading'), 'commentsLoading removed from work-detail')
assert.ok(!workDetailJs.includes('commentSubmitting'), 'commentSubmitting removed from work-detail')
pass++
console.log('   PASS')

// 20. deleteSquareComment cloud action 仍保留（历史兼容）
console.log('20. deleteSquareComment 云端保留但不可达')
assert.ok(cloudApi.includes('async function deleteSquareComment'), 'cloud deleteSquareComment still exists')
pass++
console.log('   PASS')

// 21. listSquareComments cloud action 仍保留（历史兼容）
console.log('21. listSquareComments 云端保留但不可达')
assert.ok(cloudApi.includes('async function listSquareComments'), 'cloud listSquareComments still exists')
pass++
console.log('   PASS')

// 22. 点赞导入未被误删
console.log('22. 点赞导入未被误删')
assert.ok(squareJs.includes('toggleSquareLike'), 'square imports toggleSquareLike')
assert.ok(workDetailJs.includes('toggleSquareLike'), 'work-detail imports toggleSquareLike')
pass++
console.log('   PASS')

// 23. git diff --check
console.log('23. git diff --check')
// Cannot run here but should be checked manually
console.log('   SKIP (manual check)')

// 24. WXML事件方法验证
console.log('24. WXML 事件方法验证')
// square.wxml references: onToggleLike, playAudioWork, previewVideoWork, changeFilter, onAudioSliderChange
assert.ok(squareJs.includes('onToggleLike'), 'square has onToggleLike')
assert.ok(squareJs.includes('playAudioWork'), 'square has playAudioWork')
// work-detail.wxml references: onToggleLike, playAudio, goOriginalTask, onAudioSliderChange
assert.ok(workDetailJs.includes('onToggleLike'), 'work-detail has onToggleLike')
assert.ok(workDetailJs.includes('playAudio'), 'work-detail has playAudio')
pass++
console.log('   PASS')

console.log(`\n[check-square-comments-disabled] ${pass}/24 tests passed`)
