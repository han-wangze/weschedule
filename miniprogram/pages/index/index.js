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
    parseBtnText: '粘贴并解析', // 主按钮文案（B2：单入口自适应）
    parseStage: '',      // B3 等待可见：'' | 'recognizing' | 'organizing' | 'slow'
  },

  // 上一次读到的剪贴板内容（不进 data，避免触发渲染）；用于判断"用户是不是复制了新消息"
  _lastClip: '',

  onShow() {
    // B1：进入页面不再主动读剪贴板（避免一进门就弹隐私授权）。
    // 剪贴板读取改为「用户点击主按钮」时触发，符合"用户主动触发"的合规要求。
    this.loadRecent();
    this.syncBtn();
  },

  // B3：页面销毁时清掉等待文案的定时器（E-09：不清理会在已销毁的页面上 setData）
  onUnload() {
    if (this._stageT1) clearTimeout(this._stageT1);
    if (this._stageT2) clearTimeout(this._stageT2);
    this._stageT1 = null;
    this._stageT2 = null;
  },

  // B9：分享给朋友 / 朋友圈——上线后唯一的自然传播通道，此前完全没有。
  // 标题直接说价值，不用「快来试试」「分享得XX」这类诱导话术（诱导分享是审核红线）。
  onShareAppMessage() {
    return {
      title: '把群里的日程，自动整理好',
      path: '/pages/index/index',
    };
  },

  // 朋友圈分享（基础库版本要求以官方文档核实）
  onShareTimeline() {
    return { title: '把群里的通知，一键拆成日程' };
  },

  // 读取剪贴板文本（Promise 化）。未授权时先走隐私授权（用户主动触发，符合平台要求），
  // 同意后再读；失败或拒绝返回 ''。供「粘贴并解析」按钮在用户点击时调用。
  readClipboardText() {
    return new Promise((resolve) => {
      const read = () => {
        wx.getClipboardData({
          success: (res) => {
            const text = (res.data || '').trim();
            this._lastClip = text;
            resolve(text);
          },
          fail: () => resolve(''),
        });
      };
      if (!wx.requirePrivacyAuthorize) { read(); return; }
      wx.requirePrivacyAuthorize({ success: read, fail: () => resolve('') });
    });
  },

  // 主按钮文案随可用文本自适应（B2：单入口，文案区分来源）
  // B3：解析中不覆盖阶段文案（正在识别/整理成日程/网络有点慢），否则会把进度提示冲掉
  syncBtn() {
    if (this.data.loading) return;
    const t = (this.data.inputText || '').trim();
    const c = (this.data.clipboardText || '').trim();
    const label = t ? '解析日程' : (c ? '解析剪贴板里的消息' : '粘贴并解析');
    if (this.data.parseBtnText !== label) this.setData({ parseBtnText: label });
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

  onInput(e) { this.setData({ inputText: e.detail.value }); this.syncBtn(); },

  onClearInput() { this.setData({ inputText: '' }); this.syncBtn(); },

  async onParse() {
    if (this.data.loading) return;
    // 优先用输入框；为空则回退到剪贴板（用户点击触发，符合隐私合规）
    let text = (this.data.inputText || '').trim();
    if (!text) {
      text = await this.readClipboardText();
      if (text) {
        this.setData({ inputText: text, clipboardText: text, hasClipboard: false });
        this.syncBtn();
      }
    }
    if (!text) {
      wx.showToast({ title: '请先复制群消息，或在下方粘贴', icon: 'none' });
      return;
    }
    // B3 等待可见：点下去立刻换文案，4s 转「整理成日程…」，8s 提示网络慢。
    // 缺这三段文案时，用户点完只看到一个小转圈，8 秒没反馈的第一反应是"卡了"然后退出。
    this.setData({ loading: true, parseStage: 'recognizing', parseBtnText: '正在识别…' });
    this._stageT1 = setTimeout(() => {
      this.setData({ parseStage: 'organizing', parseBtnText: '整理成日程…' });
    }, 4000);
    this._stageT2 = setTimeout(() => {
      this.setData({ parseStage: 'slow', parseBtnText: '网络有点慢…' });
    }, 8000);
    try {
      api.logEvent('parse_request', { text_len: text.length });
      const res = await api.parse(text);
      if (!res || !res.success) {
        // 按 error_code 给文案：不可重试的错误（没配密钥/没看懂）不说"请重试"
        const code = (res && res.error_code) || 'CALL_FAILED';
        api.logEvent('parse_result', { success: false, error_code: code });
        wx.showToast({ title: api.errorText(code, '解析失败，请重试'), icon: 'none' });
        return;
      }
      api.logEvent('parse_result', {
        success: true,
        has_schedule: !!res.has_schedule,
        event_count: (res.events || []).length,
      });
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
      this.syncBtn();
      wx.navigateTo({ url: '/pages/confirm/confirm?payload=' + encodeURIComponent(JSON.stringify(payload)) });
    } catch (err) {
      api.logEvent('parse_result', { success: false, error_code: 'NETWORK' });
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
    } finally {
      // 无论成功失败都要清掉等待文案的定时器，否则页面已离开还会 setData
      clearTimeout(this._stageT1);
      clearTimeout(this._stageT2);
      this._stageT1 = null;
      this._stageT2 = null;
      // 还原按钮文案。不调 syncBtn()：此刻 setData 还没落地，loading 仍是 true，
      // 会被 syncBtn 里的 loading 守卫挡掉。
      const t2 = (this.data.inputText || '').trim();
      const c2 = (this.data.clipboardText || '').trim();
      this.setData({
        loading: false,
        parseStage: '',
        parseBtnText: t2 ? '解析日程' : (c2 ? '解析剪贴板里的消息' : '粘贴并解析'),
      });
    }
  },

  async loadRecent() {
    try {
      const res = await api.listEvents();
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const d = new Date();
      const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      // listEvents 现在会带回最近 7 天的过期项（列表页要用），首页"最近日程"只显示还没到的
      const upcoming = (res.events || []).filter((e) => e.date && e.date >= today);
      this.setData({ recent: upcoming.slice(0, 3) });
    } catch (e) {}
  },
});
