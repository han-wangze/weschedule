// cloudfunctions/remind/index.js —— 定时触发器：到点发订阅消息提醒（方案 A 替代系统日历）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 已在 mp 后台申请的“日程提醒”订阅模板 ID
const TEMPLATE_ID = 'o8NPW7Ws0X3KQarN3ZrfrPUwPZViC3S4iLWcD1hHEZQ';

// YYYY-MM-DD + HH:MM → 毫秒时间戳（Asia/Shanghai）
function toMs(dateStr, timeStr) {
  const t = timeStr || '09:00';
  return new Date(dateStr + 'T' + t + ':00+08:00').getTime();
}

// YYYY-MM-DD → YYYY年MM月DD日（订阅消息 date 类型字段要求）
function toDateText(dateStr) {
  const m = (dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr || '待定';
  return m[1] + '年' + m[2] + '月' + m[3] + '日';
}

exports.main = async () => {
  const now = Date.now();
  const res = await db.collection('events')
    .where({ status: 'active', reminded: _.neq(true) })
    .limit(100)
    .get();

  let sent = 0;
  let skipped = 0;
  for (const e of res.data) {
    // 截止日(is_deadline)以当天 23:59 为锚点，其余以开始时间为锚点
    const anchor = e.is_deadline ? toMs(e.date, '23:59') : toMs(e.date, e.start_time);
    const remindAt = anchor - (Number(e.reminder_minutes) || 30) * 60 * 1000;
    // 仅当进入提醒窗口且未过锚点时间才发
    if (now >= remindAt && now < anchor) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: e._openid,
          templateId: TEMPLATE_ID,
          page: '/pages/list/list',
          // 字段 key 必须与此模板一一对应：
          // thing5=日程标题, date4=日程时间(date类型仅日期), thing10=地点, thing11=备注(含时分)
          data: {
            thing5: { value: (e.title || '日程提醒').slice(0, 20) },
            date4: { value: toDateText(e.date) },
            thing10: { value: (e.location || '无地点').slice(0, 20) },
            thing11: { value: ((e.start_time || '') + (e.end_time ? '-' + e.end_time : '') || '待定').slice(0, 20) },
          },
        });
        await db.collection('events').doc(e._id).update({ data: { reminded: true } });
        sent++;
      } catch (err) {
        // 用户未授权/授权过期会被微信拒绝，标记避免重复尝试刷额度
        await db.collection('events').doc(e._id).update({
          data: { reminded: true, remind_error: err.errCode || String(err) },
        });
        skipped++;
      }
    }
  }
  return { sent, skipped, scanned: res.data.length };
};
