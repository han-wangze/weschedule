// cloudfunctions/logEvent/index.js —— 埋点写入 analytics 集合（不记原文）
// 2026-10-21：补 _openid。此前三条事件（parse_request/parse_confirmed/subscribe_accepted）
// 不带身份，只能数总数、串不成漏斗（同一个人从解析到保存到底走没走完看不出来）。
// openid 由云函数上下文直接取，前端传什么都不采信，防止伪造。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  await db.collection('analytics').add({
    data: {
      _openid: OPENID,
      event_name: event.event_name,
      payload: event.payload || {},
      created_at: Date.now(),
    },
  });
  return { success: true };
};
