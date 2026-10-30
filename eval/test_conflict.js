// eval/test_conflict.js —— 冲突检测量化测试（纯 Node，无微信依赖）
// 被测对象：miniprogram/utils/conflict.js
// 运行：node eval/test_conflict.js   （退出码 0 = 全绿，1 = 有失败）
//
// 为什么要有这套测试：conflict.js 是"日程治理层"的核心差异化之一，但此前只有
// 人工点界面看效果，没有一条可复跑的断言。这里把它拆成硬/软分级、边界、默认值、
// 空闲槽查找五组 gold 用例，任何规则被改坏都会立刻报出来。

const c = require('../miniprogram/utils/conflict.js');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push({ name, expected: e, actual: a });
  }
}

// ---------------- toMin：时间字符串 -> 分钟数 ----------------
eq('toMin 09:00 = 540', c.toMin('09:00'), 540);
eq('toMin 9:00 单位数小时 = 540', c.toMin('9:00'), 540);
eq('toMin 00:00 = 0', c.toMin('00:00'), 0);
eq('toMin 23:59 = 1439', c.toMin('23:59'), 1439);
eq('toMin 24:00 越界 -> null', c.toMin('24:00'), null);
eq('toMin 09:60 越界 -> null', c.toMin('09:60'), null);
eq('toMin null -> null', c.toMin(null), null);
eq('toMin 非时间串 -> null', c.toMin('abc'), null);
eq('toMin 空串 -> null', c.toMin(''), null);

// ---------------- durationOf：时长默认 60 分钟 ----------------
eq('duration 09:00-10:30 = 90', c.durationOf({ start_time: '09:00', end_time: '10:30' }), 90);
eq('duration 无结束 -> 默认 60', c.durationOf({ start_time: '09:00' }), 60);
eq('duration 结束早于开始 -> 默认 60', c.durationOf({ start_time: '10:00', end_time: '09:00' }), 60);
eq('duration 空对象 -> 60', c.durationOf({}), 60);

// ---------------- weekday：中文星期 ----------------
eq('weekday 2026-10-30 = 周五', c.weekday('2026-10-30'), '周五');
eq('weekday 2026-11-01 = 周日', c.weekday('2026-11-01'), '周日');
eq('weekday 2026-10-26 = 周一', c.weekday('2026-10-26'), '周一');
eq('weekday 非法日期 -> 空串', c.weekday('not-a-date'), '');

// ---------------- detectConflicts：硬/软分级 ----------------
// 1. 两个定点事项同天时间重叠 -> 硬冲突
let r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  { date: '2026-10-30', start_time: '09:30', end_time: '10:30' },
]);
eq('硬冲突：09:00-10:00 vs 09:30-10:30', r.map((x) => x.level), ['hard']);

// 2. 首尾相接（10:00 结束 / 10:00 开始）不算重叠
r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  { date: '2026-10-30', start_time: '10:00', end_time: '11:00' },
]);
eq('首尾相接不判冲突', r.length, 0);

// 3. 同时间但不同天 -> 不冲突
r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  { date: '2026-10-31', start_time: '09:00', end_time: '10:00' },
]);
eq('不同天不判冲突', r.length, 0);

// 4. DDL + 定点事项同天 -> 软冲突（DDL 占整天）
r = c.detectConflicts([
  { date: '2026-10-30', is_deadline: true },
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
]);
eq('DDL + 定点同天 = soft', r.map((x) => x.level), ['soft']);

// 5. 两个 DDL 同天 -> 不判冲突（否则每个 DDL 日都挂警示，真冲突被淹没）
r = c.detectConflicts([
  { date: '2026-10-30', is_deadline: true },
  { date: '2026-10-30', is_deadline: true },
]);
eq('两个 DDL 同天不判冲突', r.length, 0);

// 6. 无日期事件不参与冲突检测
r = c.detectConflicts([
  { date: null, start_time: '09:00', end_time: '10:00' },
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
]);
eq('无日期事件不参与冲突', r.length, 0);

