// utils/format.js —— 日期时间格式化与转换
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayCN(d) {
  return WEEKDAYS[d.getDay()];
}

// 将 YYYY-MM-DD + HH:MM 转成 Unix 时间戳（秒），时区固定 Asia/Shanghai
// 待核验项 B：时间戳单位以真机表现为准，目前按秒实现
function toTimestamp(dateStr, timeStr) {
  const t = timeStr || '09:00';
  const d = new Date(dateStr + 'T' + t + ':00+08:00');
  return Math.floor(d.getTime() / 1000);
}

// 当前（Asia/Shanghai）日期与星期，用于注入解析 prompt 的 ref_date
function todayRef() {
  const now = new Date();
  return { ref_date: formatDate(now), ref_weekday: weekdayCN(now) };
}

// 把事件拼成日历 description 兜底文字（提醒时间 + 模糊时间原文）
function buildDescription(event) {
  const parts = ['由 WeSchedule 创建'];
  if (event.reminder_minutes) {
    parts.push('建议提前 ' + event.reminder_minutes + ' 分钟提醒');
  }
  if (event.fuzzy_time) {
    parts.push('模糊时间原文：' + event.fuzzy_time);
  }
  return parts.join('。') + '。';
}

module.exports = { pad, formatDate, weekdayCN, toTimestamp, todayRef, buildDescription };
