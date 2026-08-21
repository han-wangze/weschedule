// cloudfunctions/saveEvent/index.js —— 保存确认后的事件到 events 集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const events = event.events || [];
  if (!events.length) return { success: false, error_code: 'EMPTY' };
  const now = Date.now();
  // 云函数 admin 写入不会自动注入 _openid，必须手动填，否则 listEvents 按 _openid 查不到
  const list = events.map((e) => Object.assign({}, e, { _openid: OPENID, status: 'active', created_at: now }));
  await Promise.all(list.map((e) => db.collection('events').add({ data: e })));
  return { success: true, count: list.length };
};
