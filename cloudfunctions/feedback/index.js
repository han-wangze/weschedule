// cloudfunctions/feedback/index.js —— 用户主动授权的 badcase 反馈，存原文
//
// ⚠️ 这是整个项目里**唯一会落库原文**的云函数，因此校验必须比别处更严。
// 2026-11-08 加固（此前是裸的 add()，客户端传什么就存什么）：
//   ① 记 _openid —— 否则既无法限流，用户要求删除自己反馈时也定位不到；
//   ② raw_text 限长，与前端 textarea maxlength 一致；
//   ③ parsed_events / wrong_fields 走字段白名单，防止塞任意大对象把集合撑大；
//   ④ 按 openid 限频，防止刷接口。
// 未做 request_id 归属校验：它只用于关联 parse_logs，伪造它没有实际收益，
// 而校验要额外查一次库，成本高于收益。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_RAW = 2000;          // 与 miniprogram/pages/index 的 maxlength 一致
const MAX_NOTE = 200;
const MAX_EVENTS = 20;         // 一次解析最多可能带出的事件数
const RATE_WINDOW_MS = 60000;  // 限流窗口
const RATE_MAX = 5;            // 每分钟最多 5 条反馈

// parsed_events 只保留业务字段；前端可能传 _k / peopleText / conflict 等 UI 字段，一并丢掉
function cleanEvents(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_EVENTS).map((e) => {
    const src = e || {};
    return {
      title: String(src.title || '').slice(0, 100),
      date: src.date || null,
      start_time: src.start_time || null,
      end_time: src.end_time || null,
      fuzzy_time: src.fuzzy_time || null,
      is_deadline: !!src.is_deadline,
      location: src.location ? String(src.location).slice(0, 100) : null,
      people: Array.isArray(src.people)
        ? src.people.slice(0, 20).map((p) => String(p).slice(0, 30))
        : [],
    };
  });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  // 限流：未建索引时这一步会全表扫，但 feedback 数据量很小，可接受
  try {
    const cnt = await db.collection('feedback')
      .where({ _openid: OPENID, created_at: _.gte(Date.now() - RATE_WINDOW_MS) })
      .count();
    if (cnt.total >= RATE_MAX) return { success: false, error_code: 'RATE_LIMITED' };
  } catch (e) {
    // 计数失败就放行：宁可少限，也不能把用户的反馈挡在外面
  }

  await db.collection('feedback').add({
    data: {
      _openid: OPENID,
      request_id: event.request_id ? String(event.request_id).slice(0, 64) : null,
      raw_text: String(event.raw_text || '').slice(0, MAX_RAW),
      parsed_events: cleanEvents(event.parsed_events),
      wrong_fields: Array.isArray(event.wrong_fields)
        ? event.wrong_fields.slice(0, 20).map((f) => String(f).slice(0, 30))
        : [],
      note: String(event.note || '').slice(0, MAX_NOTE),
      created_at: Date.now(),
    },
  });
  return { success: true };
};
