// cloudfunctions/remind/index.js —— 定时触发器：发订阅消息提醒（方案 A 替代系统日历）
//
// 核心约束：微信一次性订阅「一次授权 = 一条推送」。旧实现按事件逐条发，
// 一次解析出 3 件事时只有 1 条能发出，另外 2 条在 catch 里被标成 reminded 永久放弃，
// 用户完全无感知。现在改为**按 openid + 日期聚合**：同一天的多件事合并成一条
// 汇总消息，一个 token 覆盖当天全部未提醒事件。
//
// 时点规则：
//   - 取当天「还没过点」的最早一件事作为消息主体，在它的提醒窗口内发出；
//   - 若该事件是预备事件（is_prep），窗口改到前一晚 20:00；
//   - 当天所有事项都已过点 → 整组标记 MISSED，不再重试。
// 没有日期的事件（模糊日程）不参与提醒，直接打 NO_DATE 标记，避免每分钟重复扫描。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 已在 mp 后台申请的「日程提醒」订阅模板 ID
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

// YYYY-MM-DD 偏移若干天（按北京时间算，云函数本身跑在 UTC）
function shiftDate(dateStr, days) {
  const t = new Date(dateStr + 'T00:00:00+08:00').getTime() + days * 86400000;
  const d = new Date(t + 8 * 3600 * 1000);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

// 锚点：截止日取当天 23:59，其余取开始时间（无开始时间按 09:00）
function anchorOf(e) {
  return e.is_deadline ? toMs(e.date, '23:59') : toMs(e.date, e.start_time);
}

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) : t;
}

exports.main = async () => {
  const now = Date.now();
  const res = await db.collection('events')
    .where({ status: 'active', reminded: _.neq(true) })
    .limit(200)
    .get();

  const rows = res.data || [];

  // 无日期事件：不提醒，打标避免每分钟重复扫描
  const undated = rows.filter((e) => !e.date);
  if (undated.length) {
    await Promise.all(undated.map((e) =>
      db.collection('events').doc(e._id)
        .update({ data: { reminded: true, remind_error: 'NO_DATE' } })
    ));
  }

  // 按 openid + 日期聚合
  const groups = {};
  for (const e of rows) {
    if (!e.date) continue;
    const key = e._openid + '|' + e.date;
    (groups[key] = groups[key] || []).push(e);
  }

  let sent = 0;
  let skipped = 0;
  const scanned = rows.length;

  for (const key of Object.keys(groups)) {
    const list = groups[key].sort((a, b) => anchorOf(a) - anchorOf(b));

    // 取当天还没过点的最早一件事做主体
    const subject = list.find((e) => now < anchorOf(e));
    if (!subject) {
      // 当天全部过点：整组标 MISSED，不再重试
      await Promise.all(list.map((e) =>
        db.collection('events').doc(e._id)
          .update({ data: { reminded: true, remind_error: 'MISSED' } })
      ));
      skipped += list.length;
      continue;
    }

    const anchor = anchorOf(subject);
    const mins = Number(subject.reminder_minutes) || 30;
    const startAt = anchor - mins * 60 * 1000;
    const prevEvening = toMs(subject.date, '20:00') - 24 * 3600 * 1000;

    let remindAt = startAt;
    // 截止日不再用「23:59 减整天数」算：1440 分钟减下来正好落在前一天 23:59，
    // 用户睡着的时候弹一条"明天交"。规则改为：提前整天数的，落在截止日前一天 20:00；
    // 不足一天的，仍按分钟从 23:59 往前推（那是当天内的提前量，不会跨到深夜）。
    if (subject.is_deadline) {
      const days = Math.floor(mins / 1440);
      if (days >= 1) remindAt = toMs(shiftDate(subject.date, -days), '20:00');
    }

    let prepMode = false;
    if (subject.is_prep) {
      if (now >= prevEvening && now < anchor) { remindAt = prevEvening; prepMode = true; }
      else if (now >= startAt && now < anchor) { remindAt = startAt; prepMode = true; }
      else continue;
    }
    if (!(now >= remindAt && now < anchor)) continue;

    const n = list.length;
    const timeText = subject.is_deadline
      ? '截止 ' + (subject.start_time || '23:59')
      : (subject.start_time || '待定') + (subject.end_time ? '-' + subject.end_time : '');

    const data = prepMode
      ? {
          thing5: { value: clip(n > 1 ? subject.title + ' 等 ' + n + ' 件' : subject.title, 20) },
          date4: { value: toDateText(subject.date) },
          thing10: { value: clip(subject.location || '无地点', 20) },
          thing11: { value: clip('请准备 · ' + timeText, 20) },
        }
      : {
          thing5: { value: clip(n > 1 ? subject.title + ' 等 ' + n + ' 件' : subject.title, 20) },
          date4: { value: toDateText(subject.date) },
          thing10: { value: clip(subject.location || '无地点', 20) },
          thing11: { value: clip(timeText + (n > 1 ? ' · 共 ' + n + ' 件' : ''), 20) },
        };

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: subject._openid,
        templateId: TEMPLATE_ID,
        page: '/pages/list/list',
        data,
      });
      // 一条推送覆盖整组，全部标已提醒
      await Promise.all(list.map((e) => {
        const upd = { reminded: true };
        if (prepMode && e._id === subject._id) upd.prep_sent = true;
        return db.collection('events').doc(e._id).update({ data: upd });
      }));
      sent += 1;
    } catch (err) {
      // 未授权/授权过期会被微信拒绝：整组标记，避免重复尝试刷额度
      await Promise.all(list.map((e) =>
        db.collection('events').doc(e._id)
          .update({ data: { reminded: true, remind_error: err.errCode || String(err) } })
      ));
      skipped += list.length;
    }
  }

  return { sent, skipped, scanned, groups: Object.keys(groups).length };
};
