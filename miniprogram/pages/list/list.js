// pages/list/list.js —— 我的日程：按日期分组 + 左滑删除 + 冲突标记
const api = require('../../utils/api.js');
const conflict = require('../../utils/conflict.js');

Page({
  data: { groups: [], offsets: {} },

  onShow() { this.load(); },

  async load() {
    try {
      const res = await api.listEvents();
      const events = res.events || [];
      // 标记冲突事项（软/硬都标，列表页只做视觉提示，详情在确认页/编辑时处理）
      const conflictIds = new Set();
      conflict.detectConflicts(events).forEach((c) => {
        if (c.a._id) conflictIds.add(c.a._id);
        if (c.b._id) conflictIds.add(c.b._id);
      });
      events.forEach((e) => { e.conflict = conflictIds.has(e._id); });
      this.groupByDate(events);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  groupByDate(events) {
    const map = {};
    events.forEach((e) => { (map[e.date] = map[e.date] || []).push(e); });
    const groups = Object.keys(map).sort().map((date) => ({ date, items: map[date] }));
    this.setData({ groups });
  },

  onTouchStart(e) { this.startX = e.touches[0].clientX; },

  onTouchMove(e) {
    const dx = e.touches[0].clientX - this.startX;
    const id = e.currentTarget.dataset.id;
    const offset = dx > 0 ? 0 : Math.max(dx, -120);
    this.setData({ ['offsets.' + id]: offset });
  },

  onTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    const offset = this.data.offsets[id] || 0;
    this.setData({ ['offsets.' + id]: offset < -60 ? -120 : 0 });
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除日程',
        content: '确定删除这条日程？',
        confirmText: '删除',
        confirmColor: '#e54d42',
        success: (r) => resolve(!!r.confirm),
      });
    });
    if (!ok) return;
    try {
      await api.deleteEvent(id);
      wx.showToast({ title: '已删除', icon: 'none' });
      this.setData({ ['offsets.' + id]: 0 });
      this.load();
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },
});
