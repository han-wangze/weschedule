// pages/confirm/confirm.js —— 确认卡片页：多事件编辑 + 保存 + 订阅提醒授权（方案 A，系统日历写入已移除）
const api = require('../../utils/api.js');

Page({
  data: {
    events: [],
    index: 0,
    writing: false,
    manual: false,
    requestId: '',
    rawText: '',
  },

  onLoad(options) {
    if (options.payload) {
      const res = JSON.parse(decodeURIComponent(options.payload));
      const events = (res.events || []).map((e) =>
        Object.assign({}, e, { peopleText: (e.people || []).join('、') }));
      this.setData({ events, requestId: res.request_id || '', rawText: res.raw_text || '' });
    } else if (options.manual) {
      this.setData({ events: [this.blankEvent()], manual: true });
    }
  },

  blankEvent() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return {
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

  onSwiper(e) { this.setData({ index: e.detail.current }); },

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
        }).then(() => wx.showToast({ title: '已上报，感谢反馈', icon: 'success' }))
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
      await api.saveEvent(toSave);
      api.logEvent('parse_confirmed', { count: toSave.length, manual: this.data.manual });
      // 2. 方案 A：日程已存入小程序内，提醒由 remind 云函数（订阅消息）负责
      wx.showToast({ title: '已存入我的日程', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/list/list' }), 800);
    } catch (err) {
      wx.showToast({ title: '保存失败：' + (err.errMsg || '未知错误'), icon: 'none' });
    } finally {
      this.setData({ writing: false });
    }
  },
});
