# WeSchedule

把微信群聊消息变成可管理的日程——微信小程序 MVP。

复制群消息 → 小程序自动读取剪贴板 → DeepSeek 结构化解析 → 确认保存 → 订阅消息到点提醒。在"解析成一条提醒"之上，还提供软/硬分级的冲突检测、DDL 区间识别与预备提醒，回答的是"日程装不装得下"。

## 为什么做

87 名西交大学生调研：80% 因信息过载遗漏重要事项，45.6% 认为手动录入日程繁琐，87.4% 愿意使用"消息转日程"；冲突检测是第一智能功能需求（70.1%）。调研提要见文末作品集链接。

## 核心功能

- **消息解析**：DeepSeek（`deepseek-chat`，temperature=0，JSON 模式）把自然语言群消息解析为结构化日程（title / date / 起止时间 / 地点 / 参与人 / 是否 DDL / 置信度等字段）
- **冲突检测（软/硬分级）**：硬冲突＝两个定点事项重叠 → 强提示 + 1–2 个一键采纳的备选时段；软冲突＝定点事项落在 DDL 当天 → 仅弱提示。两个 DDL 同天不判冲突（"周三交报告"+"周三交作业"是常态，全标等于不标）。分级只依赖可靠的 `is_deadline` 字段，刻意不引入新的 AI 类型判断，避免"类型判错 → 冲突等级被放大"
- **模糊日程边界显式化**：没有日期的事件无法做时间比对，不假装能检测——确认页直接说明"暂不参与冲突检测，补上日期后立即检查"，用户补上日期后同一份检测代码自动生效
- **预备提醒**：含"材料 / PPT / 准备"等关键词的日程（`is_prep`），提醒提前到前一晚 20:00；复用该事件唯一一次订阅授权，不新增授权请求
- **隐私合规**：解析日志只存 `input_hash`，不留原文；剪贴板读取走微信隐私授权机制，未授权用户走手动粘贴路径，零授权门槛
- **解析限流**：同一 openid 每 60 秒最多 10 次真实解析——LLM 按 token 计费，没有频率约束时一个人狂点就能把密钥额度烧穿。实现上**先写占位记录再数窗口**，否则并发请求会全在"数完之前"漏过；被拦的请求落一条 `RATE_LIMITED` 记录便于事后看滥用

## 技术栈

- **前端**：原生微信小程序（WXML/WXSS/JS），不引入第三方框架与 UI 组件库
- **后端**：微信云开发（云函数 + 云数据库），免服务器、密钥不落前端
- **AI**：DeepSeek API · **提醒**：微信订阅消息

## 关键指标

- **整条消息全对率 95.6%**（dev 65/68）、**94.1%**（test 16/17）。分母只算"该有日程"的消息，15 条无日程样本不参与——它们没有标注事件，判不出"解析对不对"
- 同一份 prompt 在 2026-08-21、10-20、10-21 各跑一次，dev 是 88.2%（60/68）→ 91.2%（62/68）→ 95.6%（65/68）。前两次差 2 条，是 `temperature=0` 也不逐字可复现的证据；**第三次的 +3 条来自修正标注**（原标注给"周二小组答辩""后天体检"这类原文没时间的日程填了钟点，违反 prompt 规则 4，模型没编造反而被判错），不是模型变好。合起来看：**100 条语料分辨率约 ±2 条**，给得出量级，给不出小数点后的精度
- 三个提示词版本 dev 侧：77.9% → 82.4% → 95.6%（前两版为 8-21 那批运行，v1.2 为 10-21 重跑；重跑前统一了 10 处与 prompt 规则不一致的标注）
- test 集 `has_schedule` 判定 F1 = 100%，误报率 0%。但 test 只有 20 条、其中无日程样本 3 条，这一层只作旁证
- **编造率**（标注无钟点、模型却填了值）：dev 0、test 0——统一标注后第一次可信读数
- 剩余 badcase 4 条（dev 3 + test 1）。**其中 3 条是配对规则的措辞判罚**（"聚餐"对"一起吃饭"、"上课"对"第一节课换教室"），日期时间全对；唯一真正的解析错是 D007 把"周五"算成了当天
- **措辞口径是诊断项，不进主指标**：评测脚本里有保守同义词表（聚餐/吃饭、上课/第X节课、开会/组会），配对时多认一层，用来把"没理解"和"换了个说法"分开。放宽后 dev 98.5%（67/68）、test 100%（17/17）。**主指标仍用严格措辞**——同义词表是我自己定的，拿它刷分不诚实；它的价值是回答"剩下的错到底是什么性质"
- 冲突检测为纯规则实现，只看 `is_deadline` 一个字段（不引入 AI 类型判断）；**未做量化测试**，已知边界：语义级冲突（"午饭撞午饭"）不识别；模糊日程（无日期）不参与，靠界面提示兜底

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
      list/               我的日程：三区分组（待定/未来/已过期）+ 冲突角标 + 左滑删除/编辑 + 点卡片编辑
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
    updateEvent/          编辑已存日程（校验归属，重置提醒哨兵）
    deleteEvent/          软删除
    logEvent/             埋点（写 analytics，带 openid 串漏斗）
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
3. 右键 `cloudfunctions/` 下**每个**函数 →「上传并部署：云端安装依赖」（共 9 个）。
4. 云开发控制台 → `parse` 云函数 → 环境变量，添加 `DEEPSEEK_API_KEY=你的key`。
5. 数据库新建集合：`users`、`events`、`parse_logs`、`feedback`、`analytics`（权限默认「仅创建者可读写」）。
6. **索引建议**：`parse_logs` 建复合索引 `_openid + created_at`（限流按人按时间窗口计数，不建索引会全表扫）；`events` 建 `_openid + status + date`（列表三区查询）。云开发控制台 → 数据库 → 索引管理。**索引未就绪时限流仍能工作，只是计数变慢。**
7. 云函数超时：`parse` 设 **25s**，`remind` 建议 **20s**（冷启动 + 发送），其余默认。
8. **隐私合规**：`app.json` 已开启 `__usePrivacyCheck__`，`app.js` 已接入 `wx.onNeedPrivacyAuthorization`；mp 后台「功能 → 隐私保护指引」需覆盖两类用途：**剪贴板**（读取群聊文本解析）与**订阅消息**（发送日程提醒）。小程序不收集昵称/头像/手机号/位置，隐私协议页按此口径撰写——后台声明与页面文案必须一致，声明了没用到的权限反而违规。
9. `remind` 需单独「上传触发器」（定时触发，每分钟）。

## 运行评测

评测的完整说明（语料构成、提示词全文与逐条设计意图、六项指标、口径纪律、已知局限、运行史）见 **[docs/eval-method.md](docs/eval-method.md)**。

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
