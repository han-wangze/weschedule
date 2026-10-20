// cloudfunctions/listEvents/index.js —— 读取当前用户的 active 日程
//
// 旧实现：一条 where(status=active) + orderBy(date asc) + limit(100)。
// 问题：过期日程不会消失，越攒越多，攒满 100 条之后**未来的日程会被静默丢弃**——
// 列表里看不到，用户也不会知道。2026-10-20 评审时记录过这条。
//
// 现在拆成两次查询再合并：
//   ① 有日期的：只从 7 天前开始取（更早的视为归档，不展示，但数据仍在库里）
//   ② 没有日期的（待定日程）：date 为 null 的单独取，避免被日期过滤漏掉
// 前端按「待定 / 未来按天 / 已过期（倒序，最近 5 条）」三区显示。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAST_DAYS = 7;     // 过期项回看窗口
const MAX_DATED = 200;   // 有日期的上限
const MAX_UNDATED = 50;  // 待定项上限

// 云函数跑在 UTC，取北京时间的"今天"
function todayCN() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate());
}

// YYYY-MM-DD 偏移若干天（按北京时间算）
function shiftDate(dateStr, days) {
  const t = new Date(dateStr + 'T00:00:00+08:00').getTime() + days * 86400000;
  const d = new Date(t + 8 * 3600 * 1000);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const since = shiftDate(todayCN(), -PAST_DAYS);
  const col = db.collection('events');

  const [dated, undated] = await Promise.all([
    col.where({ _openid: OPENID, status: 'active', date: _.gte(since) })
      .orderBy('date', 'asc')
      .limit(MAX_DATED)
      .get(),
    col.where({ _openid: OPENID, status: 'active', date: null })
      .limit(MAX_UNDATED)
      .get(),
  ]);

  const datedRows = dated.data || [];
  const undatedRows = undated.data || [];

  return {
    events: datedRows.concat(undatedRows),
    since,
    truncated: datedRows.length >= MAX_DATED,
  };
};
