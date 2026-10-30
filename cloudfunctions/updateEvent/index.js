// cloudfunctions/updateEvent/index.js —— 编辑已保存的日程（列表页「编辑」入口）
// 只做字段更新，不新建记录：一次编辑产生一条更新，而不是"删旧建新"两条痕迹。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 预备提醒关键词：与 saveEvent 保持一致（两处需同步改）
const PREP_RE = /材料|ppt|报告|准备|汇报|答辩|预习|复习|论文|文档|课件|演讲|展示|prep/i;

// 提醒签名：只取"能改变提醒时点"的 5 个字段。
// 用它判断这次编辑是否真的动了时间——只改标题/地点/参与人时签名不变，
// 就不该重置 reminded，否则用户改个错别字会再收一条一模一样的提醒。
function remindSignature(e) {
  return JSON.stringify({
    date: e.date || null,
    start_time: e.start_time || null,
    end_time: e.end_time || null,
    is_deadline: !!e.is_deadline,
    reminder_minutes: Number(e.reminder_minutes) || 0,
  });
}

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
  const old = doc.data || {};
  const next = {
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
    updated_at: Date.now(),
  };
  // 时间真的变了才重置提醒哨兵：让 remind 按新时点重新发（不重置的话旧时间已提醒过，
  // 改到新时间永远等不到提醒）。签名没变（仅改标题/地点/参与人）则保留原值，避免重复提醒。
  if (remindSignature(old) !== remindSignature(next)) {
    // 同时清掉上一轮的 MISSED / NO_DATE / 失败码与预备标记，否则排障时会误判成"这次也没发"
    next.reminded = false;
    next.remind_error = null;
    next.prep_sent = false;
  }
  await db.collection('events').doc(eventId).update({ data: next });
  return { success: true, remindReset: next.reminded === false };
};
