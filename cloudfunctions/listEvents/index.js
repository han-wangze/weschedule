// cloudfunctions/listEvents/index.js —— 读取当前用户 active 日程，按 date 升序
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('events')
    .where({ _openid: OPENID, status: 'active' })
    .orderBy('date', 'asc')
    .limit(100)
    .get();
  return { events: res.data };
};
