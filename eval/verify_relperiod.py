# 相对周期规则（v1.4）稳定性验证：每条语料复跑 3 次，统计 date 命中率。
# 用法：PYTHON=<venv> python eval/verify_relperiod.py
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, 'eval')
import run_eval as ev

N = 3
items = []
for line in open('eval/corpus/relative_period.jsonl', encoding='utf-8'):
    line = line.strip()
    if line:
        items.append(json.loads(line))

key = ev.load_api_key()
print('v1.4 相对周期规则稳定性验证（每条 %d 次）\n' % N)
all_ok = 0
for it in items:
    gold_date = it['events'][0]['date']
    gold_dl = it['events'][0].get('is_deadline')
    hits = 0
    samples = []
    for _ in range(N):
        r = ev.call_llm(it['text'], it['ref_date'], ev.weekday_cn(it['ref_date']), key)
        evs = r.get('events') or []
        got_date = evs[0].get('date') if evs else None
        got_dl = evs[0].get('is_deadline') if evs else None
        ok = (got_date == gold_date and got_dl == gold_dl)
        if ok:
            hits += 1
        samples.append((got_date, got_dl))
    status = '稳定正确' if hits == N else ('部分正确' if hits > 0 else '全错')
    all_ok += hits
    print('%s [%s] 期望 date=%s dl=%s' % (it['id'], status, gold_date, gold_dl))
    print('   文: %s' % it['text'])
    for k, (d, dl) in enumerate(samples, 1):
        print('   第%d次 -> date=%s dl=%s %s' % (k, d, dl, '✓' if (d == gold_date and dl == gold_dl) else '✗'))
    print()

print('=' * 50)
print('总命中: %d / %d（%d 条 × %d 次）' % (all_ok, len(items) * N, len(items), N))
