// pages/confirm/confirm.js —— 确认卡片页：多事件编辑 + 保存 + 订阅提醒授权（方案 A，系统日历写入已移除）
// 新增：冲突检测（基于 is_deadline 软/硬分级）+ 非阻断内联警示 + 规则法空闲槽建议 chip
const api = require('../../utils/api.js');
const conflict = require('../../utils/conflict.js');

function fmtWhen(e) {
  const wd = conflict.weekday(e.date);
  if (e.is_deadline) return wd + ' 截止日';
  if (e.start_time) return wd + ' ' + e.start_time + (e.end_time ? '-' + e.end_time : '');
  return wd + ' ' + (e.fuzzy_time || '时间待定');
}

Page({
  data: {
    events: [],
    index: 0,
    writing: false,
    manual: false,
    requestId: '',
    rawText: '',
    existing: [],          // 已保存的活跃日程（用于冲突比对）
    editMode: false,       // 列表页「编辑」入口进来时为 true
    currentWarn: null,     // { level:'hard'|'soft'|'info', text, partners:[...] }
    suggestions: [],       // 硬冲突时的规则法空闲槽 chip
    swiperH: 0,            // 表单区高度（px），由 measure() 实测得出
  },

  onLoad(options) {
    this._editId = options.edit_id || '';
    if (options.payload) {
      const res = JSON.parse(decodeURIComponent(options.payload));
      const events = (res.events || []).map((e, i) =>
        Object.assign({}, e, { _k: 'e' + i, peopleText: (e.people || []).join('、') }));
      this.setData({ events, requestId: res.request_id || '', rawText: res.raw_text || '' });
    } else if (options.manual) {
      this.setData({ events: [this.blankEvent()], manual: true });
    }
    // 编辑模式：existing 里就有这条日程本身，等 loadExisting 取回来再挑出来装进表单
    this.loadExisting().then(() => {
      if (!this._editId) return;
      const found = (this.data.existing || []).find((e) => e._id === this._editId);
      if (!found) {
        wx.showToast({ title: '日程不存在或已被删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      this.setData({
        events: [Object.assign({}, found, { _k: 'x0', peopleText: (found.people || []).join('、') })],
        editMode: true,
      });
      wx.setNavigationBarTitle({ title: '编辑日程' });
      this.computeConflicts();
    });
  },

  // 量出「窗口高 - 顶部警示区 - 底部按钮区」，把剩下的高度给 swiper。
  // 不用 100vh：真机上 100vh 比可视区高，配合 page{overflow:hidden} 会把整页裁成空白；
  // 也不给 swiper 用绝对定位撑高，swiper 拿不到确定高度会塌成 0。
  // 2026-10-21：底部按钮区已改 fixed 常驻（见 confirm.wxss），量高失手也不会
  // 再把按钮顶出屏幕；兜底值同步提高到 160px——宁矮勿高。
  measure() {
    wx.nextTick(() => {
      const q = wx.createSelectorQuery().in(this);
      q.select('.top').boundingClientRect();
      q.select('.bottom').boundingClientRect();
      q.exec((res) => {
        let winH = 0;
        try {
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          winH = info.windowHeight || info.screenHeight || 0;
        } catch (e) {}
        const topH = (res && res[0] && res[0].height) || 0;
        // 底部按钮区量不到时按典型高度兜底：宁可让页面多滚一点，也不能把按钮顶出屏幕
        const botH = (res && res[1] && res[1].height) || 160;
        let h = winH ? winH - topH - botH : 420;   // 取不到窗口信息时给个兜底值
        h = Math.max(240, Math.floor(h));
        if (Math.abs(h - (this.data.swiperH || 0)) > 2) this.setData({ swiperH: h });
      });
    });
  },

  // onLoad 时 setData 还没渲染完，量高可能量到 0；onReady 时 DOM 已成型，补量一次
  onReady() { this.measure(); },

  async loadExisting() {
    try {
      const res = await api.listEvents();
      this.setData({ existing: res.events || [] });
    } catch (e) {}
    this.computeConflicts();
  },

  // 计算冲突：新事件之间 + 新事件与已存事件之间
  computeConflicts() {
    const mine = this.data.events;
    // 编辑模式下 existing 里含着被编辑事件本身，先剔除再比对，
    // 否则表单里的副本会和库里的原件判出"与自己冲突"
    const rest = this._editId
      ? this.data.existing.filter((e) => e._id !== this._editId)
      : this.data.existing;
    const pool = mine.concat(rest);
    const all = conflict.detectConflicts(pool);
    this._all = all;
    this.updateCurrent();
  },

  // 依据当前卡片，生成内联警示 + 建议 chip
  // 顶部警示区一变高变矮，表单区可用高度就变了，所以每次更新后都重新量一次
  applyWarn(currentWarn, suggestions) {
    this.setData({ currentWarn, suggestions });
    this.measure();
  },

  updateCurrent() {
    const i = this.data.index;
    const ev = this.data.events[i];
    if (!ev) { this.applyWarn(null, []); return; }
    // 模糊日程（没有日期）无法参与时间比对，不假装能检测：
    // 把边界显式说出来，用户补上日期后同一份检测代码立即生效
    if (!ev.date) {
      this.applyWarn({
        level: 'info',
        text: '这条日程还没定日期，暂不参与冲突检测；补上日期后会立即检查。',
        count: 0,
      }, []);
      return;
    }
    const partners = conflict.partnersOf(ev, this._all || []);
    if (!partners.length) { this.applyWarn(null, []); return; }
    const hard = partners.some((p) => !p.is_deadline && !ev.is_deadline);
    const level = hard ? 'hard' : 'soft';
    const top = partners[0];
    const more = partners.length > 1 ? ' 等 ' + partners.length + ' 个日程' : '';
    const text = '与「' + (top.title || '日程') + '」时间重叠（' + fmtWhen(top) + '）' + more;
    let suggestions = [];
    if (hard && ev.start_time) {
      const pool = this.data.events.concat(this.data.existing).filter((e) => e !== ev);
      // 加 k 作为 wx:key：同一天可能出现两个候选槽，只靠 date 会重 key
      suggestions = conflict.findFreeSlots(ev, pool, 2)
        .map((s) => Object.assign({}, s, { k: s.date + s.start_time }));
    }
    this.applyWarn({ level, text, count: partners.length }, suggestions);
  },

  onPickSlot(e) {
    const slot = e.currentTarget.dataset.slot;
    const i = this.data.index;
    const key = 'events[' + i + ']';
    this.setData({
      [key + '.date']: slot.date,
      [key + '.start_time']: slot.start_time,
      [key + '.end_time']: slot.end_time,
      // 建议槽是确切时间，原来的模糊表述要清掉，否则页面会同时显示两个时间
      [key + '.fuzzy_time']: null,
    });
    this.computeConflicts();
  },

  blankEvent() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return {
      _k: 'm' + (this._mk = (this._mk || 0) + 1),
      title: '',
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      start_time: '09:00',
      end_time: '10:00',
      fuzzy_time: null,
      is_deadline: false,
      location: '',
      people: [],
      peopleText: '',
      reminder_minutes: 30,
      confidence: 1,
    };
  },

  onSwiper(e) {
    this.setData({ index: e.detail.current });
    this.updateCurrent();
  },

  editField(e) {
    const field = e.currentTarget.dataset.field;
    const i = this.data.index;
    this.setData({ ['events[' + i + '].' + field]: e.detail.value });
  },

  editPeople(e) {
    const i = this.data.index;
    const arr = (e.detail.value || '').split(/[，,、\s]+/).filter(Boolean);
    this.setData({ ['events[' + i + '].people']: arr, ['events[' + i + '].peopleText']: e.detail.value });
  },

  toggleDeadline(e) {
    const i = this.data.index;
    this.setData({ ['events[' + i + '].is_deadline']: e.detail.value });
    this.computeConflicts();
  },

  onBack() { wx.navigateBack(); },

  // 识别有误：上报 badcase（不保存，仅把解析结果打标，用于优化模型）
  onFeedback() {
    if (!this.data.requestId) {
      wx.showToast({ title: '无解析记录可上报', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '上报解析有误',
      content: '确认将本条解析结果作为 badcase 上报，用于优化识别准确度？',
      confirmText: '上报',
      success: (r) => {
        if (!r.confirm) return;
        api.feedback({
          request_id: this.data.requestId,
          raw_text: this.data.rawText,
          parsed_events: this.data.events,
          note: '用户标记识别有误',
        }).then(() => {
          api.logEvent('feedback_submitted', {});
          wx.showToast({ title: '已上报，感谢反馈', icon: 'success' });
        })
          .catch(() => wx.showToast({ title: '上报失败', icon: 'none' }));
      },
    });
  },

  // 方案 A：引导用户授权订阅消息（替代系统日历提醒）。必须在用户点击手势内同步触发。
  requestRemindSubscribe() {
    const TEMPLATE_ID = 'o8NPW7Ws0X3KQarN3ZrfrPUwPZViC3S4iLWcD1hHEZQ';
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res[TEMPLATE_ID] === 'accept') api.logEvent('subscribe_accepted', {});
      },
      fail: (err) => { console.warn('requestSubscribeMessage fail', err); },
    });
  },

  // 主按钮（方案 A）：保存到小程序日程 + 引导订阅提醒；系统日历写入在本环境实测不可用，已移除
  async onWrite() {
    if (this.data.writing) return;
    // 订阅授权必须在用户点击手势内同步触发，避免部分微信版本不弹框（放在 await 之前）
    this.requestRemindSubscribe();
    this.setData({ writing: true });
    try {
      // 1. 先存入小程序数据库（E9 防数据丢失）
      const toSave = this.data.events.map((e) => ({
        title: e.title,
        date: e.date,
        start_time: e.start_time || null,
        end_time: e.end_time || null,
        fuzzy_time: e.fuzzy_time || null,
        is_deadline: !!e.is_deadline,
        location: e.location || null,
        people: e.people || [],
        reminder_minutes: Number(e.reminder_minutes) || 0,
        source: this.data.manual ? 'manual' : 'parsed',
      }));
      if (this.data.editMode) {
        const r = await api.updateEvent(this._editId, toSave[0]);
        if (!r || !r.success) {
          wx.showToast({ title: api.errorText(r && r.error_code, '保存失败，请重试'), icon: 'none' });
          return;
        }
        api.logEvent('event_updated', { source: toSave[0].source });
        wx.showToast({ title: '已保存修改', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      const r = await api.saveEvent(toSave);
      if (!r || !r.success) {
        wx.showToast({ title: api.errorText(r && r.error_code, '保存失败，请重试'), icon: 'none' });
        return;
      }
      api.logEvent('parse_confirmed', { count: toSave.length, manual: this.data.manual });
      api.logEvent('event_saved', { count: toSave.length, source: toSave[0].source });
      // 2. 方案 A：日程已存入小程序内，提醒由 remind 云函数（订阅消息）负责
      wx.showToast({ title: '已存入我的日程', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/list/list' }), 800);
    } catch (err) {
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ writing: false });
    }
  },
});
