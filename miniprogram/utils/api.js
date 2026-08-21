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
const logEvent = (eventName, payload = {}) => call('logEvent', { event_name: eventName, payload });
const feedback = (params) => call('feedback', params);

module.exports = { call, login, parse, listEvents, deleteEvent, saveEvent, logEvent, feedback };
