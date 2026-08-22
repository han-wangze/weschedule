// utils/conflict.js —— 冲突检测（纯前端，无 AI 依赖）
// 设计原则：软/硬分级只依赖 is_deadline（可靠字段），不依赖 75% 准确率的 event_type，
// 因此不存在"类型判错→错误放大"问题。详见 WeSchedule_冲突检测与提醒策略_设计方案.md。

const WD = ['日', '一', '二', '三', '四', '五', '六'];
function pad(n) { return n < 10 ? '0' + n : '' + n; }

// "HH:MM" -> 分钟数；非法返回 null
function toMin(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// 星期标签，如 "周三"
function weekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return '周' + WD[d.getDay()];
}

// 时长（分钟）：有结束时间用结束-开始，否则默认 60
function durationOf(e) {
  const s = toMin(e.start_time);
  const en = toMin(e.end_time);
  if (s != null && en != null && en > s) return en - s;
  return 60;
}

// 两事件是否"同天有交集"。DDL 视为占用整天 -> 同日期即相交（软冲突由调用方定级）。
function overlaps(a, b) {
  if (a.is_deadline || b.is_deadline) return true;
  const sa = toMin(a.start_time);
  const sb = toMin(b.start_time);
  if (sa == null || sb == null) return false;
  const ea = sa + durationOf(a);
  const eb = sb + durationOf(b);
  return sa < eb && sb < ea;
}

// 对一组事件做冲突检测，返回 [{a, b, level}]，level: 'hard' | 'soft'
// 规则：双方均为定点事项(is_deadline=false)且时间重叠 -> 硬冲突；
//      其余同天相交(含任一方 DDL) -> 软冲突。
// 无日期(date 为 null，模糊时间)的事件不参与。
function detectConflicts(events) {
  const arr = (events || []).filter((e) => e && e.date);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (a.date !== b.date) continue;
      if (!overlaps(a, b)) continue;
      const hard = !a.is_deadline && !b.is_deadline;
      out.push({ a, b, level: hard ? 'hard' : 'soft' });
    }
  }
  return out;
}

// 取某事件的所有冲突伙伴（用于 UI 文案）
function partnersOf(event, allConflicts) {
  const res = [];
  for (const c of allConflicts) {
    if (c.a === event) res.push(c.b);
    else if (c.b === event) res.push(c.a);
  }
  return res;
}

// 规则法空闲槽查找：在 date 当天与次日 8:00–22:00 内，找 count 个不撞已有定点事项的等长空隙
// event: 待安排事件；pool: 已有事件（含其它新事件，避免建议互相撞）；count 默认 2
function findFreeSlots(event, pool, count) {
  count = count || 2;
  const dur = durationOf(event);
  const base = new Date(event.date + 'T00:00:00');
  if (isNaN(base)) return [];
  const dates = [];
  for (let off = 0; off <= 1; off++) {
    const d = new Date(base);
    d.setDate(d.getDate() + off);
    dates.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  }
  const makeSlot = (date, s, e) => ({
    date,
    start_time: pad(Math.floor(s / 60)) + ':' + pad(s % 60),
    end_time: pad(Math.floor(e / 60)) + ':' + pad(e % 60),
  });
  const slots = [];
  for (const date of dates) {
    const occ = (pool || [])
      .filter((e) => e.date === date && !e.is_deadline && toMin(e.start_time) != null)
      .map((e) => [toMin(e.start_time), toMin(e.start_time) + durationOf(e)])
      .sort((x, y) => x[0] - y[0]);
    let cursor = 8 * 60;
    const end = 22 * 60;
    for (const [s, e] of occ) {
      if (slots.length >= count) break;
      if (s - cursor >= dur) slots.push(makeSlot(date, cursor, cursor + dur));
      cursor = Math.max(cursor, e);
    }
    if (slots.length < count && end - cursor >= dur) slots.push(makeSlot(date, cursor, cursor + dur));
    if (slots.length >= count) break;
  }
  return slots.slice(0, count);
}

module.exports = { detectConflicts, partnersOf, findFreeSlots, weekday, durationOf, toMin };
