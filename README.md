# WeSchedule

把微信群聊消息转成可管理的日程。微信小程序，原生开发 + 云开发。

**项目状态：已完成真机测试，目前以体验版小范围试用；尚未正式发布。**

核心链路（解析 → 确认 → 保存 → 提醒）已跑通，解析质量有独立评测体系；但试用人数有限，还没有足够的真实使用数据来评估留存或使用效果。

复制群消息 → 小程序读取剪贴板 → DeepSeek 解析为结构化日程 → 确认页逐条可编辑 → 存入小程序日程 → 到点发微信订阅消息。

在"把消息解析成一条提醒"之上，还做了冲突检测（软/硬分级）、截止日识别与预备提醒，处理的是"这几天排不排得下"。

<p align="center">
  <img src="https://han-wangze.github.io/hanwangze/img/shot-1.jpg" width="196" alt="首页：粘贴群消息后解析">
  <img src="https://han-wangze.github.io/hanwangze/img/shot-2.jpg" width="196" alt="确认页：与已有日程冲突时给出可一键采纳的备选时段">
  <img src="https://han-wangze.github.io/hanwangze/img/shot-3.jpg" width="196" alt="日程列表：按日期分组，冲突日程带警示标记">
</p>

演示视频（32 秒实机录屏）与完整交互流程见[作品集展示页](https://han-wangze.github.io/hanwangze/weschedule.html)。

## 一、产品背景

一次面向在校生的问卷调研（样本 87 人，规模有限，结论只作方向参考）：

| 调研结果 | 比例 |
|---|---|
| 因信息过载漏掉过重要事项 | 80.0% |
| 认为手动录入日程繁琐 | 45.6% |
| 愿意使用"消息转日程"类工具 | 87.4% |
| 把"冲突检测"列为最想要的智能功能 | 70.1% |

调研指向两个不同的问题：消息里的日程需要先被"捞出来"（解析），捞出来之后还需要能"排得下"（治理）。产品按这两层组织功能。

## 二、功能

### 已实现

**消息解析**
DeepSeek `deepseek-chat`，temperature=0，JSON 模式，prompt v1.4。输出 title / date / start_time / end_time / fuzzy_time / location / people / is_deadline / reminder_minutes / confidence。非法 JSON 或 schema 校验失败会自动重试一次。

**冲突检测（纯规则，零 AI 依赖）**

- 硬冲突：两个定点事项时间重叠 → 强提示 + 1–2 个可一键采纳的备选时段
- 软冲突：定点事项落在截止日当天 → 弱提示
- 两个截止日同天**不判冲突**（"周三交报告" + "周三交作业"是常态，全标等于不标）
- 分级只依赖 `is_deadline` 一个字段，不引入 AI 类型判断——避免"类型判错 → 冲突等级被放大"

**模糊日程的边界显式化**
没有日期的日程无法做时间比对，不假装能检测。确认页直接说明"暂不参与冲突检测，补上日期后立即检查"；补上日期后同一份检测代码自动生效。这类日程在列表页单独归入"待定"区，不参与提醒。

**预备提醒**
标题命中"材料 / PPT / 报告 / 准备"等关键词的日程（`is_prep`），提醒提前到前一晚 20:00。复用该事件的同一次订阅授权，不额外索取。

**编辑**
列表页点卡片进入编辑态，走 `updateEvent` 云函数原地更新（不删旧建新）。改期时重置提醒标记，让新时点能重新发提醒；只改标题/地点则不重置，避免用户改个错别字又收到一条相同提醒。

**解析限流**
同一 openid 每 60 秒最多 10 次真实解析。实现上**先写占位记录再数窗口**——先数后写会被并发请求全部绕过。被拦的请求落一条 `RATE_LIMITED` 记录，便于事后看滥用。

**隐私**
解析日志只记文本长度、解析结果、耗时、错误码，以及云端写入的账号标识（按人限流用）、请求 ID、提示词版本与模型名——不留原文，也不留任何能用于反查原文的标识；剪贴板读取走微信隐私授权，未授权用户走手动粘贴路径。只有用户主动点"识别有误"并确认后，该条原文才会连同账号标识存入反馈库，用于修正解析问题，不对外提供。

⚠️ **解析时，群聊文本会发送给 DeepSeek API（第三方模型服务）。**请避免粘贴不适合发送给第三方的内容。

### 未实现（计划中）

产品定位里的"过载层"尚未动工：

- 周负载条（本周已排多少小时、几个截止日）
- 截止日堆积预警（未来 7 天 ≥3 个截止日时建议插入准备时段）
- 准备块体积化——当前 `is_prep` 只改变提醒时间，不生成真实占用时段，因此不参与冲突计算

演示视频与完整交互流程见[作品集展示页](https://han-wangze.github.io/hanwangze/weschedule.html)。

## 三、技术架构

微信小程序原生 + 微信云开发，无自建服务器。

```
小程序端                    云函数                      外部
index / confirm / list  →  parse        →  DeepSeek API
                           saveEvent / updateEvent / deleteEvent
                           listEvents / remind（定时触发）
                           login / logEvent / feedback / analytics
                                 ↓
                          云数据库 events / parse_logs / analytics / …
```

| 层 | 组成 |
|---|---|
| 前端 | WXML / WXSS / JS，无第三方框架与 UI 组件库 |
| 后端 | 微信云开发，10 个云函数，免服务器、密钥不进前端 |
| AI | DeepSeek `deepseek-chat` |
| 提醒 | 微信订阅消息（单模板，一次授权对应一次推送） |
| 数据库 | `users` / `events` / `parse_logs` / `feedback` / `analytics` |

## 四、平台约束如何塑造了产品

个人主体小程序 + 微信平台能力边界带来三个硬约束，它们直接决定了产品形态：

1. **不能写系统日历**：`wx.addPhoneCalendar` 真机实测无系统授权框、不可用 → 改为"小程序内日程 + 订阅消息提醒"，系统日历写入代码已移除
2. **订阅消息"一次授权一次推送"** → 提醒次数是稀缺资源：同一天的多件事按 openid + 日期聚合成一条汇总推送；预备提醒复用同一次授权改到前一晚，而不是新增推送
3. **隐私合规** → 日志只记文本长度与解析结果，不留原文、不留可反查标识；自动读剪贴板降级为"用户点击主按钮后读取"

## 五、测试与评测

### 5.1 解析准确率

评测体系、语料构成、提示词全文与逐条设计意图、六项指标定义、口径纪律见 **[docs/eval-method.md](docs/eval-method.md)**。这里只放结论。

| 数据集 | 规模 | 用途 | 整条消息全对率 |
|---|---|---|---|
| dev | 68 条 | 迭代时看 | **97.1%**（66/68） |
| test | 29 条 | 只看不改 | **96.6%**（28/29） |
| heldout | 12 条 | **冻结集，绝不调参** | 稳定期望 **8/9**（单次采样 7/9–8/9） |
| relperiod | 6 条 × 3 次 | 验证 v1.4 的相对周期规则 | **18/18** |

语料合计 130 条：dev/test 池 112 条 + heldout 12 条（隔离）+ relperiod 6 条（验证批）。表中 dev/test 的「规模」只算该有日程的消息（池内另有 15 条无日程消息，用于 `has_schedule` 判定），所以两行相加是 97 而不是 112。

`has_schedule` 判定（"这条消息该不该出日程"）：heldout 12 条**零误报**——真实群聊里 3 条纯通知被正确判为无日程，没有过度抽取。

**几个必须说清的口径：**

- 分母只算"该有日程"的消息。无日程样本没有事件可标，判不出"解析对不对"
- **test 集已被污染**：v1.3 的改动是针对这套语料里的失败项做的，96.6% 带乐观偏差。所以 2026-10-28 另建了 12 条真实课程群聊作 heldout 冻结集——改动时没看过，只用于验证泛化。后来在 heldout 里发现一个真实缺口（"本周内"→截止日留空），修复时**没有**回到 heldout 上回测，而是另造 6 条 relperiod 语料验证（18/18），heldout 保持冻结
- `temperature=0` 也不逐字可复现，同一条隔天重跑会差 1–2 条。dev 68 条的分辨力约 **±2 条（±3pp）**。所以版本间只差 1–2 条时不据此声称"变好了"；判断改动是否有效，靠对单个失败项复跑 3 次看稳定性，而不是看总数
- 同义词表（聚餐/吃饭、上课/第X节课）只用于**诊断**"没理解"和"换了个说法"的差别，不进主指标——同义词表是自己定的，拿它刷分不诚实

### 5.2 功能测试

| 对象 | 方式 | 结果 |
|---|---|---|
| 冲突检测 `utils/conflict.js` | `node eval/test_conflict.js`，37 条用例 | **37/37** |
| 提醒重置 `remind` × `updateEvent` | `node eval/test_remind_reset.js`，源码契约 + 逻辑复刻 28 条 | **28/28** |
| 评测与线上口径一致性 | 复刻线上 `validate()` 跑全量 gold | **130 条语料 · 152 事件 100% 通过**（含 9 条 `date=null`） |
| 列表页交互 | 11 条结构断言（一次性脚本，未入库） | 11/11 |

真机上重点验证过：剪贴板授权弹窗与拒绝后的降级路径、确认页在小屏下的字段可见性（7 组屏幕 × 卡片组合验算无整页溢出）、列表页左滑删除的层叠顺序与过期卡透明度、订阅消息实际到达。

### 5.3 已发现的边界

- 语义级冲突（"午饭撞午饭"）不识别——只比对时间区间，不理解内容
- heldout 里剩两项非解析错：中英标题措辞差异、时间字段偶发波动（日期每次都对）
- 长群公告（30–200 字、3–5 事件）的真实语料样本还很少

## 六、当前限制

- **未正式上线**：仅在体验版小范围试用。个人主体的类目与备案状态决定正式发布的时点
- **评测语料以构造为主**：dev/test 池 112 条中 105 条为构造、7 条为真实脱敏，验证的是"预想到的问题有没有被修掉"，不代表真实流量分布。真实语料只有 heldout 的 12 条，样本仍小
- **无真实用户量**：埋点漏斗（`analytics` 云函数）已就位，但数据量还不足以支撑任何转化率结论
- **提醒依赖订阅授权**：用户拒绝后没有替代触达手段，这是平台限制而非实现选择
- **提醒单次扫描上限 200 条**：`remind` 每次只取 200 条未提醒日程，没有分页。当前试用规模远达不到这个量；用户量和待办量变大后，排在结果集后面的到期事件可能延迟处理
- **只做单向**：消息 → 日程，日程改动不回写任何第三方，无双向同步

## 七、部署与运行

### 环境

微信开发者工具 + 微信云开发环境 + DeepSeek API Key。

### 步骤

1. 开发者工具「导入项目」，目录选本仓库根目录
2. **换成你自己的配置**：把 `project.config.json` 的 `appid` 改为你的小程序 AppID，把 `miniprogram/app.js` 里的 `envId` 改为你的云开发环境 ID。仓库中的值是作者开发环境所用，直接沿用无法运行
3. 右键 `cloudfunctions/` 下**每个**函数 →「上传并部署：云端安装依赖」，共 **10** 个
4. 云开发控制台 → `parse` 云函数 → 环境变量，添加 `DEEPSEEK_API_KEY`
5. 云开发控制台 → `analytics` 云函数 → 环境变量，添加 `ADMIN_OPENID`（你自己的 openid，逗号分隔可配多个）。**不配则该函数拒绝所有调用**——它聚合的是全站数据，必须限制访问
6. **订阅消息模板**：在 mp 后台申请「日程提醒」类模板，把 `cloudfunctions/remind/index.js` 与 `miniprogram/pages/confirm/confirm.js` 里的 `TEMPLATE_ID` 换成你自己的模板 ID（**两处需同步改**）。模板属于各自小程序账号，沿用作者的会发送失败
7. 数据库新建集合：`users`、`events`、`parse_logs`、`feedback`、`analytics`，权限设为「仅创建者可读写」
8. 索引建议：`parse_logs` 建 `_openid + created_at`（限流按人按时间窗口计数，不建索引会全表扫）；`events` 建 `_openid + status + date`（列表三区查询）
9. 云函数超时：`parse` 设 **25s**，`remind` 设 **20s**（冷启动 + 发送），其余默认
10. `remind` 需单独「上传触发器」（定时触发，每分钟）
11. **mp 后台隐私保护指引**需覆盖三类用途：剪贴板（读取群聊文本用于解析）、订阅消息（发送日程提醒）、用户操作记录（行为统计）。后台声明与协议页文案必须一致；声明了没用到的权限反而违规

### 运行评测

```bash
pip install requests
export DEEPSEEK_API_KEY=sk-xxxx          # Windows: set DEEPSEEK_API_KEY=sk-xxxx

python eval/run_eval.py --dataset dev
python eval/run_eval.py --dataset test
python eval/run_eval.py --dataset heldout     # 冻结集，只验证不调参
python eval/run_eval.py --dataset relperiod   # 相对周期规则验证
python eval/verify_relperiod.py               # 每条复跑 3 次看稳定性

node eval/test_conflict.js                    # 冲突检测 37 条
node eval/test_remind_reset.js                # 提醒重置 28 条
```

**新增语料后用 `split_hint` 指定集合，不要 `--resplit`**——重切会把 dev 洗牌，历史数字就不可比了。也可用 `eval/run_dev.sh`（Windows: `run_dev.bat`）自动读取 `.env`。

## 八、目录结构

```
weschedule/
  LICENSE                   # MIT
  project.config.json       # 导入配置（appid 需替换为你自己的）
  miniprogram/
    app.js / app.json / app.wxss
    pages/
      index/                首页：粘贴 / 解析入口 / 隐私授权弹窗 / 最近日程
      confirm/              确认卡片页：多事件 swiper 编辑 + 冲突警示 + 订阅提醒
      list/                 日程：待定 / 未来 / 已过期三区 + 冲突角标 + 左滑删除 + 点卡片编辑
      settings/             我的：本周概览 + 隐私入口 + 反馈 + 版本
      privacy/              隐私协议
    utils/
      api.js                封装 wx.cloud.callFunction
      conflict.js           冲突检测（detectConflicts / findFreeSlots，纯前端零 AI 依赖）
  cloudfunctions/
    login/                  静默登录（落库 users）
    parse/                  核心解析：调 DeepSeek，校验 + 重试，写 parse_logs（只记长度与结果）
    listEvents/             读 active 日程（未来 / 过去 7 天 / 待定分三次查询，各自独立上限）
    saveEvent/              保存确认事件（计算 is_prep）
    updateEvent/            编辑已存日程（校验归属；时间真变化才重置提醒标记）
    deleteEvent/            软删除
    logEvent/               埋点（写 analytics，带 openid 串漏斗；事件名白名单 + payload 清洗）
    feedback/               用户授权后的 badcase 反馈
    remind/                 定时触发：到点 / 预备窗口发送订阅消息
    analytics/              埋点聚合（仅管理员 openid 可调，输出漏斗与卡点差额）
  eval/
    run_eval.py             评测脚本（8:2 固定切分，五层指标）
    verify_relperiod.py     相对周期规则稳定性（每条 3 次）
    test_conflict.js        冲突检测量化测试（37 条）
    test_remind_reset.js    提醒 × 编辑联动验证（28 条）
    corpus/                 语料 130 条：sample 112 + real_course 12（heldout）+ relative_period 6
    reports/                badcase 与运行结果落盘
  docs/
    eval-method.md          评测说明书（语料 / 提示词全文 / 指标口径 / 已知局限 / 运行史）
    badcase-v1.3.md         失败面快照
```

## 九、相关链接

- 作品集展示页：https://han-wangze.github.io/hanwangze/weschedule.html
- 竞争格局与定位：https://han-wangze.github.io/hanwangze/competition.html
- 调研报告提要：https://han-wangze.github.io/hanwangze/report.html
- 评测方法与提示词全文：[docs/eval-method.md](docs/eval-method.md)

## 十、许可

代码以 [MIT](LICENSE) 发布。本仓库不含任何第三方专有数据；评测语料的来源与构造方式见 [docs/eval-method.md](docs/eval-method.md)。
