// cloudfunctions/parse/index.js —— 核心解析：调 DeepSeek，返回结构化事件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const https = require('https');

// 密钥只存云函数环境变量（控制台配置），不进前端代码
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const PROMPT_VERSION = 'v1';
const MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = `你是一个日程信息解析器。用户会给你一段从微信群聊复制的文本，你要判断其中是否包含未来的日程安排，并提取为结构化 JSON。

今天的日期是 {ref_date}，星期{ref_weekday}。所有相对时间都必须以这个日期为锚点换算成绝对日期。

规则：
1. 输出且只输出 JSON，不要输出任何解释、markdown 标记或代码块符号。
2. 相对时间归一化：明天、后天、下周X、周X、X月X日（未给年份时取最近一次的未来日期）都要换算成 YYYY-MM-DD。
3. 模糊时间（如"晚上""傍晚""找时间"）：start_time 填 null，fuzzy_time 填原文表述，confidence 不超过 0.6。
4. 未明确的时间不要猜测编造。只有原文出现或能直接换算的信息才允许填，否则填 null。
5. 截止日（如"23号前交作业""DDL"）：is_deadline 填 true，未给具体时间时 start_time 填 23:59，reminder_minutes 填 1440。
6. 一条文本含多个独立日程时，拆成多个 event。
7. 以下情况 has_schedule 填 false，events 填空数组：闲聊、表情、询问过去的事、不含未来行动点的通知、广告。
8. title 不超过 12 个字，概括事项本身，不要带"请""记得"等语气词。
9. people 只填原文明确出现的参与人，保留原文称呼。
10. location 保留原文最具体的表述，不要补全或推测。
11. confidence 取值 0 到 1，反映你对这条解析整体的把握。字段缺失越多分值越低。
12. 默认提醒：会议和活动 reminder_minutes 填 30，截止日填 1440。

输出 JSON 结构：
{
  "has_schedule": true 或 false,
  "events": [
    {
      "title": "字符串",
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM 或 null",
      "end_time": "HH:MM 或 null",
      "fuzzy_time": "字符串或 null",
      "is_deadline": true 或 false,
      "location": "字符串或 null",
      "people": ["字符串"],
      "reminder_minutes": 数字,
      "confidence": 0 到 1 的数字,
      "raw_snippet": "原文中最相关的一小段"
    }
  ],
  "reject_reason": "has_schedule 为 false 时的一句话原因，否则为 null"
}`;

function buildUser(text) {
  return '群聊文本如下：\n\n"""\n' + text + '\n"""';
}

function stripFence(s) {
  s = (s || '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return s;
}

function httpsPost(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers),
    }, (resp) => {
      let chunks = '';
      resp.on('data', (c) => (chunks += c));
      resp.on('end', () => {
        try { resolve(JSON.parse(chunks)); } catch (e) { reject(new Error('bad_json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('LLM_TIMEOUT'))); // 防止卡到云函数超时
    req.write(data);
    req.end();
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validate(events) {
  if (!Array.isArray(events)) return false;
  for (const e of events) {
    if (typeof e.title !== 'string' || !e.title) return false;
    if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) return false;
    if (e.start_time !== null && e.start_time !== undefined && typeof e.start_time !== 'string') return false;
    if (e.end_time !== null && e.end_time !== undefined && typeof e.end_time !== 'string') return false;
    if (typeof e.is_deadline !== 'boolean') return false;
    if (!Array.isArray(e.people)) return false;
    if (typeof e.reminder_minutes !== 'number') return false;
    if (typeof e.confidence !== 'number') return false;
  }
  return true;
}

async function callLLM(text, ref) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT.replace('{ref_date}', ref.ref_date).replace('{ref_weekday}', ref.ref_weekday) },
      { role: 'user', content: buildUser(text) },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  };
  const headers = { Authorization: 'Bearer ' + DEEPSEEK_API_KEY };
  const res = await httpsPost('https://api.deepseek.com/chat/completions', headers, body);
  const content = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  return JSON.parse(stripFence(content));
}

function refDate() {
  const now = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return { ref_date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()), ref_weekday: wd };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return String(h);
}

exports.main = async (event) => {
  if (!DEEPSEEK_API_KEY) {
    return { success: false, error_code: 'NO_API_KEY', error_msg: '云端未配置 DEEPSEEK_API_KEY 环境变量，请在云函数配置中添加' };
  }
  const requestId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const start = Date.now();
  const text = (event.text || '').slice(0, 2000); // E2 超长截断
  const ref = refDate();
  let success = false;
  let errorCode = null;
  let result = null;

  try {
    let parsed = await callLLM(text, ref);
    // E7：非法 JSON 或 schema 校验失败，自动重试 1 次
    if (!parsed || typeof parsed.has_schedule !== 'boolean' || !validate(parsed.events || [])) {
      parsed = await callLLM(text, ref);
      if (!parsed || typeof parsed.has_schedule !== 'boolean' || !validate(parsed.events || [])) {
        errorCode = 'PARSE_FAILED';
      }
    }
    if (!errorCode) {
      success = true;
      result = {
        has_schedule: !!parsed.has_schedule,
        events: (parsed.events || []).map((e) => ({
          title: e.title,
          date: e.date,
          start_time: e.start_time || null,
          end_time: e.end_time || null,
          fuzzy_time: e.fuzzy_time || null,
          is_deadline: !!e.is_deadline,
          location: e.location || null,
          people: e.people || [],
          reminder_minutes: e.reminder_minutes || 0,
          confidence: e.confidence,
        })),
        reject_reason: parsed.reject_reason || null,
      };
    }
  } catch (e) {
    errorCode = 'PARSE_FAILED';
  }

  // 写 parse_logs（不留原文）
  try {
    await db.collection('parse_logs').add({
      data: {
        request_id: requestId,
        input_len: text.length,
        input_hash: hashStr(text),
        prompt_version: PROMPT_VERSION,
        model: MODEL,
        output_json: success ? result : null,
        latency_ms: Date.now() - start,
        success,
        error_code: errorCode,
        created_at: Date.now(),
      },
    });
  } catch (e) {}

  if (!success) return { success: false, error_code: errorCode || 'PARSE_FAILED' };
  return {
    success: true,
    request_id: requestId,
    has_schedule: result.has_schedule,
    events: result.events,
    reject_reason: result.reject_reason,
  };
};
