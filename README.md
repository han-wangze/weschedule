# WeSchedule

把微信群聊消息变成可管理的日程——微信小程序 MVP。

复制群消息 → 小程序自动读取剪贴板 → DeepSeek 结构化解析 → 确认保存 → 订阅消息到点提醒。在"解析成一条提醒"之上，还提供软/硬分级的冲突检测、DDL 区间识别与预备提醒，回答的是"日程装不装得下"。

## 为什么做

87 名西交大学生调研：80% 因信息过载遗漏重要事项，45.6% 认为手动录入日程繁琐，87.4% 愿意使用"消息转日程"；冲突检测是第一智能功能需求（70.1%）。调研提要见文末作品集链接。

## 核心功能

- **消息解析**：DeepSeek（`deepseek-chat`，temperature=0，JSON 模式）把自然语言群消息解析为结构化日程（title / date / 起止时间 / 地点 / 参与人 / 是否 DDL / 置信度等字段）
- **冲突检测（软/硬分级）**：硬冲突＝两个定点事项重叠 → 强提示 + 1–2 个一键采纳的备选时段；软冲突＝定点事项落在 DDL 缓冲区间 → 仅弱提示。分级只依赖可靠的 `is_deadline` 字段，刻意不引入新的 AI 类型判断，避免"类型判错 → 冲突等级被放大"
- **预备提醒**：含"材料 / PPT / 准备"等关键词的日程（`is_prep`），提醒提前到前一晚 20:00；复用该事件唯一一次订阅授权，不新增授权请求
- **隐私合规**：解析日志只存 `input_hash`，不留原文；剪贴板读取走微信隐私授权机制，未授权用户走手动粘贴路径，零授权门槛

## 技术栈

- **前端**：原生微信小程序（WXML/WXSS/JS），不引入第三方框架与 UI 组件库
- **后端**：微信云开发（云函数 + 云数据库），免服务器、密钥不落前端
- **AI**：DeepSeek API · **提醒**：微信订阅消息

## 关键指标

- 端到端解析准确率 **75%**（100 条自建语料，dev/test 8:2 双达标；迭代曲线 66.2% → 70.0% → 75.0%）
- test 集 `has_schedule` 判定 F1 = 100%，误报率 0%
- 冲突检测为纯规则实现，准确率接近 100%（已知边界：语义级冲突如"午饭撞午饭"不识别）

## 平台约束驱动的设计决策

个人主体小程序带来三个硬约束，它们定义了产品形态：

1. **不能写系统日历**：`wx.addPhoneCalendar` 经真机核验在用户设备上无系统授权框、实测不可用 → 改为"小程序内日程（云数据库）+ 订阅消息提醒"（方案 A），系统日历写入代码已移除
2. **订阅消息"一次授权一次推送"** → 提醒次数是稀缺资源：预备提醒复用同一授权改到前一晚，而非新增一次推送
3. **隐私合规** → 日志脱敏只存 hash；自动读剪贴板降级为授权后的静默增强

## 工程实践

- **评测闭环驱动 prompt 迭代**：固定语料切分（种子 20260717）+ 相对时间锚点 + 五层指标（has_schedule / 误报率 / 事件级 P·R / 字段准确率 / 端到端正确率），badcase 反向驱动；评测与线上 prompt 双副本同步维护
- **时区修正**：云函数运行在 UTC，`refDate()` 显式换算 UTC+8——修复北京时间凌晨"今天"被算成前一天、提醒锚点落在过去导致永不触发的问题（靠日志 scanned=12 / sent=0 反查定位）
- **隐私授权持久化**：`wx.onNeedPrivacyAuthorization` 的 `resolve({ buttonId })` 必须对应页面上真实存在的 `open-type="agreePrivacyAuthorization"` 按钮，否则授权状态不生效，表现为"点同意仍反复弹窗"（真机踩坑记录）

## 目录结构

```
weschedule/
  project.config.json      # 已写入 AppID 与环境根目录配置
  miniprogram/
    app.js / app.json / app.wxss
    pages/
      index/              首页：剪贴板读取 + 解析入口 + 隐私授权弹窗
      confirm/            确认卡片页：多事件编辑 + 冲突警示 + 授权订阅提醒
      list/               我的日程：按日期分组 + 冲突角标 + 左滑删除
      settings/           我的：隐私入口、反馈入口、版本
      privacy/            隐私协议页
    utils/
      api.js              封装 wx.cloud.callFunction
      conflict.js         冲突检测（detectConflicts / findFreeSlots，纯前端零 AI 依赖）
  cloudfunctions/
    login/                静默登录（落库 users）
    parse/                核心解析：调 DeepSeek，校验+重试，写 parse_logs（只存 hash）
    listEvents/           读 active 日程
    saveEvent/            保存确认事件（计算 is_prep）
    deleteEvent/          软删除
    logEvent/             埋点（写 analytics）
    feedback/             用户授权后的 badcase 反馈
    remind/               定时触发：到点/预备窗口发送订阅消息
  eval/
    run_eval.py           评测脚本（8:2 固定切分，五层指标）
    corpus/               100 条语料
    reports/              badcase 落盘目录
```

## 导入与部署

1. 微信开发者工具 →「导入项目」→ 目录选 `weschedule/`（含 `project.config.json`）。
2. `project.config.json` 已写入 AppID（`wx3c4af526ad1ff19b`），`miniprogram/app.js` 已写入环境 ID（`cloudbase-d5geob3f987725d3d`）。
3. 右键 `cloudfunctions/` 下**每个**函数 →「上传并部署：云端安装依赖」（共 8 个）。
4. 云开发控制台 → `parse` 云函数 → 环境变量，添加 `DEEPSEEK_API_KEY=你的key`。
5. 数据库新建集合：`users`、`events`、`parse_logs`、`feedback`、`analytics`（权限默认「仅创建者可读写」）。
6. 云函数超时：`parse` 设 **25s**，`remind` 建议 **20s**（冷启动 + 发送），其余默认。
7. **隐私合规**：`app.json` 已开启 `__usePrivacyCheck__`，`app.js` 已接入 `wx.onNeedPrivacyAuthorization`；mp 后台「功能 → 隐私保护指引」已发布（声明剪贴板用途）。未发布前真机调试可临时把该字段改为 `false`。
8. `remind` 需单独「上传触发器」（定时触发，每分钟）。

## 运行评测

```bash
pip install requests
export DEEPSEEK_API_KEY=sk-xxxx          # Windows: set DEEPSEEK_API_KEY=sk-xxxx
python eval/run_eval.py --dataset dev
python eval/run_eval.py --dataset test
```

语料 100 条，配额：A 标准 25 / B 相对时间 20 / C 模糊 10 / D 多日程 10 / E 无日程 15 / F 截止日 10 / G 口语碎片 10。切分固定落盘 `.split.json`，改语料后加 `--resplit` 重新生成。也可使用 `eval/run_dev.sh`（Windows: `run_dev.bat`）自动读取 `.env`。

## 后续规划（如继续迭代）

badcase 一键上报 → 置信度驱动 UI → 确认页前置当日全景 → 过载层（周负载条 / DDL 堆积预警 / 准备块自动排程）

## 相关链接

- 作品集展示页：https://han-wangze.github.io/hanwangze/weschedule.html
- 竞争格局与定位：https://han-wangze.github.io/hanwangze/competition.html
- 调研报告提要：https://han-wangze.github.io/hanwangze/report.html
