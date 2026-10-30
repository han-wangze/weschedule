// cloudfunctions/listEvents/index.js —— 读取当前用户的 active 日程
//
// 历史：旧实现一条 where(status=active) + orderBy(date asc) + limit(100)，
// 过期日程越攒越多，攒满之后**未来的日程被静默丢弃**（2026-10-20 评审记录）。
//
// 2026-10-20 曾改为「where(date >= 7天前) + orderBy(date asc) + limit(200)」，
// 但**升序 + 上限仍会先装满过去**：当 7 天前到未来之间的日程超过 200 条时，
// 被截掉的恰好是**最远的未来**（用户最需要看到的那一头）。这与要修的 bug 同源。
//
// 现在（2026-10-30）拆三次查询，各自独立上限：
//   ① 今天及以后：orderBy(date asc)，limit 200 —— 未来日程永远不会被过去挤掉
//   ② 过去 7 天：orderBy(date desc)，limit 20 —— 前端过期区只展示最近 5 条，20 条足够
//   ③ 没有日期的（待定）：date 为 null 单独取，limit 50
// 超过 7 天的更早日程视为**归档**：数据仍在库里，但产品上不提供入口（刻意决策，非遗漏）——
// 日程工具的用户不会回看三周前的安排，为它加分页状态只会增加复杂度。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAST_DAYS = 7;      // 过期项回看窗口
const MAX_FUTURE = 200;   // 今天及以后的上限
const MAX_PAST = 20;      // 过期项取多少条（前端只展示最近 5 条）
const MAX_UNDATED = 50;   // 待定项上限

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
  const today = todayCN();
  const since = shiftDate(today, -PAST_DAYS);
  const col = db.collection('events');

  const [future, past, undated] = await Promise.all([
    // ① 今天及以后：升序取满上限也只影响"很远的未来"，不会挤掉近处
    col.where({ _openid: OPENID, status: 'active', date: _.gte(today) })
      .orderBy('date', 'asc')
      .limit(MAX_FUTURE)
      .get(),
    // ② 过去 7 天：倒序取最近的一批（前端只展示 5 条，多取一些让分组更完整）
    col.where({ _openid: OPENID, status: 'active', date: _.gte(since).and(_.lt(today)) })
      .orderBy('date', 'desc')
      .limit(MAX_PAST)
      .get(),
    // ③ 待定日程
    col.where({ _openid: OPENID, status: 'active', date: null })
      .limit(MAX_UNDATED)
      .get(),
  ]);

  const futureRows = future.data || [];
  const pastRows = past.data || [];
  const undatedRows = undated.data || [];

  return {
    events: futureRows.concat(pastRows).concat(undatedRows),
    since,
    // 语义修正：只有「未来日程」被上限截断才值得提示用户（过去归档截断是正常的）。
    // 旧版在这里返回的是 datedRows.length >= MAX_DATED，前端从未消费，等于静默。
    truncated: futureRows.length >= MAX_FUTURE,
    truncatedUndated: undatedRows.length >= MAX_UNDATED,
  };
};
