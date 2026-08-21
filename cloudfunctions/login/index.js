// cloudfunctions/login/index.js —— P0 静默登录：拿 openid，落库 users 记录
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const users = db.collection('users');
  const count = await users.where({ _openid: OPENID }).count();
  if (!count.total) {
    await users.add({ data: { created_at: Date.now(), last_active_at: Date.now(), settings: {} } });
  } else {
    await users.where({ _openid: OPENID }).update({ data: { last_active_at: Date.now() } });
  }
  return { openid: OPENID };
};
