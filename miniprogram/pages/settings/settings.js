// pages/settings/settings.js
Page({
  data: { version: '1.0.0' },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  onFeedback() {
    wx.showModal({
      title: '反馈',
      content: '在确认卡片页点"识别有误"即可上报 badcase，感谢你的反馈。',
      showCancel: false,
    });
  },
});
