// pages/list/list.js —— 我的日程：按日期分组 + 左滑删除 + 点卡片编辑 + 冲突标记
// 2026-10-21：左滑只露「删除」一个按钮。曾试过「删除/编辑」双按钮，真机反馈差：
// 双按钮共 240rpx ≈ 小屏三分之一宽，卡片内容被挤走；且红绿并列刺眼、绿色与主按钮
// 语义混淆。编辑改走"点卡片"（更显眼、无学习成本），左滑只留给低频破坏性操作。
// ⚠️ 左滑位移的三个数（最大位移、吸附阈值、按钮宽度）必须同单位：
//    触摸坐标是 px，按钮宽度写的是 rpx，早年直接拿 -120px 当 -120rpx 用，
//    大屏上卡片滑出按钮两倍远，左边露一条空白（px/rpx 错配）。现在统一按
//    pxPerRpx = 屏宽/750 换算。
const api = require('../../utils/api.js');
const conflict = require('../../utils/conflict.js');

const BTN_W_RPX = 120;        // 删除按钮宽
const REVEAL_RPX = BTN_W_RPX; // 左滑到底露出的总宽度

Page({
  data: { groups: [], offsets: {}, pxPerRpx: 0.5 },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const w = info.windowWidth || info.screenWidth || 375;
      this.setData({ pxPerRpx: w / 750 });
    } catch (e) { /* 取不到屏宽时用 0.5 兜底（375px 基准） */ }
  },

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
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const d = new Date();
    const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

    const dated = {};
    const undated = [];
    events.forEach((e) => {
      if (!e.date) { undated.push(e); return; }
      (dated[e.date] = dated[e.date] || []).push(e);
    });

    const dates = Object.keys(dated).sort();
    // 未来的按日期升序；过期的倒序，单独成区放在最后
    const upcoming = dates.filter((k) => k >= today);
    const past = dates.filter((k) => k < today).slice().reverse();

    const groups = upcoming.map((date) => ({ key: date, date, items: dated[date] }));

    const expired = [];
    past.forEach((k) => expired.push.apply(expired, dated[k]));
    if (expired.length) {
      // 过期项只展示最近 5 条，避免它们把未来的日程挤出视野（数据仍在库里）
      groups.push({
        key: 'expired',
        date: '',
        expired: true,
        total: expired.length,
        items: expired.slice(0, 5),
      });
    }

    // 没有日期的（模糊日程）单独成区，放在最前：这类是还没落地的松散事项，
    // 埋在有日期的列表末尾等于永远想不起来。它们不参与冲突检测与提醒。
    if (undated.length) groups.unshift({ key: 'pending', date: '', pending: true, items: undated });

    this.setData({ groups, pendingCount: undated.length });
  },

  // ===== 左滑手势 =====
  // 纵轴判定优先：页面本身要能上下滚，斜拖时谁轴移得多听谁的，
  // 否则滚动列表时卡片会跟着横向抖。
  onTouchStart(e) {
    const t = e.touches[0];
    this._sx = t.clientX;
    this._sy = t.clientY;
    this._moved = false;
    this._vertical = false;
    this.startX = t.clientX;
  },

  onTouchMove(e) {
    if (this._vertical) return;
    const t = e.touches[0];
    const dx = t.clientX - this._sx;
    const dy = t.clientY - this._sy;
    if (Math.abs(dy) > Math.abs(dx) + 4) { this._vertical = true; return; }
    if (Math.abs(dx) > 8) this._moved = true;
    const maxOff = -(REVEAL_RPX * this.data.pxPerRpx);
    const offset = dx > 0 ? 0 : Math.max(dx, maxOff);
    const id = e.currentTarget.dataset.id;
    this.setData({ ['offsets.' + id]: offset });
  },

  onTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    const reveal = REVEAL_RPX * this.data.pxPerRpx;
    const offset = this.data.offsets[id] || 0;
    // 过半即展开，否则收回
    this.setData({ ['offsets.' + id]: offset < -reveal / 2 ? -reveal : 0 });
  },

  // 点卡片进编辑。手势滑过的（_moved/_vertical）不触发，避免"想左滑结果打开了编辑"。
  onItemTap(e) {
    if (this._moved || this._vertical) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/confirm/confirm?edit_id=' + id });
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
      const r = await api.deleteEvent(id);
      if (!r || !r.success) {
        wx.showToast({ title: api.errorText(r && r.error_code, '删除失败'), icon: 'none' });
        return;
      }
      api.logEvent('event_deleted', {});
      wx.showToast({ title: '已删除', icon: 'none' });
      this.setData({ ['offsets.' + id]: 0 });
      this.load();
    } catch (err) {
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
    }
  },
});
