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


def strict_hit(pred_title, gold_title):
    """严格措辞匹配：包含关系或 gold 的任意 2-gram 出现在 pred 里。"""
    p = pred_title or ''
    g = gold_title or ''
    if not p or not g:
        return False
    # 阶段词不同 -> 不是同一件事。2-gram 规则会把"预答辩"和"正式答辩"判成命中
    # （"答辩"是公共子串），必须显式拦住（2026-10-21 单测发现）
    if _stage_conflict(p, g):
        return False
    if p in g or g in p:
        return True
    for i in range(len(g) - 1):
        if g[i:i + 2] in p:
            return True
    return False


# ===== 同义词配对（2026-10-21）=====
# 用途：诊断失败性质，不是刷分。严格措辞会惩罚同义改写——标注"聚餐"、模型写
# "一起吃饭"，日期时间全对却被算成"漏报+多报"。加上下面这层后可以算出一个
# "放宽措辞口径"的数字，用来回答"剩下的错到底是没理解，还是只是换了个说法"。
# 保守原则：只收明确等价的说法；不做上下位合并（"烧烤"不等于"聚餐"，就不并）。
# 配对仍要求 date 相等，所以不会把不同天的事件配到一起。
SYNONYM_GROUPS = [
    ['聚餐', '吃饭', '一起吃', '约饭', '吃个饭'],
    ['上课', '节课'],                       # "第一节课换教室" 也算上课
    ['开会', '会议', '例会', '组会', '班会'],
    ['考试', '测验'],
    ['跑步', '慢跑'],
]
# 阶段词：两边都带且不同 -> 不是同一件事（预答辩 ≠ 正式答辩），禁止同义配对
STAGE_WORDS = ['预答辩', '正式答辩']


def _stage_conflict(a, b):
    sa = [w for w in STAGE_WORDS if w in (a or '')]
    sb = [w for w in STAGE_WORDS if w in (b or '')]
    return bool(sa and sb and sa != sb)


def _concepts(title):
    t = title or ''
    return {i for i, words in enumerate(SYNONYM_GROUPS) if any(w in t for w in words)}


def concept_hit(pred_title, gold_title):
    p = pred_title or ''
    g = gold_title or ''
    if not p or not g:
        return False
    if not (_concepts(p) & _concepts(g)):
        return False
    gp = [w for w in STAGE_WORDS if w in g]
    pp = [w for w in STAGE_WORDS if w in p]
    if gp and pp and gp != pp:
        return False
    return True


def title_hit(pred_title, gold_title):
    """配对判定：严格措辞命中，或同义词命中。"""
    return strict_hit(pred_title, gold_title) or concept_hit(pred_title, gold_title)


def match_events(gold_events, pred_events, hit=None):
    """返回 (命中数, 每条 pred 是否被用掉)。默认用严格措辞配对。"""
    hit = hit or strict_hit
    used = [False] * len(pred_events)
    tp = 0
    for ge in gold_events:
        hi = -1
        for pi, pe in enumerate(pred_events):
            if used[pi]:
                continue
            if pe.get('date') == ge.get('date') and hit(pe.get('title'), ge.get('title')):
                hi = pi
                break
        if hi >= 0:
            used[hi] = True
            tp += 1
    return tp, used


def all_correct_msg(gold_events, pred_events, hit):
    """整条消息是否全对：所有标注事件配上 + date/time(标注有才算)/location 全对 + 无多报。"""
    tp, used = match_events(gold_events, pred_events, hit)
    if tp != len(gold_events) or len(pred_events) != len(gold_events):
        return False
    for ge in gold_events:
        pe = None
        for pi, p in enumerate(pred_events):
            if used[pi] and p.get('date') == ge.get('date') and hit(p.get('title'), ge.get('title')):
                pe = p
                break
        if pe is None:
            return False
        if ge.get('start_time') is not None and pe.get('start_time') != ge.get('start_time'):
            return False
        gl = (ge.get('location') or '')
        pl = (pe.get('location') or '')
        if not (gl == pl or gl in pl or pl in gl):
            return False
    return True


