// cloudfunctions/saveEvent/index.js —— 保存确认后的事件到 events 集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 预备提醒关键词：命中且非截止日的事件，视为"需要提前准备"，由 remind 改在前一晚发预备提醒
const PREP_RE = /材料|ppt|报告|准备|汇报|答辩|预习|复习|论文|文档|课件|演讲|展示|prep/i;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const events = event.events || [];
  if (!events.length) return { success: false, error_code: 'EMPTY' };
  const now = Date.now();
  // 云函数 admin 写入不会自动注入 _openid，必须手动填，否则 listEvents 按 _openid 查不到
  // 必须初始化 reminded:false —— remind 云函数用 _.neq(true) 筛选，字段缺失的记录不会被匹配（neq 不命中缺失字段），会导致新日程永远收不到提醒
  const list = events.map((e) => {
    const isPrep = !e.is_deadline && PREP_RE.test(e.title || '');
    return Object.assign({}, e, {
      _openid: OPENID,
      status: 'active',
      reminded: false,
      is_prep: !!isPrep,
      created_at: now,
    });
  });
  await Promise.all(list.map((e) => db.collection('events').add({ data: e })));
  return { success: true, count: list.length };
};
