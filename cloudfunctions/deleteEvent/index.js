// cloudfunctions/deleteEvent/index.js —— 软删除日程（status 改 deleted）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const eventId = event.event_id;
  if (!eventId) return { success: false, error_code: 'MISSING_ID' };
  // 云函数以 admin 运行会绕过安全规则，必须显式校验归属，防止越权删除他人日程
  const { OPENID } = cloud.getWXContext();
  const doc = await db.collection('events').doc(eventId).get();
  if (!doc.data || doc.data._openid !== OPENID) {
    return { success: false, error_code: 'FORBIDDEN' };
  }
  await db.collection('events').doc(eventId).update({
    data: { status: 'deleted', deleted_at: Date.now() },
  });
  return { success: true };
};
