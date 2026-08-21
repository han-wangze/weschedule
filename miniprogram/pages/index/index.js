// pages/index/index.js —— 首页：剪贴板读取与解析入口
const api = require('../../utils/api.js');

Page({
  data: {
    clipboardText: '',   // 剪贴板全文，用于解析（修复 P0：此前只存 20 字导致解析截断）
    clipboardTip: '',    // 仅用于提示条预览
    hasClipboard: false,
    inputText: '',
    loading: false,
    recent: [],
  },

  onShow() {
    this.readClipboard();
    this.loadRecent();
  },

  // 读取剪贴板：存全文用于解析，仅用前 30 字做预览提示
  readClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = (res.data || '').trim();
        if (text) {
          this.setData({
            clipboardText: text,
            clipboardTip: text.slice(0, 30),
            hasClipboard: true,
          });
        } else {
          this.setData({ hasClipboard: false, clipboardText: '', clipboardTip: '' });
        }
      },
    });
  },

  onInput(e) { this.setData({ inputText: e.detail.value }); },

  async onParse() {
    // 优先用输入框；为空则回退到剪贴板全文
    const text = (this.data.inputText || '').trim() || this.data.clipboardText;
    if (!text) {
      wx.showToast({ title: '请先复制或粘贴内容', icon: 'none' });
      return;
    }
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      api.logEvent('parse_request', { text_len: text.length });
      const res = await api.parse(text);
      if (!res || !res.success) {
        wx.showToast({ title: '解析失败，请重试', icon: 'none' });
        return;
      }
      // 无日程：引导手动创建（E3）
      if (!res.has_schedule || !res.events || !res.events.length) {
        wx.showModal({
          title: '未识别到日程',
          content: '没有识别到日程信息，你可以手动创建。',
          confirmText: '手动创建',
          cancelText: '返回',
          success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/confirm/confirm?manual=1' }); },
        });
        return;
      }
      // 把原文一并带去确认页，便于"识别有误"上报 badcase（parse_logs 仅存哈希，不存原文）
      const payload = Object.assign({}, res, { raw_text: text });
      wx.navigateTo({ url: '/pages/confirm/confirm?payload=' + encodeURIComponent(JSON.stringify(payload)) });
    } catch (err) {
      wx.showToast({ title: '网络异常，请稍后', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRecent() {
    try {
      const res = await api.listEvents();
      this.setData({ recent: (res.events || []).slice(0, 3) });
    } catch (e) {}
  },
});
