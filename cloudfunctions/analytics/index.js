// cloudfunctions/analytics/index.js —— 埋点聚合查询（④ L1 轻量看板）
//
// 为什么不做前端页面：十几个试用用户的量级下，看板的价值在"每天扫一眼关键数字"，
// 不值得为它加一个页面 + 权限入口。这里只出一个聚合接口，在云开发控制台
// 「云函数 → analytics → 测试」里传 {"days":7} 即可看结果。
//
// ⚠️ 安全：云函数以 admin 身份运行，会**绕过数据库安全规则**。不校验的话任何用户
// 都能从小程序里调到全站数据（等于数据泄露）。因此白名单必须显式配置：
//   云开发控制台 → 云函数 → analytics → 配置 → 环境变量
//   新增 ADMIN_OPENID = 你自己的 openid（多个用英文逗号分隔）
//   openid 可从「数据库 → analytics 集合」任意一条记录的 _openid 字段取到。
// **未配置时一律拒绝（fail closed）**，避免忘记配就裸奔。
//
// 看什么：试用阶段真正有用的是「卡点差额」而不是转化率百分比——
// 十几个人的百分比噪声太大（5/12 与 8/12 可能只是一个人手滑）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const ADMIN = (process.env.ADMIN_OPENID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 单次聚合返回条数上限（云开发聚合默认只返回少量记录，必须显式放开）
const AGG_LIMIT = 1000;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN.length) {
    return {
      success: false,
      error_code: 'NO_ADMIN_CONFIG',
      hint: '请先在云函数配置里加环境变量 ADMIN_OPENID（你自己的 openid，逗号分隔可配多个）',
    };
  }
  if (ADMIN.indexOf(OPENID) < 0) {
    return { success: false, error_code: 'FORBIDDEN' };
  }

  // days 收敛到 1~90，避免传个天数把整库扫一遍
  const days = Math.min(Math.max(Number(event && event.days) || 7, 1), 90);
  const since = Date.now() - days * 86400000;
  const col = db.collection('analytics');

  // 三个聚合并行：事件分布 / 失败码分布 / 解析成功人数
  const [byEvent, failures, parsedOk] = await Promise.all([
    // 按 (事件名, openid) 分组，一次拿到"次数"和"人数"两个口径
    col.aggregate()
      .match({ created_at: _.gte(since) })
      .group({ _id: { e: '$event_name', o: '$_openid' }, n: $.sum(1) })
      .limit(AGG_LIMIT)
      .end(),
    // 解析失败的错误码分布：直接指向"为什么用不下去"
    col.aggregate()
      .match({ created_at: _.gte(since), event_name: 'parse_result', 'payload.success': false })
      .group({ _id: '$payload.error_code', n: $.sum(1) })
      .limit(100)
      .end(),
    // 解析成功过的用户（去重）
    col.aggregate()
      .match({ created_at: _.gte(since), event_name: 'parse_result', 'payload.success': true })
      .group({ _id: '$_openid' })
      .limit(AGG_LIMIT)
      .end(),
  ]);

  // 把 (事件, openid) 组合汇总成每个事件的总次数与人数
  const agg = {};
  const rows = (byEvent && byEvent.list) || [];
  rows.forEach((r) => {
    const name = (r._id && r._id.e) || '(unknown)';
    const a = agg[name] || (agg[name] = { name, total: 0, users: 0 });
    a.total += r.n;
    a.users += 1; // 每个 (事件, openid) 组合只出现一次，累加即去重人数
  });
  const events = Object.keys(agg)
    .map((k) => agg[k])
    .sort((x, y) => y.total - x.total);

  const usersOf = (name) => (agg[name] ? agg[name].users : 0);
  const funnel = {
    request: usersOf('parse_request'),
    parsedOk: ((parsedOk && parsedOk.list) || []).length,
    confirmed: usersOf('parse_confirmed'),
    saved: usersOf('event_saved'),
    subscribed: usersOf('subscribe_accepted'),
  };

  // 卡点差额（比百分比更耐噪）
  const stuck = {
    // 发起过解析但从未确认保存 → 卡在确认页或中途放弃（最致命的流失点）
    atConfirm: Math.max(funnel.request - funnel.confirmed, 0),
    // 解析成功但未确认 → 解析出来了用户不认（质量问题，直接指向 prompt）
    rejectedParse: Math.max(funnel.parsedOk - funnel.confirmed, 0),
    // 发起过解析但从未成功解析过 → 服务层问题（key / 超时 / 限流）
    neverParsed: Math.max(funnel.request - funnel.parsedOk, 0),
  };

  return {
    success: true,
    range: { days, since: new Date(since).toISOString() },
    events,
    funnel,
    stuck,
    failures: ((failures && failures.list) || []).map((r) => ({
      code: r._id || '(none)',
      n: r.n,
    })),
  };
};
