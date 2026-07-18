import json
import sys

f = sys.argv[1]
correct = 0
total = 0
for i, line in enumerate(open(f)):
    d = json.loads(line)
    target = d.get("target", "?")
    ss = d.get("sample_score", {})
    if isinstance(ss, str):
        ss = json.loads(ss)
    sc = ss.get("score", {}).get("value", {})
    acc = sc.get("acc", "?") if isinstance(sc, dict) else "?"
    if acc == 1.0 or acc == 1:
        correct += 1
    total += 1
    pred = ss.get("score", {}).get("extracted_prediction", "?")
    print(f"样本{i}: target={target} pred={pred} acc={acc}")
print(f"\n小计: {correct}/{total} = {correct/total*100:.1f}%" if total > 0 else "无数据")
