// app.js
App({
  globalData: {
    // 云开发环境 ID（在微信开发者工具云开发控制台获取）
    envId: 'cloudbase-d5geob3f987725d3d',
    // 待处理的隐私授权回调（onNeedPrivacyAuthorization 触发时暂存，供首页弹窗"同意"按钮调用）
    privacyResolve: null,
    privacyInfo: null,
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

    // 官方隐私授权：受隐私保护的接口（如 getClipboardData）未授权时触发此回调。
    // 正确做法：保存 resolve，让当前页面弹出内置合规弹窗（含 open-type="agreePrivacyAuthorization"
    // 的真实同意按钮）。用户点击该按钮才会触发 bindagreeprivacyauthorization，在那里调用
    // resolve({ buttonId, event:'agree' })。
    // ⚠️ buttonId 必须对应页面上真实存在、带 open-type="agreePrivacyAuthorization" 的按钮；
    //    此前用 wx.showModal + 一个不存在的 'agree-btn' 调 resolve，微信报 "buttonId is wrong"，
    //    授权永不生效、状态不持久化，表现为"点同意后再次读剪贴板仍弹框 + 读取失败"。
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve, privacyInfo) => {
        const app = getApp();
        app.globalData.privacyResolve = resolve;
        app.globalData.privacyInfo = privacyInfo || null;
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if (cur && typeof cur.showPrivacyModal === 'function') cur.showPrivacyModal();
      });
    }
  },
});
