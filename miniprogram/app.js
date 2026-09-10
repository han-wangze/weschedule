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

    // 官方隐私授权：当调用受隐私保护的接口（如 getClipboardData）且用户未授权时触发。
    // ⚠️ 官方 API 名为 wx.onNeedPrivacyAuthorization（末尾有 "ation"）——
    //    此前误写成 onNeedPrivacyAuthorize，导致自定义弹窗从未注册成功，实际走的是平台默认弹窗。
    //    需在 mp 后台「设置 → 服务内容声明 → 用户隐私保护指引」发布后才生效。
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        wx.showModal({
          title: '隐私授权',
          content: 'WeSchedule 需要读取你复制的文本以识别其中的日程。文本仅用于当次解析，默认不留存原文。点击「查看协议」可阅读完整《隐私保护指引》。',
          confirmText: '同意',
          cancelText: '查看协议',
          success: (r) => {
            if (r.confirm) {
              resolve({ event: 'agree' });
              return;
            }
            // 必须用官方接口打开隐私指引（平台要求）；不可用则兜底跳小程序内隐私页
            wx.openPrivacyContract({
              fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }),
            });
            // 本次按"未同意"上报；用户下次触发隐私接口时会自动再次询问
            resolve({ event: 'disagree' });
          },
          fail: () => resolve({ event: 'disagree' }),
        });
      });
    }
  },
});
