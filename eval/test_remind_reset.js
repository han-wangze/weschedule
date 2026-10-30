// eval/test_remind_reset.js —— ⑥ remind × updateEvent 配合验证（纯 Node，无云依赖）
// 运行：node eval/test_remind_reset.js   （退出码 0 = 全绿，1 = 有失败）
//
// 要验证的链路（改期不丢提醒、且不重复提醒）：
//   saveEvent 新建      -> reminded: false
//   remind 定时扫描     -> where reminded ≠ true
//   remind 发送成功     -> reminded: true（防重复发）
//   updateEvent 改期    -> reminded 重置 false（否则新时点永远等不到提醒）
//   updateEvent 只改标题 -> reminded 保持不变（否则改个错别字又收一条提醒）
//
// 云函数依赖 wx-server-sdk，无法直接 require 执行，所以用两种手段：
//   ① 源码契约断言：直接读源码文本，断言关键字段/条件还在，防被改回去；
//   ② 逻辑复刻：把 updateEvent 的"提醒签名"判定原样复刻，跑各编辑场景的期望值。
//   ⚠️ 复刻是"照抄当前实现"，若源码判定逻辑变了而签名函数还在，本脚本不会自动跟着变；
//      因此 ① 的契约断言是主保护，② 只保证当前实现的场景语义正确。

const fs = require('fs');
const path = require('path');

const CF = path.join(__dirname, '..', 'cloudfunctions');
const read = (name) => fs.readFileSync(path.join(CF, name, 'index.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name);
  }
}

// ============ ① 源码契约断言 ============
const upd = read('updateEvent');
const save = read('saveEvent');
const remind = read('remind');

ok('updateEvent 保留提醒签名函数 remindSignature', upd.includes('remindSignature'));
ok('updateEvent 时间变化时重置 next.reminded = false', /next\.reminded\s*=\s*false/.test(upd));
ok('updateEvent 重置时清 remind_error = null', /next\.remind_error\s*=\s*null/.test(upd));
ok('updateEvent 重置时清 prep_sent = false', /next\.prep_sent\s*=\s*false/.test(upd));
ok('updateEvent 不再无条件硬塞 reminded:false（旧写法）',
  !/^\s*reminded:\s*false,\s*$/m.test(upd));

ok('saveEvent 新建时初始化 reminded:false', /reminded:\s*false/.test(save));
ok('saveEvent 新建时初始化 status:active', /status:\s*'active'/.test(save));

ok('remind 扫描条件为 reminded ≠ true', /reminded:\s*_\.neq\(true\)/.test(remind));
ok('remind 只扫 status:active 的记录', /status:\s*'active'/.test(remind));
ok('remind 发送成功后置 reminded:true', /reminded:\s*true/.test(remind));
ok('remind 对无日期事件打 NO_DATE 标记', remind.includes('NO_DATE'));
ok('remind 对已过点整组打 MISSED 标记', remind.includes('MISSED'));

// ============ ② 提醒签名逻辑复刻 ============
function remindSignature(e) {
  return JSON.stringify({
    date: e.date || null,
    start_time: e.start_time || null,
    end_time: e.end_time || null,
    is_deadline: !!e.is_deadline,
    reminder_minutes: Number(e.reminder_minutes) || 0,
  });
}

const base = {
  title: '小组会议',
  date: '2026-10-30',
  start_time: '09:00',
  end_time: '10:00',
  is_deadline: false,
  reminder_minutes: 30,
  location: 'A101',
  people: ['甲'],
  fuzzy_time: null,
};

const dirty = (patch) => remindSignature(base) !== remindSignature(Object.assign({}, base, patch));

// 影响提醒时点的 5 个字段：任一变化 -> 重置（应重新提醒）
ok('改开始时间 -> 重置提醒', dirty({ start_time: '14:00' }) === true);
ok('改日期 -> 重置提醒', dirty({ date: '2026-10-31' }) === true);
ok('改结束时间 -> 重置提醒', dirty({ end_time: '11:00' }) === true);
ok('清空结束时间 -> 重置提醒', dirty({ end_time: null }) === true);
ok('切换是否截止日 -> 重置提醒', dirty({ is_deadline: true }) === true);
ok('改提前提醒分钟 -> 重置提醒', dirty({ reminder_minutes: 60 }) === true);

// 不影响提醒时点的字段：不应重置（否则重复提醒）
ok('只改标题 -> 不重置（防改错别字重发）', dirty({ title: '小组会议（修正错别字）' }) === false);
ok('只改地点 -> 不重置', dirty({ location: 'B202' }) === false);
ok('只改参与人 -> 不重置', dirty({ people: ['甲', '乙'] }) === false);
ok('只改模糊时间 -> 不重置', dirty({ fuzzy_time: '下午' }) === false);
ok('改标题+地点+参与人一起 -> 不重置',
  dirty({ title: '新标题', location: 'C303', people: ['丙'] }) === false);

// 缺失字段归一化：老记录没有某字段时不能被误判成"时间变了"
ok('reminder_minutes undefined 与 "0" 视为不变',
  remindSignature({}) === remindSignature({ reminder_minutes: '0' }));
ok('is_deadline undefined 与 false 视为不变',
  remindSignature({}) === remindSignature({ is_deadline: false }));
ok('end_time undefined 与 null 视为不变',
  remindSignature({ end_time: undefined }) === remindSignature({ end_time: null }));

// ============ ③ 扫描条件语义 ============
// where({ reminded: _.neq(true) }) 的语义 = "值不等于 true"。
// ⚠️ 云数据库的 neq 不匹配"字段缺失"的记录 —— 这正是 saveEvent 必须显式写
//    reminded:false 的原因（源码注释已写明），也是上面那条契约断言的由来。
const willScan = (e) => e.reminded !== true;
ok('reminded:false 会被 remind 扫到（改期后能重发）', willScan({ reminded: false }) === true);
ok('reminded:true 不会被重复扫到（发过不重发）', willScan({ reminded: true }) === false);

// ============ 汇总 ============
const total = pass + fail;
console.log('remind × updateEvent 配合验证：' + pass + '/' + total + ' 通过');
if (fail) {
  console.log('失败 ' + fail + ' 条：');
  failures.forEach((n, i) => console.log('  ' + (i + 1) + ') ' + n));
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
