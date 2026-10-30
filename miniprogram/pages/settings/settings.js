// pages/settings/settings.js
const api = require('../../utils/api.js');
const { detectConflicts } = require('../../utils/conflict.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    version: '1.0.0',
    weekRange: '',    // 本周日期范围，如 "10/26 - 11/1"
    weekCount: 0,     // 本周（周一~周日）日程数
    ddlSoon: 0,       // 未来 3 天内（含今天）的截止数
    conflictCount: 0,  // 本周事件里的时间冲突数
    overviewTip: '加载中…',
    canTap: false,     // 有冲突/临近 DDL 时整卡可点跳「日程」
  },

  onShow() {
    this.loadOverview();
  },

  // 用真实的日程数据填充「本周概览」，替代原空头像占位卡（P1 ①）
  async loadOverview() {
    let events = [];
    try {
      const res = await api.listEvents();
      events = (res && res.events) || [];
    } catch (e) {
      this.setData({ overviewTip: '日程读取失败', canTap: false });
      return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 本周一 ~ 本周日（getDay: 0=周日）
    const dow = today.getDay();
    const mondayOffset = (dow === 0 ? -6 : 1 - dow);
    const monday = new Date(today); monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const start = fmtDate(monday);
    const end = fmtDate(sunday);
    const weekRange = (monday.getMonth() + 1) + '/' + monday.getDate()
      + ' - ' + (sunday.getMonth() + 1) + '/' + sunday.getDate();

    // 临近 DDL：未来 3 天（含今天）
    const soon = new Date(today); soon.setDate(today.getDate() + 3);
    const todayStr = fmtDate(today);
    const soonStr = fmtDate(soon);

    const weekEvents = events.filter((e) => e.date && e.date >= start && e.date <= end);
    const weekCount = weekEvents.length;
    const ddlSoon = events.filter(
      (e) => e.is_deadline && e.date >= todayStr && e.date <= soonStr
    ).length;
    const conflictCount = detectConflicts(weekEvents).length;

    let tip;
    let canTap = false;
    if (conflictCount > 0) {
      tip = '本周有 ' + conflictCount + ' 处时间冲突，去处理';
      canTap = true;
    } else if (ddlSoon > 0) {
      tip = ddlSoon + ' 个截止临近，注意安排';
      canTap = true;
    } else if (weekCount > 0) {
      tip = '本周安排清爽 ✓';
    } else {
      tip = '本周暂无日程';
    }

    this.setData({ weekRange, weekCount, ddlSoon, conflictCount, overviewTip: tip, canTap });
  },

  onOverviewTap() {
    if (this.data.canTap) wx.switchTab({ url: '/pages/list/list' });
  },

  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  onFeedback() {
    wx.showModal({
      title: '反馈',
      content: '在确认卡片页点"识别有误"即可上报 badcase，感谢你的反馈。',
      showCancel: false,
    });
  },
});
