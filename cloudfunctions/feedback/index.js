// cloudfunctions/feedback/index.js —— 用户主动授权的 badcase 反馈，存原文
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  await db.collection('feedback').add({
    data: {
      request_id: event.request_id || null,
      raw_text: event.raw_text || '',
      parsed_events: event.parsed_events || null,
      wrong_fields: event.wrong_fields || [],
      note: event.note || '',
      created_at: Date.now(),
    },
  });
  return { success: true };
};
