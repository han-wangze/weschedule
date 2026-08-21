#!/usr/bin/env python3
# eval/run_eval.py
# WeSchedule 评测脚本（按任务书第三部分实现：8:2 固定切分，调 DeepSeek，计算五层指标）
# 仅依赖 requests 与标准库。
import argparse
import datetime
import json
import os
import random
import re
import sys

import requests

CORPUS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'corpus')
SPLIT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.split.json')
REPORTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reports')
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

SYSTEM_PROMPT = '''你是一个日程信息解析器。用户会给你一段从微信群聊复制的文本，你要判断其中是否包含未来的日程安排，并提取为结构化 JSON。

今天的日期是 {ref_date}，星期{ref_weekday}。所有相对时间都必须以这个日期为锚点换算成绝对日期。

规则：
1. 输出且只输出 JSON，不要输出任何解释、markdown 标记或代码块符号。
2. 相对时间归一化：明天、后天、下周X、X月X日（未给年份时取最近一次的未来日期）都要换算成 YYYY-MM-DD。周X 解析为严格晚于今天（{ref_date}）的下一个匹配星期几（未来向、不含当天），除非文本明确"今天/今/这周X"才取当天。
3. 时段词与模糊时间的区分：
若文本含可映射为具体钟点的时段词且未给具体钟点，则 start_time 取下方映射值、fuzzy_time 填 null：早上/早晨/早自习/第一节课 → 08:00；上午 → 10:00；中午/午间 → 12:00；下午 → 14:00；傍晚 → 17:00；晚上/夜里 → 18:00；第二节课 → 10:00；第三节课 → 14:00。
真正模糊、无法确定钟点的情况（如"有空/大概/左右/最近/哪天都行/找时间/碰一下/再说"等），start_time 填 null，fuzzy_time 填原文表述，confidence 不超过 0.6。
日期填充约束：当消息未指向任何具体某一天（仅模糊时段，或"有空/最近/哪天都行/这周末/下午有会"等），date 必须填 null，禁止填 {ref_date} 或推算日；只有能锚定具体某天（明天/后天/周X/日期/下周X）才填 date。
4. 未明确的时间不要猜测编造。只有原文出现或能直接换算的信息才允许填，否则填 null。
5. 截止日（如"23号前交作业""DDL"）：is_deadline 填 true，未给具体时间时 start_time 填 23:59，reminder_minutes 填 1440。
6. 一条文本含多个独立日程时，拆成多个 event。
7. 以下情况 has_schedule 填 false，events 填空数组：纯闲聊寒暄、表情、询问过去的事、广告。注意：只要文本表达了未来的具体行动意图（如自习、开会、办签证、碰毕业论文、约球、聚餐、面试、体检、还书等），即使只有模糊时段（晚上/下午/最近/有空/哪天都行）或未给具体日期，也必须 has_schedule=true 并提取为事件（date 可填 null，fuzzy_time 填原文时段，start_time 填 null）；仅当完全无行动意图才判 false。
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
}'''

WD = ['一', '二', '三', '四', '五', '六', '日']


def weekday_cn(date_str):
    d = datetime.date.fromisoformat(date_str)
    return WD[d.weekday()]


def load_api_key():
    return os.environ.get('DEEPSEEK_API_KEY', '')


