// cloudfunctions/logEvent/index.js —— 埋点写入 analytics 集合（不记原文）
// 2026-10-21：补 _openid。此前三条事件（parse_request/parse_confirmed/subscribe_accepted）
// 不带身份，只能数总数、串不成漏斗（同一个人从解析到保存到底走没走完看不出来）。
// openid 由云函数上下文直接取，前端传什么都不采信，防止伪造。
//
// 2026-11-03（邀请外部用户试用前）加固两点：
//   ① 事件名白名单：白名单外直接丢弃。即使被恶意调用，也只能刷已知事件、
//      造不出新事件把统计口径搞脏。
//   ② payload 清洗：只保留一层原始值（string/number/boolean），丢弃嵌套对象与数组，
//      字符串截断、整体超限则清空——否则有人塞个大对象就能把集合撑爆。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 与前端 api.logEvent 的调用点一一对应，新增埋点时两处同步加
const ALLOWED = [
  'parse_request',
  'parse_result',
  'parse_confirmed',
  'event_saved',
  'event_updated',
  'event_deleted',
  'subscribe_accepted',
  'feedback_submitted',
];

const MAX_STR = 100;           // 单个字符串字段最长保留多少字符
const MAX_PAYLOAD_BYTES = 512; // 整个 payload 序列化后的上限

function cleanPayload(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  Object.keys(p).forEach((k) => {
    const v = p[k];
    if (typeof v === 'string') out[k] = v.slice(0, MAX_STR);
    else if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    // 对象/数组/null/undefined 一律丢弃：埋点不需要嵌套结构
  });
  // 二次兜底：键名本身也可能很长，清洗后仍超限就整体清空
  return JSON.stringify(out).length > MAX_PAYLOAD_BYTES ? {} : out;
}

exports.main = async (event) => {
  const name = event && event.event_name;
  if (ALLOWED.indexOf(name) < 0) {
    return { success: false, error_code: 'BAD_EVENT' };
  }
  const { OPENID } = cloud.getWXContext();
  await db.collection('analytics').add({
    data: {
      _openid: OPENID,
      event_name: name,
      payload: cleanPayload(event.payload),
      created_at: Date.now(),
    },
  });
  return { success: true };
};
