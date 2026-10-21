// cloudfunctions/updateEvent/index.js —— 编辑已保存的日程（列表页「编辑」入口）
// 只做字段更新，不新建记录：一次编辑产生一条更新，而不是"删旧建新"两条痕迹。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 预备提醒关键词：与 saveEvent 保持一致（两处需同步改）
const PREP_RE = /材料|ppt|报告|准备|汇报|答辩|预习|复习|论文|文档|课件|演讲|展示|prep/i;

exports.main = async (event) => {
  const eventId = event.event_id;
  if (!eventId) return { success: false, error_code: 'MISSING_ID' };
  const e = event.event || {};
  if (!e.title) return { success: false, error_code: 'EMPTY_TITLE' };
  // 云函数以 admin 运行会绕过安全规则，必须显式校验归属，防止越权改他人日程
  const { OPENID } = cloud.getWXContext();
  const doc = await db.collection('events').doc(eventId).get();
  if (!doc.data || doc.data._openid !== OPENID) {
    return { success: false, error_code: 'FORBIDDEN' };
  }
  const isPrep = !e.is_deadline && PREP_RE.test(e.title || '');
  await db.collection('events').doc(eventId).update({
    data: {
      title: e.title,
      // 与 saveEvent 一致：缺失日期写 null（不用 undefined，避免字段在库里消失）
      date: e.date || null,
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      fuzzy_time: e.fuzzy_time || null,
      is_deadline: !!e.is_deadline,
      location: e.location || null,
      people: e.people || [],
      reminder_minutes: Number(e.reminder_minutes) || 0,
      is_prep: !!isPrep,
      // 时间可能被改过：重置提醒哨兵，让 remind 按新时间重新发
      // （不重置的话旧时间已提醒过，改到新时间永远等不到提醒）
      reminded: false,
      updated_at: Date.now(),
    },
  });
  return { success: true };
};
