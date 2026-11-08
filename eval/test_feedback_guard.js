// eval/test_feedback_guard.js —— feedback 云函数加固验证（纯 Node，无云依赖）
// 运行：node eval/test_feedback_guard.js   （退出码 0 = 全绿）
//
// feedback 是整个项目里唯一会落库原文的函数，2026-11-08 加固了四件事：
//   ① 记 _openid（限流与删除定位都靠它）② raw_text 限长
//   ③ parsed_events / wrong_fields 走字段白名单 ④ 按 openid 限频
// 云函数本身依赖 wx-server-sdk 跑不起来，所以分两层验证：
//   A. 源码契约断言——关键字段与限流逻辑还在，防止被改回去
//   B. 从源码提取 cleanEvents() 跑行为用例（测的是真实源码，不是复刻）

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'cloudfunctions', 'feedback', 'index.js');
const src = fs.readFileSync(SRC, 'utf8');

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

// ============ A. 源码契约断言 ============
ok('写入时记录 _openid', /_openid:\s*OPENID/.test(src));
ok('raw_text 有长度上限', /raw_text:\s*String\([^)]*\)\.slice\(0,\s*MAX_RAW\)/.test(src));
ok('parsed_events 经过 cleanEvents 清洗', /parsed_events:\s*cleanEvents\(/.test(src));
ok('有每分钟频率上限常量', /RATE_MAX\s*=\s*\d+/.test(src));
ok('超频返回 RATE_LIMITED', /error_code:\s*'RATE_LIMITED'/.test(src));
ok('限流按 openid + 时间窗口查', /_openid:\s*OPENID,\s*created_at:\s*_\.gte/.test(src));
ok('note 有长度上限', /note:\s*String\([^)]*\)\.slice\(0,\s*MAX_NOTE\)/.test(src));

// ============ B. 从源码提取 cleanEvents 跑行为用例 ============
const start = src.indexOf('const MAX_RAW');
const end = src.indexOf('exports.main');
if (start < 0 || end < 0) {
  console.log('抽取失败：锚点没找到');
  process.exit(1);
}
const cleanEvents = new Function(src.slice(start, end) + '; return cleanEvents;')();

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name + '（实际 ' + a + '）', a === e);
}

eq('非数组入参 -> 空数组', cleanEvents(null), []);
eq('字符串入参 -> 空数组', cleanEvents('abc'), []);
eq('空数组 -> 空数组', cleanEvents([]), []);

// 正常事件：只保留业务字段，UI 字段（_k / peopleText / conflict）应被丢弃
const one = cleanEvents([{
  _k: 'e0', peopleText: '甲、乙', conflict: true,
  title: '组会', date: '2026-11-09', start_time: '14:00', end_time: '15:00',
  fuzzy_time: null, is_deadline: false, location: 'A101', people: ['甲', '乙'],
}]);
eq('UI 字段被丢弃，业务字段保留', one, [{
  title: '组会', date: '2026-11-09', start_time: '14:00', end_time: '15:00',
  fuzzy_time: null, is_deadline: false, location: 'A101', people: ['甲', '乙'],
}]);

// 超量截断
const many = cleanEvents(Array.from({ length: 50 }, (_, i) => ({ title: 't' + i })));
eq('超过 20 条截断到 20', many.length, 20);

// 字符串截断
eq('title 超 100 字符截断', cleanEvents([{ title: 'x'.repeat(300) }])[0].title.length, 100);
eq('location 超 100 字符截断', cleanEvents([{ location: 'y'.repeat(300) }])[0].location.length, 100);
eq('people 超 20 个截断', cleanEvents([{ people: Array.from({ length: 50 }, (_, i) => 'p' + i) }])[0].people.length, 20);
eq('单个 people 超 30 字符截断', cleanEvents([{ people: ['z'.repeat(100)] }])[0].people[0].length, 30);

// 类型归一
eq('缺 title -> 空串', cleanEvents([{}])[0].title, '');
eq('is_deadline 转布尔', cleanEvents([{ is_deadline: 1 }])[0].is_deadline, true);
eq('location 缺失 -> null', cleanEvents([{}])[0].location, null);
eq('people 非数组 -> 空数组', cleanEvents([{ people: '甲' }])[0].people, []);

// ============ 汇总 ============
const total = pass + fail;
console.log('feedback 加固验证：' + pass + '/' + total + ' 通过');
if (fail) {
  console.log('失败 ' + fail + ' 条：');
  failures.forEach((n, i) => console.log('  ' + (i + 1) + ') ' + n));
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
