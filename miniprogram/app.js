// app.js
App({
  globalData: {
    // 云开发环境 ID（在微信开发者工具云开发控制台获取）
    envId: 'cloudbase-d5geob3f987725d3d',
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云能力，请使用 2.2.3 或以上的基础库');
      return;
    }
    wx.cloud.init({
      env: this.globalData.envId,
      traceUser: true,
    });
    // P0：微信静默登录（拿 openid，不弹授权），在 login 云函数里落库 users 记录
    wx.cloud.callFunction({ name: 'login' }).catch(() => {});

    // 官方隐私授权：当调用受隐私保护的接口（如 getClipboardData）且用户未授权时，
    // 微信会自动触发此回调。需在 mp 后台「功能 → 隐私保护指引」发布隐私政策后才会弹窗。
    if (wx.onNeedPrivacyAuthorize) {
      wx.onNeedPrivacyAuthorize((resolve, reject) => {
        wx.showModal({
          title: '隐私授权',
          content: '复制/粘贴的文本仅用于当次解析，默认不留存原文。查看完整《隐私政策》。',
          confirmText: '同意',
          cancelText: '拒绝',
          success: (r) => { r.confirm ? resolve() : reject(); },
          fail: () => reject(),
        });
      });
    }
  },
});