def load_corpus():
    items = []
    for fn in sorted(os.listdir(CORPUS_DIR)):
        if fn.endswith('.jsonl'):
            with open(os.path.join(CORPUS_DIR, fn), encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        items.append(json.loads(line))
    return items


def fixed_split(items, seed=20260717):
    ids = sorted(i['id'] for i in items)
    rng = random.Random(seed)
    rng.shuffle(ids)
    n = max(1, int(len(ids) * 0.8))
    dev_ids = set(ids[:n])
    split = {i['id']: ('dev' if i['id'] in dev_ids else 'test') for i in items}
    with open(SPLIT_FILE, 'w', encoding='utf-8') as f:
        json.dump(split, f, ensure_ascii=False, indent=2)
    return split


def load_split(items, resplit):
    if resplit or not os.path.exists(SPLIT_FILE):
        return fixed_split(items)
    with open(SPLIT_FILE, encoding='utf-8') as f:
        return json.load(f)


def strip_fence(s):
    s = (s or '').strip()
    if s.startswith('```'):
        s = re.sub(r'^```[a-zA-Z]*\n?', '', s).strip()
        s = s.rstrip('`').strip()
    return s


def call_llm(text, ref_date, ref_weekday, api_key):
    prompt = SYSTEM_PROMPT.replace('{ref_date}', ref_date).replace('{ref_weekday}', ref_weekday)
    body = {
        'model': 'deepseek-chat',
        'messages': [
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': '群聊文本如下：\n\n"""\n' + text + '\n"""'},
        ],
        'temperature': 0,
        'response_format': {'type': 'json_object'},
    }
    resp = requests.post(
        DEEPSEEK_URL,
        headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
        json=body, timeout=30,
    )
    resp.raise_for_status()
    content = resp.json()['choices'][0]['message']['content']
    return json.loads(strip_fence(content))


def keyword_hit(pred_title, gold_title):
    p = pred_title or ''
    g = gold_title or ''
    if not p or not g:
        return False
    if p in g or g in p:
        return True
    for i in range(len(g) - 1):
        if g[i:i + 2] in p:
            return True
    return False


def match_events(gold_events, pred_events):
    """返回 (命中数, 是否每条都命中, 是否无多报)。模糊时间条目不计入精确 time 匹配。"""
    used = [False] * len(pred_events)
    tp = 0
    for ge in gold_events:
        hi = -1
        for pi, pe in enumerate(pred_events):
            if used[pi]:
                continue
            if pe.get('date') == ge.get('date') and keyword_hit(pe.get('title'), ge.get('title')):
                hi = pi
                break
        if hi >= 0:
            used[hi] = True
            tp += 1
    return tp, used


def evaluate(items, predictions):
    tp = fp = tn = fn = 0
    e_fp = e_total = 0
    event_tp = event_pred = event_gold = 0
    date_ok = date_total = 0
    time_ok = time_total = 0
    loc_ok = loc_total = 0
    end_ok = end_total = 0
    badcases = []

    for item, parsed in zip(items, predictions):
        gold_has = item['has_schedule']
        pred_has = bool(parsed.get('has_schedule'))
        if gold_has and pred_has:
            tp += 1
        elif gold_has and not pred_has:
            fn += 1
        elif not gold_has and pred_has:
            fp += 1
        else:
            tn += 1
        if item['category'] == 'E':
            e_total += 1
            if pred_has:
                e_fp += 1

        if not gold_has:
            continue

        gold_events = item['events']
        pred_events = parsed.get('events') or []
        event_gold += len(gold_events)
        event_pred += len(pred_events)

        used = [False] * len(pred_events)
        for ge in gold_events:
            hi = -1
            for pi, pe in enumerate(pred_events):
                if used[pi]:
                    continue
                if pe.get('date') == ge.get('date') and keyword_hit(pe.get('title'), ge.get('title')):
                    hi = pi
                    break
            if hi >= 0:
                used[hi] = True
                event_tp += 1
                pe = pred_events[hi]
                date_total += 1
                if pe.get('date') == ge.get('date'):
                    date_ok += 1
                if ge.get('start_time') is not None:
                    time_total += 1
                    if pe.get('start_time') == ge.get('start_time'):
                        time_ok += 1
                loc_total += 1
                gl = (ge.get('location') or '')
                pl = (pe.get('location') or '')
                if gl == pl or gl in pl or pl in gl:
                    loc_ok += 1

        # 端到端完全正确率：所有标注事件命中 + 每个命中 date/time(精确)/location 全对 + 无多报
        tp2, used2 = match_events(gold_events, pred_events)
        all_correct = (tp2 == len(gold_events))
        if all_correct:
            for ge in gold_events:
                pe = None
                for pi, p in enumerate(pred_events):
                    if used2[pi] and p.get('date') == ge.get('date') and keyword_hit(p.get('title'), ge.get('title')):
                        pe = p
                        break
                if pe is None:
                    all_correct = False
                    break
                if pe.get('date') != ge.get('date'):
                    all_correct = False
                if ge.get('start_time') is not None and pe.get('start_time') != ge.get('start_time'):
                    all_correct = False
                gl = (ge.get('location') or '')
                pl = (pe.get('location') or '')
                if not (gl == pl or gl in pl or pl in gl):
                    all_correct = False
        if len(pred_events) != len(gold_events):
            all_correct = False
        if all_correct:
            end_ok += 1
        else:
            badcases.append({'id': item['id'], 'category': item['category'], 'text': item['text'],
                             'gold': item['events'], 'pred': parsed.get('events')})

    end_total = len(items)

    def safe(n, d):
        return round(100.0 * n / d, 1) if d else 0.0

    acc = safe(tp + tn, tp + tn + fp + fn)
    p = safe(tp, tp + fp)
    r = safe(tp, tp + fn)
    f1 = round(2 * p * r / (p + r), 1) if (p + r) else 0.0
    miss_rate = safe(e_fp, e_total)
    ev_p = safe(event_tp, event_pred)
    ev_r = safe(event_tp, event_gold)

    return {
        'acc': acc, 'P': p, 'R': r, 'F1': f1,
        'miss_rate': miss_rate, 'e_total': e_total,
        'ev_p': ev_p, 'ev_r': ev_r,
        'date_acc': safe(date_ok, date_total), 'date_total': date_total,
        'time_acc': safe(time_ok, time_total), 'time_total': time_total,
        'loc_acc': safe(loc_ok, loc_total), 'loc_total': loc_total,
        'end_acc': safe(end_ok, end_total), 'end_total': end_total,
        'badcases': badcases,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prompt', default='v1.2')
    ap.add_argument('--dataset', default='dev', choices=['dev', 'test'])
    ap.add_argument('--resplit', action='store_true', help='重新生成固定切分')
    args = ap.parse_args()

    api_key = load_api_key()
    if not api_key:
        print('请先设置环境变量 DEEPSEEK_API_KEY')
        sys.exit(1)

    items = load_corpus()
    split = load_split(items, args.resplit)
    subset = [i for i in items if split.get(i['id']) == args.dataset]
    print('语料总数 %d，%s 集 %d 条' % (len(items), args.dataset, len(subset)))

    predictions = []
    for idx, item in enumerate(subset):
        try:
            parsed = call_llm(item['text'], item['ref_date'], weekday_cn(item['ref_date']), api_key)
        except Exception as e:
            print('  解析失败 %s: %s' % (item['id'], e))
            parsed = {'has_schedule': False, 'events': []}
        predictions.append(parsed)
        print('  [%d/%d] %s' % (idx + 1, len(subset), item['id']))

    m = evaluate(subset, predictions)

    print('=' * 50)
    print('WeSchedule Eval Report    prompt=%s    dataset=%s(%d)' % (args.prompt, args.dataset, len(subset)))
    print('=' * 50)
    print('has_schedule 判定:  acc=%s  P=%s  R=%s  F1=%s' % (m['acc'], m['P'], m['R'], m['F1']))
    print('误报率(E类判有):    %s%%   (达标线 <=5%%)   %s' % (m['miss_rate'], '达标' if m['miss_rate'] <= 5 else '未达标'))
    print('事件级:  P=%s  R=%s' % (m['ev_p'], m['ev_r']))
    print('字段准确率(命中事件):')
    print('  date      %s%%   (达标线 >=90%%)   %s' % (m['date_acc'], '达标' if m['date_acc'] >= 90 else '未达标'))
    print('  time      %s%%   (达标线 >=80%%)   %s' % (m['time_acc'], '达标' if m['time_acc'] >= 80 else '未达标'))
    print('  location  %s%%   (达标线 >=70%%)   %s' % (m['loc_acc'], '达标' if m['loc_acc'] >= 70 else '未达标'))
    print('端到端完全正确率:   %s%%   (达标线 >=75%%)   %s' % (m['end_acc'], '达标' if m['end_acc'] >= 75 else '未达标'))
    print('-' * 50)
    print('badcase 数量: %d' % len(m['badcases']))
    print('=' * 50)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    out = os.path.join(REPORTS_DIR, 'badcase_%s_%s.jsonl' % (args.prompt, args.dataset))
    with open(out, 'w', encoding='utf-8') as f:
        for b in m['badcases']:
            f.write(json.dumps(b, ensure_ascii=False) + '\n')
    print('详细 badcase 已写入 %s' % out)


if __name__ == '__main__':
    main()
