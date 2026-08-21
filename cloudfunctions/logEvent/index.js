// cloudfunctions/logEvent/index.js —— 埋点写入 analytics 集合（不记原文）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  await db.collection('analytics').add({
    data: {
      event_name: event.event_name,
      payload: event.payload || {},
      created_at: Date.now(),
    },
  });
  return { success: true };
};
