// utils/api.js —— 封装所有云函数调用，前端不经过自家服务器
function call(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => resolve(res.result),
      fail: (err) => reject(err),
    });
  });
}

const login = () => call('login', {});
const parse = (text) => call('parse', { text });
const listEvents = () => call('listEvents', {});
const deleteEvent = (eventId) => call('deleteEvent', { event_id: eventId });
const saveEvent = (events) => call('saveEvent', { events });
const updateEvent = (eventId, event) => call('updateEvent', { event_id: eventId, event });
const feedback = (params) => call('feedback', params);

// 埋点不阻塞主流程：云函数挂了就静默丢掉，不能因为统计失败打断用户操作
const logEvent = (eventName, payload = {}) =>
  call('logEvent', { event_name: eventName, payload }).catch(() => {});

// 云函数 error_code → 用户可见文案。
// 分两类：可重试（超时/网络）与不可重试（没配密钥、没看懂、无权限）——
// 对不可重试错误提示"请重试"是误导，2026-10-21 补。
const ERROR_TEXT = {
  NO_API_KEY: '解析服务未配置密钥，暂时不可用',
  LLM_TIMEOUT: '解析超时，请再试一次',
  PARSE_FAILED: '没看懂这段话，可重试或手动创建',
  RATE_LIMITED: '操作太频繁，请一分钟后再试',
  EMPTY: '没有可保存的内容',
  EMPTY_TITLE: '标题不能为空',
  MISSING_ID: '参数缺失，请重进页面',
  FORBIDDEN: '无权操作这条日程',
};
function errorText(code, fallback) {
  return ERROR_TEXT[code] || fallback || '操作失败，请重试';
}

module.exports = {
  call, login, parse, listEvents, deleteEvent, saveEvent, updateEvent,
  logEvent, feedback, errorText,
};
