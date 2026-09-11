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
    showPrivacy: false,  // 隐私授权弹窗显隐
  },

  // 上一次读到的剪贴板内容（不进 data，避免触发渲染）；用于判断"用户是不是复制了新消息"
  _lastClip: '',

  onShow() {
    // 进入页面即尝试读取剪贴板（受隐私保护接口）。
    // 已授权 → 直接读出；未授权 → 微信自动触发 onNeedPrivacyAuthorization 弹一次授权，
    // 用户同意后自动重试读取；拒绝则走 fail 静默处理。
    // 不再手动调 wx.getPrivacySetting 判断 needAuthorization——该开关在授权状态异常时
    // 会持续返回 true，导致永久静默跳过、剪贴板永不读取（表现即"功能没运行"）。
    this.doReadClipboard();
    this.loadRecent();
  },

  // 注：上一版在读取前用 wx.getPrivacySetting 查 needAuthorization 做硬开关，
  // 一旦未授权/授权被清除就永久跳过，已移除。由微信统一处理授权与重试。

  // 用户点「粘贴」：把剪贴板内容填进输入框。
  // 已授权 → 直接读；未授权 → 先触发授权（用户主动点击产生，符合平台要求），同意后再读。
  onPaste() {
    const read = () => {
      wx.getClipboardData({
        success: (res) => {
          const text = (res.data || '').trim();
          if (!text) {
            wx.showToast({ title: '剪贴板是空的', icon: 'none' });
            return;
          }
          this._lastClip = text;
          this.setData({ inputText: text, clipboardText: text, hasClipboard: false });
        },
        fail: () => wx.showToast({ title: '读取失败，请长按输入框粘贴', icon: 'none' }),
      });
    };
    if (!wx.requirePrivacyAuthorize) {
      read();
      return;
    }
    wx.requirePrivacyAuthorize({
      success: read,
      fail: () => wx.showToast({ title: '需要同意隐私协议才能读取剪贴板', icon: 'none' }),
    });
  },

  // ===== 隐私授权弹窗（由 app.js 的 onNeedPrivacyAuthorization 触发显示）=====
  // 弹窗内的"同意"按钮是真正的 <button open-type="agreePrivacyAuthorization">，
  // 点击后才会触发 bindagreeprivacyauthorization → onAgreePrivacy，在那里调用 resolve。
  // ⚠️ resolve 的 buttonId 必须对应页面上真实存在的该按钮 id，否则报 "buttonId is wrong"，
  //    授权永不生效（这正是此前"点同意仍弹框 + 读取失败"的根因）。
  showPrivacyModal() {
    if (!this.data.showPrivacy) this.setData({ showPrivacy: true });
  },

  onViewPrivacy() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }) });
    } else {
      wx.navigateTo({ url: '/pages/privacy/privacy' });
    }
  },

  onAgreePrivacy() {
    const app = getApp();
    const resolve = app.globalData.privacyResolve;
    // buttonId 必须与 wxml 中同意按钮的 id 一致
    if (resolve) resolve({ buttonId: 'agree-btn', event: 'agree' });
    app.globalData.privacyResolve = null;
    this.setData({ showPrivacy: false });
    // 授权成功后补读一次剪贴板（被拦截的那次由微信自动重试，这里兜底确保顶部提示条刷新）
    this.doReadClipboard();
  },

  onDisagreePrivacy() {
    const app = getApp();
    const resolve = app.globalData.privacyResolve;
    // 拒绝时不传 buttonId（用户未通过同意按钮），仅上报 disagree
    if (resolve) resolve({ event: 'disagree' });
    app.globalData.privacyResolve = null;
    this.setData({ showPrivacy: false });
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
      // 隐私未授权或系统拦截时走这里。
      // 隐私相关失败（buttonId is wrong / not authorized）：通常意味着用户在弹窗点了"拒绝"，
      // 弹窗本身已说明，这里完全静默，避免 onShow 场景重复打扰。
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        console.warn('[clipboard] 读取失败:', msg);
        this.setData({ hasClipboard: false, clipboardText: '', clipboardTip: '' });
        const isPrivacy = msg.indexOf('privacy') >= 0 || msg.indexOf('private_') >= 0 || msg.indexOf('auth') >= 0;
        if (isPrivacy) return;
        // 其他系统原因（如未授权剪贴板）：同一会话只提示一次，引导用户手动粘贴
        if (this._clipFailShown) return;
        this._clipFailShown = true;
        wx.showModal({
          title: '剪贴板不可用',
          content: '系统未授权读取剪贴板。你也可以直接在下方输入框粘贴文本。',
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
