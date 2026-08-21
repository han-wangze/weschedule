# WeSchedule 微信小程序

把微信群聊文本解析成日程的 MVP：复制群消息 → 打开小程序自动读剪贴板 → AI 解析 → 确认卡片 → 保存到小程序日程，并到点用微信订阅消息提醒。

> **重要：方案 A（当前实现）**。原计划"一键写入系统日历（`wx.addPhoneCalendar`）"经真机核验，在用户设备上无系统授权框、设置页也无日历开关，**实测不可用**。因此已改为：日程存入小程序云数据库「我的日程」+ 用微信订阅消息（`remind` 云函数定时触发）做到点提醒，完全替代系统日历的提醒价值。系统日历写入代码已移除。

## 技术栈

- **前端**：原生微信小程序（WXML/WXSS/JS），不引入第三方框架与 UI 组件库，样式手写
- **后端**：微信云开发（云函数 + 云数据库），免服务器、免域名备案、密钥不落前端
- **AI**：DeepSeek（`deepseek-chat`，temperature=0，JSON 输出）

## 目录结构

```
weschedule/
  project.config.json      # 已写入 AppID 与环境根目录配置
  sitemap.json
  miniprogram/
    app.js / app.json / app.wxss
    pages/
      index/              首页：剪贴板读取 + 解析入口（P0 核心）
      confirm/            确认卡片页：多事件编辑 + 保存 + 授权订阅提醒（方案A，已移除系统日历写入）
      list/               我的日程：按日期分组 + 左滑删除
      settings/           我的：隐私入口、反馈入口、版本
      privacy/            隐私协议页
    components/event-card/ 事件只读展示组件
    utils/
      api.js              封装 wx.cloud.callFunction
      format.js           日期/时间戳/描述拼装
  cloudfunctions/
    login/                P0 静默登录（落库 users）
    parse/                核心解析：调 DeepSeek，校验+重试，写 parse_logs
    listEvents/           读 active 日程
    saveEvent/            保存确认事件
    deleteEvent/          软删除
    logEvent/             埋点（写 analytics）
    feedback/             用户授权后的 badcase 反馈
  eval/
    run_eval.py           评测脚本（8:2 固定切分，五层指标）
    corpus/sample.jsonl   10 条语料种子（需扩充到 100 条）
    reports/              badcase 落盘目录
```

## 导入与部署步骤

1. 打开**微信开发者工具** → 「导入项目」→ 目录选 `weschedule/`（含 `project.config.json`）。
2. `project.config.json` 已写入你的 AppID（`wx3c4af526ad1ff19b`），`miniprogram/app.js` 已写入环境 ID（`cloudbase-d5geob3f987725d3d`）。
3. 右键 `cloudfunctions/` 下**每个**函数 → 「上传并部署：云端安装依赖」（共 7 个）。
4. 在云开发控制台 → `parse` 云函数 → 配置 → 环境变量，添加 `DEEPSEEK_API_KEY=你的key`。
5. 云开发控制台 → 数据库 → 新建集合：`users`、`events`、`parse_logs`、`feedback`、`analytics`（权限默认「仅创建者可读写」）。
6. 云函数超时：`parse` 设为 **25s**（其余默认 10s 即可）。
7. **隐私合规（上线必做）**：`app.json` 已加 `"__usePrivacyCheck__": true`，`app.js` 已接入 `wx.onNeedPrivacyAuthorize` 官方授权回调。**必须在 mp 后台「功能 → 隐私保护指引」发布隐私政策**，否则 `getClipboardData` 等隐私接口会被微信拦截、剪贴板读不到。未发布前若想临时跑通，可先把该字段改为 `false`。
8. 重新上传受影响的云函数（本次改过：`parse`、`saveEvent`、`remind`、`deleteEvent`、`feedback` 全部右键「上传并部署：云端安装依赖」）。

> 备案审核期间用「体验版」邀请最多约 90 名体验者即可跑种子，不影响测试。

## 真机核验清单（M0 第 0 天，任务书 2.8）

- [ ] `wx.addPhoneCalendar` 真机调通，确认支持的字段与时间戳单位（秒/毫秒）→ 回填 2.6 待核验 A/B
- [ ] `wx.getClipboardData` 在 iOS / Android 的弹窗行为，文案是否需要调整
- [ ] 云函数里直连 DeepSeek 成功（验证免配服务器域名白名单）
- [ ] 个人主体「工具-效率」类目可选、备案入口明确
- [ ] DeepSeek JSON 输出模式实测可用
- [ ] 开发者工具 + 云开发环境已开通（已完成：env = cloudbase-d5geob3f987725d3d）

## 运行评测

```bash
pip install requests
export DEEPSEEK_API_KEY=sk-xxxx          # Windows: set DEEPSEEK_API_KEY=sk-xxxx
python eval/run_eval.py --prompt v1 --dataset dev
python eval/run_eval.py --prompt v1 --dataset test   # 仅 M3/M4 末跑，作验收
```

语料需扩充到 **100 条**（当前 `sample.jsonl` 仅 10 条种子），配额按任务书 3.2：
A 标准 25 / B 相对时间 20 / C 模糊 10 / D 多日程 10 / E 无日程 15 / F 截止日 10 / G 口语碎片 10。
切分结果固定落盘 `.split.json`，改语料后加 `--resplit` 重新生成。

## 与任务书的差异（实现补遗）

- 新增 **`login`** 云函数：满足 P0「微信静默登录拿 openid」，并在 `users` 集合落首登/活跃记录。
- 新增 **`saveEvent`** 云函数：任务书 2.7 云函数清单遗漏了「保存确认事件」，补此函数写入 `events` 集合。
- 新增 **`analytics`** 集合：任务书 2.4 未定义埋点集合，`logEvent` 写入此处。
- `confirm` 页内置可编辑确认卡片（多事件 swiper 切换）；`event-card` 组件用于列表页只读展示。
- 隐私协议为独立页面 `pages/privacy`，首次启动弹层在 `index.onShow` 触发。

## 后续里程碑（任务书 2.10）

- **M1 核心链路**：parse 接真 LLM；首页剪贴板读取；确认卡片展示
- **M2 完整体验**：日历写入 + 授权流；列表与删除；全异常态
- **M3 eval 达标**：端到端准确率 ≥75%；体验版内测 10 人
- **M4 文档与种子**：封存测试集验收；README/截图；种子扩到 30 人
