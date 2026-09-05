const CONTENT_STATE = Object.freeze({
  LOADING: 'CONTENT_LOADING',
  READY: 'CONTENT_READY',
  NETWORK_ERROR: 'CONTENT_NETWORK_ERROR',
  NOT_FOUND: 'CONTENT_NOT_FOUND',
  INACTIVE: 'CONTENT_INACTIVE',
  ACCESS_LOADING: 'ACCESS_LOADING',
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DENIED: 'ACCESS_DENIED'
})

function getTrainingContentStateView(state, message = '') {
  const isLoading = state === CONTENT_STATE.LOADING || state === CONTENT_STATE.ACCESS_LOADING
  return {
    contentLoadState: state,
    contentReady: state === CONTENT_STATE.READY,
    contentError: state === CONTENT_STATE.NETWORK_ERROR,
    contentNotFound: state === CONTENT_STATE.NOT_FOUND || state === CONTENT_STATE.INACTIVE,
    trainingContentLoading: isLoading,
    trainingContentUnavailable: state !== CONTENT_STATE.READY,
    trainingContentMessage: message || (
      state === CONTENT_STATE.LOADING
        ? '正在加载完整训练内容...'
        : state === CONTENT_STATE.ACCESS_LOADING
          ? '正在确认训练权限...'
          : state === CONTENT_STATE.NOT_FOUND
            ? '内容同步中或暂时无法获取。'
            : state === CONTENT_STATE.INACTIVE
              ? '该训练内容已下架。'
              : state === CONTENT_STATE.ACCESS_DENIED
                ? '该训练为会员内容，开通会员后即可练习。'
                : '训练内容读取失败，请检查网络后重试。'
    )
  }
}

module.exports = {
  CONTENT_STATE,
  getTrainingContentStateView
}
