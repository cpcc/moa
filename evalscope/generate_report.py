#!/usr/bin/env python3
"""从 evalscope 的 reviews JSONL 文件生成汇总报告，并对照 Fable 5 公开分数。"""
import json
import os
import sys
from pathlib import Path
from collections import defaultdict


# Fable 5（Claude Opus 4.5 级）公开分数参考量级（来自 docs/目标.md 调研）
# None 表示该基准非 Fable 5 常见公开分数项
FABLE5_SCORES = {
    "gsm8k": 97.0,        # GSM8K 数学推理，Fable 5 接近满分
    "arc": 96.0,          # ARC-Challenge 科学推理
    "ceval": None,        # C-Eval 中文综合（非 Fable 5 常见基准）
    "humaneval": 90.0,    # HumanEval 代码生成
    "mbpp": 85.0,         # MBPP 代码生成
    "ifeval": 85.0,       # IFEval 指令遵循
    "mmlu_pro": 75.0,     # MMLU-Pro 多步推理
    "gpqa": 50.0,         # GPQA 研究生级推理
    "bbh": 85.0,          # BIG-Bench Hard
    "math": 80.0,         # MATH 数学
    "longbench_v2": 85.0, # LongBench 长文档
    "draco": 65.3,        # DRACO 深度研究（Fable 5 单跑 65.3%）
}


def parse_review_file(filepath):
    """解析单个 review JSONL 文件，返回 (correct, total, details)。"""
    correct = 0
    total = 0
    details = []
    with open(filepath) as f:
        for i, line in enumerate(f):
            d = json.loads(line)
            target = d.get("target", "?")
            ss = d.get("sample_score", {})
            if isinstance(ss, str):
                ss = json.loads(ss)
            sc = ss.get("score", {}).get("value", {})
            acc = sc.get("acc", 0) if isinstance(sc, dict) else 0
            pred = ss.get("score", {}).get("extracted_prediction", "?")
            is_correct = acc == 1.0 or acc == 1
            if is_correct:
                correct += 1
            total += 1
            details.append({
                "index": i,
                "target": target,
                "prediction": pred,
                "correct": is_correct,
            })
    return correct, total, details


# DRACO 4 维度 rubric（连续评分 0-1，非二分正确/错误）
DRACO_DIMS = ["accuracy", "completeness", "objectivity", "citation"]


def parse_draco_review_file(filepath):
    """解析 DRACO review JSONL，返回 (num_tasks, dim_sums, domain_scores, details)。

    dim_sums: {dim: sum_of_scores}
    domain_scores: {domain: {"count": n, "overall_sum": s}}
    """
    num = 0
    dim_sums = {dim: 0.0 for dim in DRACO_DIMS}
    overall_sum = 0.0
    domain_scores = defaultdict(lambda: {"count": 0, "overall_sum": 0.0})
    details = []
    with open(filepath) as f:
        for i, line in enumerate(f):
            d = json.loads(line)
            scores = d.get("scores", {})
            for dim in DRACO_DIMS:
                dim_sums[dim] += float(scores.get(dim, 0.0))
            overall_sum += float(scores.get("overall", 0.0))
            domain = d.get("domain", "unknown")
            domain_scores[domain]["count"] += 1
            domain_scores[domain]["overall_sum"] += float(scores.get("overall", 0.0))
            num += 1
            details.append({
                "index": i,
                "id": d.get("id", ""),
                "domain": domain,
                "overall": float(scores.get("overall", 0.0)),
            })
    return num, dim_sums, overall_sum, dict(domain_scores), details