def evaluate(items, predictions):
    tp = fp = tn = fn = 0
    e_fp = e_total = 0
    event_tp = event_pred = event_gold = 0
    time_ok = time_total = 0
    loc_ok = loc_total = 0
    fab_time = fab_loc = 0   # 编造：gold 该字段为空，模型却填了值
    end_ok = end_total = 0
    end_ok_wide = 0           # 放宽措辞（同义词）口径下的通过数，仅作诊断
    wording_ids = []          # 仅因标题措辞不同才被判失败的消息
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
                if pe.get('date') == ge.get('date') and strict_hit(pe.get('title'), ge.get('title')):
                    hi = pi
                    break
            if hi >= 0:
                used[hi] = True
                event_tp += 1
                pe = pred_events[hi]
                # ⚠️ date 不单独统计准确率：配对条件本身就要求 date 相等（上面一行），
                #    配上了再比 date 必然为真，是一个恒等于 100% 的伪指标。
                #    date 错的代价体现在事件级 P/R —— 配不上就算漏报，会配对算多报。
                if ge.get('start_time') is not None:
                    time_total += 1
                    if pe.get('start_time') == ge.get('start_time'):
                        time_ok += 1
                elif pe.get('start_time'):
                    fab_time += 1   # gold 无钟点，模型却给了一个——正是 prompt 规则 4 禁止的编造
                loc_total += 1
                gl = (ge.get('location') or '')
                pl = (pe.get('location') or '')
                if gl == pl or gl in pl or pl in gl:
                    loc_ok += 1
                elif not gl and pl:
                    fab_loc += 1    # gold 无地点，模型却给了一个

        # 端到端完全正确率：所有标注事件命中 + 每个命中 date/time(精确)/location 全对 + 无多报。
        # 主指标用**严格措辞**配对（与历史可比）；另用同义词口径再判一次，
        # 只为把"没理解"和"只是换了个说法"分开——同义词表是自己定的，不拿它刷分。
        all_correct = all_correct_msg(gold_events, pred_events, strict_hit)
        wording_only = False
        if all_correct:
            end_ok += 1
            end_ok_wide += 1
        else:
            wording_only = all_correct_msg(gold_events, pred_events, title_hit)
            if wording_only:
                end_ok_wide += 1
                wording_ids.append(item['id'])   # 严格口径算失败，但日期时间全对、只是措辞不同
            badcases.append({'id': item['id'], 'category': item['category'], 'text': item['text'],
                             'gold': item['events'], 'pred': parsed.get('events'),
                             'wording_only': wording_only})

    # 端到端分母只算"该有日程"的消息：E 类（闲聊）没有标注事件，无从判定"解析对不对"，
    # 也不该被算成必然失败。旧口径分母含 E、分子不含 E，把 dev 的 60/68 压成了 60/80（75.0%）。
    end_total = sum(1 for i in items if i['has_schedule'])

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
        'time_acc': safe(time_ok, time_total), 'time_total': time_total,
        'loc_acc': safe(loc_ok, loc_total), 'loc_total': loc_total,
        'fab_time': fab_time, 'fab_loc': fab_loc,
        'end_acc': safe(end_ok, end_total), 'end_ok': end_ok, 'end_total': end_total,
        'end_acc_wide': safe(end_ok_wide, end_total), 'end_ok_wide': end_ok_wide,
        'wording_ids': wording_ids,
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
    print('  time      %s%%   (达标线 >=80%%)   %s' % (m['time_acc'], '达标' if m['time_acc'] >= 80 else '未达标'))
    print('  location  %s%%   (达标线 >=70%%)   %s' % (m['loc_acc'], '达标' if m['loc_acc'] >= 70 else '未达标'))
    print('编造(命中事件·gold 为空而模型填值):  time=%d  location=%d' % (m['fab_time'], m['fab_loc']))
    print('整条消息全对率:     %s%%   (%d/%d，分母=该有日程的消息数)' % (m['end_acc'], m['end_ok'], m['end_total']))
    # 括号里给"放宽措辞"的数：多出来的那些条，日期时间全对，只是标题换了说法。
    # 主指标仍是严格口径——同义词表是我自己定的，不该拿它刷分，只该拿它诊断失败性质。
    if m['wording_ids']:
        print('  同义措辞放宽后:   %s%%   (%d/%d) —— 多出的 %d 条只是说法不同：%s'
              % (m['end_acc_wide'], m['end_ok_wide'], m['end_total'],
                 len(m['wording_ids']), ', '.join(m['wording_ids'])))
    print('-' * 50)
    real = len(m['badcases']) - len(m['wording_ids'])
    if m['wording_ids']:
        print('badcase 数量: %d（其中 %d 条属同义改写，真正解析错 %d 条）'
              % (len(m['badcases']), len(m['wording_ids']), real))
    else:
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