// 7. 定点事项缺 start_time -> 无法比对，不判冲突
r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  { date: '2026-10-30' },
]);
eq('缺开始时间不判冲突', r.length, 0);

// 8. 缺 end_time 时按默认 60 分钟算（09:00 占 09:00-10:00，09:30 落在里面）
r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00' },
  { date: '2026-10-30', start_time: '09:30', end_time: '09:45' },
]);
eq('默认 60 分钟参与重叠判定 -> hard', r.map((x) => x.level), ['hard']);

// 9. 三件事全重叠 -> 3 对（组合数，不是事件数）
r = c.detectConflicts([
  { date: '2026-10-30', start_time: '09:00', end_time: '11:00' },
  { date: '2026-10-30', start_time: '09:30', end_time: '10:30' },
  { date: '2026-10-30', start_time: '10:00', end_time: '10:15' },
]);
eq('三件事全重叠 -> 3 对硬冲突', r.length, 3);

// 10. 空/未定义输入安全
eq('空数组 -> 无冲突', c.detectConflicts([]).length, 0);
eq('undefined -> 无冲突', c.detectConflicts(undefined).length, 0);

// ---------------- partnersOf：取某事件的冲突伙伴 ----------------
const A = { date: '2026-10-30', start_time: '09:00', end_time: '10:00' };
const B = { date: '2026-10-30', start_time: '09:30', end_time: '10:30' };
const cs = c.detectConflicts([A, B]);
eq('partnersOf(A) 命中 1 个', c.partnersOf(A, cs).length, 1);
eq('partnersOf(B) 指向 A', c.partnersOf(B, cs)[0] === A, true);
eq('partnersOf(无关事件) 为空', c.partnersOf({ date: '2026-10-30' }, cs).length, 0);

// ---------------- findFreeSlots：规则法空闲槽 ----------------
// 1. 空日程池，60 分钟事件 -> 当天 08:00 起第一个槽
let slots = c.findFreeSlots({ date: '2026-10-30', start_time: '09:00', end_time: '10:00' }, [], 2);
eq('空池第一个槽 08:00-09:00', slots[0], {
  date: '2026-10-30', start_time: '08:00', end_time: '09:00',
});
eq('空池返回 2 个槽', slots.length, 2);

// 2. 已有 08:00-09:00 占用 -> 顺延到 09:00-10:00
slots = c.findFreeSlots({ date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  [{ date: '2026-10-30', start_time: '08:00', end_time: '09:00' }], 1);
eq('跳过已占用槽 -> 09:00-10:00', slots[0], {
  date: '2026-10-30', start_time: '09:00', end_time: '10:00',
});

// 3. DDL 不占用空闲槽（只有定点事项才算占用）
slots = c.findFreeSlots({ date: '2026-10-30', start_time: '09:00', end_time: '10:00' },
  [{ date: '2026-10-30', is_deadline: true, start_time: '08:00' }], 1);
eq('DDL 不算占用 -> 仍是 08:00', slots[0].start_time, '08:00');

// 4. 当天 08:00-22:00 排满 -> 槽落到次日
const full = [];
for (let h = 8; h < 22; h++) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  full.push({ date: '2026-10-30', start_time: p(h) + ':00', end_time: p(h + 1) + ':00' });
}
slots = c.findFreeSlots({ date: '2026-10-30', start_time: '09:00', end_time: '10:00' }, full, 1);
eq('当天排满 -> 次日 08:00-09:00', slots[0], {
  date: '2026-10-31', start_time: '08:00', end_time: '09:00',
});

// 5. 事件无日期 -> 无从下手，返回空
eq('无日期事件 -> 无建议槽', c.findFreeSlots({}, [], 2).length, 0);

// ---------------- 汇总 ----------------
const total = pass + fail;
console.log('冲突检测量化测试：' + pass + '/' + total + ' 通过');
if (fail) {
  console.log('失败 ' + fail + ' 条：');
  failures.forEach((f, i) => {
    console.log('  ' + (i + 1) + ') ' + f.name);
    console.log('     期望 ' + f.expected);
    console.log('     实际 ' + f.actual);
  });
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