def main():
    reviews_dir = sys.argv[1] if len(sys.argv) > 1 else "outputs/eval_20260718_113308/20260718_113310/reviews/moa-sonnet"

    results = defaultdict(lambda: {"correct": 0, "total": 0, "subsets": {}})
    draco_results = None  # (num, dim_sums, overall_sum, domain_scores)

    for filepath in sorted(Path(reviews_dir).glob("*.jsonl")):
        name = filepath.stem  # e.g. gsm8k_main, arc_ARC-Easy, ceval_computer_network

        # 解析数据集名和子集名
        if name.startswith("ceval_"):
            dataset = "ceval"
            subset = name[len("ceval_"):]
        elif name.startswith("arc_"):
            dataset = "arc"
            subset = name[len("arc_"):]
        elif name.startswith("gsm8k_"):
            dataset = "gsm8k"
            subset = name[len("gsm8k_"):]
        elif name.startswith("humaneval_"):
            dataset = "humaneval"
            subset = name[len("humaneval_"):]
        elif name.startswith("ifeval_"):
            dataset = "ifeval"
            subset = name[len("ifeval_"):]
        elif name.startswith("mbpp_"):
            dataset = "mbpp"
            subset = name[len("mbpp_"):]
        elif name.startswith("draco"):
            dataset = "draco"
            subset = "main"
        else:
            dataset = name
            subset = "main"

        if dataset == "draco":
            num, dim_sums, overall_sum, domain_scores, _ = parse_draco_review_file(filepath)
            if draco_results is None:
                draco_results = (0, {dim: 0.0 for dim in DRACO_DIMS}, 0.0, {})
            prev_num, prev_dims, prev_overall, prev_domains = draco_results
            merged_num = prev_num + num
            merged_dims = {dim: prev_dims[dim] + dim_sums[dim] for dim in DRACO_DIMS}
            merged_overall = prev_overall + overall_sum
            merged_domains = dict(prev_domains)
            for dom, ds in domain_scores.items():
                if dom in merged_domains:
                    merged_domains[dom] = {
                        "count": merged_domains[dom]["count"] + ds["count"],
                        "overall_sum": merged_domains[dom]["overall_sum"] + ds["overall_sum"],
                    }
                else:
                    merged_domains[dom] = ds
            draco_results = (merged_num, merged_dims, merged_overall, merged_domains)
            continue

        correct, total, _ = parse_review_file(filepath)
        results[dataset]["correct"] += correct
        results[dataset]["total"] += total
        results[dataset]["subsets"][subset] = {"correct": correct, "total": total}

    # 生成报告
    model_name = os.path.basename(os.path.normpath(reviews_dir))
    print("=" * 78)
    print(f"  moe EvalScope 评测报告  (模型: {model_name})")
    print(f"  评测框架: EvalScope 1.9.0 (anthropic_api 模式)")
    print(f"  对照: Fable 5 (Claude Opus 4.5 级) 公开分数参考量级")
    print("=" * 78)
    print()

    grand_correct = 0
    grand_total = 0

    for dataset in ["gsm8k", "arc", "ceval", "humaneval", "ifeval", "mbpp", "mmlu_pro", "gpqa", "bbh", "math", "longbench_v2"]:
        if dataset not in results:
            continue
        r = results[dataset]
        pct = r["correct"] / r["total"] * 100 if r["total"] > 0 else 0
        f5 = FABLE5_SCORES.get(dataset)
        f5_str = f"  [Fable 5 参考: {f5:.0f}%, 差距: {pct - f5:+.1f}]" if f5 is not None else ""
        print(f"【{dataset.upper()}】{r['correct']}/{r['total']} = {pct:.1f}%{f5_str}")
        for subset, sr in sorted(r["subsets"].items()):
            spct = sr["correct"] / sr["total"] * 100 if sr["total"] > 0 else 0
            print(f"  - {subset:<30} {sr['correct']}/{sr['total']} = {spct:.1f}%")
        print()
        grand_correct += r["correct"]
        grand_total += r["total"]

    # DRACO 4 维度报告（连续评分，单独展示）
    draco_report_data = None
    if draco_results is not None:
        num, dim_sums, overall_sum, domain_scores = draco_results
        if num > 0:
            print("=" * 78)
            print(f"  【DRACO】深度研究基准 ({num} 任务)")
            print(f"  对照: Fable 5 = 65.3%, 平价 Fusion = 64.7%, 达标阈值 ≥ 60%")
            print("=" * 78)
            for dim in DRACO_DIMS:
                avg = dim_sums[dim] / num * 100
                print(f"  {dim:<16} {avg:6.2f}%")
            overall_pct = overall_sum / num * 100
            gap = overall_pct - 65.3
            print(f"  {'OVERALL':<16} {overall_pct:6.2f}%   [Fable 5: 65.3%, 差距: {gap:+.1f}]")
            if gap >= 0:
                print(f"  ✓ 达标（≥ 60%）" if overall_pct >= 60 else f"  ✗ 未达标")
            else:
                print(f"  {'✓ 达标（≥ 60%）' if overall_pct >= 60 else '✗ 未达标'}")
            print()
            print("  按领域：")
            for dom in sorted(domain_scores):
                ds = domain_scores[dom]
                avg = ds["overall_sum"] / ds["count"] * 100 if ds["count"] > 0 else 0
                print(f"    {dom:<25} {avg:6.2f}%  ({ds['count']} 任务)")
            print()
            draco_report_data = {
                "num_tasks": num,
                "dimension_scores": {dim: round(dim_sums[dim] / num * 100, 2) for dim in DRACO_DIMS},
                "overall": round(overall_pct, 2),
                "fable5_reference": 65.3,
                "gap": round(gap, 2),
                "by_domain": {
                    dom: {
                        "num_tasks": ds["count"],
                        "overall": round(ds["overall_sum"] / ds["count"] * 100, 2) if ds["count"] > 0 else 0,
                    }
                    for dom, ds in sorted(domain_scores.items())
                },
            }

    grand_pct = grand_correct / grand_total * 100 if grand_total > 0 else 0
    print("=" * 78)
    print(f"  总计（准确率基准）: {grand_correct}/{grand_total} = {grand_pct:.1f}%")
    print("=" * 78)

    # 生成 JSON 报告
    report = {
        "model": model_name,
        "framework": "evalscope 1.9.0",
        "eval_type": "anthropic_api",
        "total_correct": grand_correct,
        "total_num": grand_total,
        "overall_accuracy": round(grand_pct, 2),
        "fable5_reference": FABLE5_SCORES,
        "datasets": {},
    }
    for dataset, r in results.items():
        pct = r["correct"] / r["total"] * 100 if r["total"] > 0 else 0
        f5 = FABLE5_SCORES.get(dataset)
        report["datasets"][dataset] = {
            "correct": r["correct"],
            "total": r["total"],
            "accuracy": round(pct, 2),
            "fable5_reference": f5,
            "gap": round(pct - f5, 2) if f5 is not None else None,
            "subsets": {
                k: {"correct": v["correct"], "total": v["total"], "accuracy": round(v["correct"] / v["total"] * 100, 2) if v["total"] > 0 else 0}
                for k, v in r["subsets"].items()
            },
        }
    if draco_report_data is not None:
        report["datasets"]["draco"] = draco_report_data

    report_path = os.path.join(os.path.dirname(reviews_dir), "..", "reports", "summary.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n报告已保存到: {report_path}")


if __name__ == "__main__":
    main()
