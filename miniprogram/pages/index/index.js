// pages/index/index.js —— 首页：剪贴板读取与解析入口
const api = require('../../utils/api.js');

Page({
  data: {
    clipboardText: '',   // 剪贴板全文，用于解析（修复 P0：此前只存 20 字导致解析截断）
    clipboardTip: '',    // 仅用于提示条预览
    hasClipboard: false,
    needPrivacy: false,   // 未同意隐私协议时为 true：不自动读剪贴板，改由用户点击触发
    inputText: '',
    loading: false,
    recent: [],
  },

  // 上一次读到的剪贴板内容（不进 data，避免触发渲染）；用于判断"用户是不是复制了新消息"
  _lastClip: '',

  onShow() {
    this.readClipboard();
    this.loadRecent();
  },

  // 先查隐私授权状态：已授权才自动读剪贴板。
  // 未授权时**不自动触发**隐私接口，否则每次进首页 / 从日程页切回来都会弹授权窗。
  // 官方 FAQ：用户同意过之后再次进入不应重新弹窗；此处改为"需要时由用户点击触发"。
  readClipboard() {
    if (!wx.getPrivacySetting) {
      this.doReadClipboard();
      return;
    }
    wx.getPrivacySetting({
      success: (res) => {
        if (res.needAuthorization) {
          this.setData({ needPrivacy: true, hasClipboard: false });
          return;
        }
        this.setData({ needPrivacy: false });
        this.doReadClipboard();
      },
      fail: () => this.doReadClipboard(),
    });
  },

  // 用户点「同意并读取」：主动触发隐私授权（resolve 在 app.js 里统一处理）
  onAuthorizeAndRead() {
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: () => {
          this.setData({ needPrivacy: false });
          this.doReadClipboard();
        },
        fail: () => {},
      });
      return;
    }
    this.doReadClipboard();
  },

  // 读取剪贴板：存全文用于解析，仅用前 30 字做预览提示
  doReadClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = (res.data || '').trim();
        // 剪贴板换成新内容 → 自动清掉输入框里的旧文本。
        // 典型场景：复制新群消息后再次进入小程序，不必先手动删掉上一次的内容。
        if (text !== this._lastClip) {
          this._lastClip = text;
          if (this.data.inputText) this.setData({ inputText: '' });
        }
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
      // 隐私未授权或系统拦截时走这里。此前没有 fail 回调，被拦截时静默失败，
      // 表现和"没复制内容"完全一样，无法判断究竟是内容为空还是授权被拒。
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        console.warn('[clipboard] 读取失败:', msg);
        this.setData({ hasClipboard: false, clipboardText: '', clipboardTip: '' });
        // 隐私拒绝时明确告知，而不是让用户以为没复制内容（同一会话只提示一次）
        if (this._clipFailShown) return;
        this._clipFailShown = true;
        wx.showModal({
          title: '剪贴板不可用',
          content:
            (msg.indexOf('privacy') >= 0 || msg.indexOf('private_') >= 0 || msg.indexOf('auth') >= 0
              ? '需要你同意隐私协议后才能读取剪贴板。'
              : '系统未授权读取剪贴板。') +
            '你也可以直接在下方输入框粘贴文本。',
          confirmText: '查看协议',
          cancelText: '知道了',
          success: (r) => {
            if (!r.confirm) return;
            if (wx.openPrivacyContract) {
              wx.openPrivacyContract({
                fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }),
              });
            } else {
              wx.navigateTo({ url: '/pages/privacy/privacy' });
            }
          },
        });
      },
    });
  },

  onInput(e) { this.setData({ inputText: e.detail.value }); },

  onClearInput() { this.setData({ inputText: '' }); },

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
      // 解析成功后清空输入框，避免下次进来还残留这次的文本
      this.setData({ inputText: '' });
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
