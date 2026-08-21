// pages/privacy/privacy.js
Page({
  openContract() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂无法打开，请稍后在设置中查看', icon: 'none' }),
    });
  },
});
