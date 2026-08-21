// pages/list/list.js —— 我的日程：按日期分组 + 左滑删除
const api = require('../../utils/api.js');

Page({
  data: { groups: [], offsets: {} },

  onShow() { this.load(); },

  async load() {
    try {
      const res = await api.listEvents();
      this.groupByDate(res.events || []);
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
