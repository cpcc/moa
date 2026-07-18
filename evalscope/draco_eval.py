#!/usr/bin/env python3
"""DRACO 基准评测脚本。

DRACO（Deep Research Accuracy, Completeness, and Objectivity）是 Perplexity AI 提出的
深度研究基准，100 个任务覆盖 10 个领域，4 维度 rubric 评分。

本脚本：
  1. 从 HuggingFace 下载 perplexity-ai/draco 数据集
  2. 对每个任务调用 moe API（Anthropic Messages 兼容）获取研究答案
  3. 用 LLM-as-judge 对答案做 4 维度 rubric 评分
  4. 输出 JSONL 预测 + 评分文件，兼容 generate_report.py

用法：
  python3 evalscope/draco_eval.py \
    --api-url https://moe-cloudflare-worker.arthur-162.workers.dev \
    --api-key "$MOA_AUTH_TOKEN" \
    --model moa-sonnet \
    --limit 100 \
    --work-dir outputs/draco_eval

相关文档：docs/DRACO接入方案.md §3.2 / §3.3 / Phase 2
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import anthropic
import requests

# ─────────────────────────────────────────────────────────────────────────────
# DRACO 数据集加载
# ─────────────────────────────────────────────────────────────────────────────

HF_DATASET = "perplexity-ai/draco"
HF_ROWS_API = "https://datasets-server.huggingface.co/rows"
HF_INFO_API = "https://datasets-server.huggingface.co/info"

# 带重试的 HTTP session，应对代理网络抖动
_session = requests.Session()
_adapter = requests.adapters.HTTPAdapter(max_retries=3)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)


def _get_dataset_splits() -> list[str]:
    """查询 DRACO 数据集可用的 split。"""
    for attempt in range(3):
        try:
            resp = _session.get(HF_INFO_API, params={"dataset": HF_DATASET}, timeout=30)
            resp.raise_for_status()
            info = resp.json()
            splits = list(info.get("dataset_info", {}).get("splits", {}).keys())
            return splits or ["test", "train"]
        except Exception as e:
            if attempt >= 2:
                print(f"[warn] 无法查询 DRACO splits，回退到 test/train: {e}", file=sys.stderr)
            time.sleep(3)
    return ["test", "train"]


def load_draco_dataset(limit: int = 100) -> list[dict]:
    """从 HuggingFace datasets-server 加载 DRACO 任务。

    自动探测 split，按 limit 截断。每条记录归一化为:
      {id, task, reference_answer, rubric, domain}
    """
    splits = _get_dataset_splits()
    all_rows: list[dict] = []
    for split in splits:
        offset = 0
        batch = 50
        while len(all_rows) < limit:
            params = {
                "dataset": HF_DATASET,
                "config": "default",
                "split": split,
                "offset": offset,
                "length": min(batch, limit - len(all_rows)),
            }
            data = None
            for attempt in range(3):
                try:
                    resp = _session.get(HF_ROWS_API, params=params, timeout=30)
                    resp.raise_for_status()
                    data = resp.json()
                    break
                except Exception as e:
                    if attempt >= 2:
                        print(f"[warn] 加载 split={split} offset={offset} 失败: {e}", file=sys.stderr)
                    time.sleep(3)
            if data is None:
                break
            rows = data.get("rows", [])
            if not rows:
                break
            for row in rows:
                record = row.get("row", row)
                all_rows.append(_normalize_draco_record(record))
            offset += len(rows)
            if len(rows) < batch:
                break
        if len(all_rows) >= limit:
            break
    return all_rows[:limit]


def _normalize_draco_record(record: dict) -> dict:
    """把 DRACO 原始记录归一化为统一字段名（兼容多种 schema 变体）。"""
    task = (
        record.get("task")
        or record.get("problem")
        or record.get("question")
        or record.get("prompt")
        or record.get("query")
        or record.get("instruction")
        or ""
    )
    reference = (
        record.get("reference_answer")
        or record.get("gold_answer")
        or record.get("answer")
        or record.get("reference")
        or record.get("ground_truth")
        or ""
    )
    rubric = (
        record.get("rubric")
        or record.get("criteria")
        or record.get("evaluation_criteria")
        or record.get("grading_rubric")
        or ""
    )
    domain = (
        record.get("domain")
        or record.get("category")
        or record.get("area")
        or record.get("field")
        or "unknown"
    )
    idx = record.get("id", record.get("idx", record.get("index", "")))
    return {
        "id": str(idx),
        "task": str(task),
        "reference_answer": str(reference),
        "rubric": str(rubric),
        "domain": str(domain),
    }


# ─────────────────────────────────────────────────────────────────────────────
# moe API 调用（Anthropic Messages 兼容）
# ─────────────────────────────────────────────────────────────────────────────


def create_client(api_url: str, api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(base_url=api_url, api_key=api_key)


def predict(client: anthropic.Anthropic, model: str, task: str, timeout: float = 200) -> str:
    """调用 moe API 获取研究答案。"""
    message = client.messages.create(
        model=model,
        max_tokens=8192,
        temperature=0.0,
        messages=[{"role": "user", "content": task}],
        timeout=timeout,
    )
    # 提取文本
    parts = []
    for block in message.content:
        if hasattr(block, "text"):
            parts.append(block.text)
    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# LLM-as-judge：4 维度 rubric 评分
# ─────────────────────────────────────────────────────────────────────────────

JUDGE_DIMENSIONS = [
    ("accuracy", "factual accuracy（事实准确性）"),
    ("completeness", "breadth and depth of analysis / completeness（广度深度/完整性）"),
    ("objectivity", "presentation quality / objectivity（呈现质量/客观性）"),
    ("citation", "citation quality（引用质量）"),
]


def build_judge_prompt(task: str, reference: str, prediction: str, rubric: str) -> str:
    """构造 4 维度 rubric judge prompt。"""
    dim_lines = "\n".join(f"  - {key}: {label}" for key, label in JUDGE_DIMENSIONS)
    rubric_block = f"<RUBRIC>\n{rubric}\n</RUBRIC>\n" if rubric.strip() else ""
    return f"""You are an expert judge evaluating a deep research answer on the DRACO benchmark.

Score the answer on 4 dimensions, each from 0.0 to 1.0:
{dim_lines}

Scoring guide:
  1.0 = excellent, comparable to a high-quality research report
  0.5 = adequate but with notable gaps
  0.0 = poor, missing or wrong

{rubric_block}Evaluate the PREDICTION against the TASK and the REFERENCE_ANSWER.

<TASK>
{task}
</TASK>

<REFERENCE_ANSWER>
{reference}
</REFERENCE_ANSWER>

<PREDICTION>
{prediction}
</PREDICTION>

Return ONLY a JSON object with this exact schema (no markdown, no prose):
{{"accuracy": <float>, "completeness": <float>, "objectivity": <float>, "citation": <float>, "overall": <float>, "reasoning": "<one sentence>"}}

The "overall" is the arithmetic mean of the 4 dimension scores."""


def parse_judge_scores(text: str) -> dict:
    """从 judge 输出中解析 JSON 评分。容错处理 markdown 包裹 / 前后文。"""
    # 尝试直接解析
    try:
        return _validate_scores(json.loads(text))
    except json.JSONDecodeError:
        pass
    # 尝试提取 ```json ... ``` 块
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return _validate_scores(json.loads(m.group(1)))
        except json.JSONDecodeError:
            pass
    # 尝试提取第一个 {...} 块
    m = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if m:
        try:
            return _validate_scores(json.loads(m.group(0)))
        except json.JSONDecodeError:
            pass
    # 解析失败：返回全 0
    return {"accuracy": 0.0, "completeness": 0.0, "objectivity": 0.0, "citation": 0.0, "overall": 0.0, "reasoning": "parse_failed"}


def _validate_scores(raw: dict) -> dict:
    dims = {}
    for key, _ in JUDGE_DIMENSIONS:
        val = raw.get(key, 0.0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            val = 0.0
        dims[key] = max(0.0, min(1.0, val))
    overall = raw.get("overall")
    if isinstance(overall, (int, float)):
        overall = float(overall)
    else:
        overall = sum(dims.values()) / len(JUDGE_DIMENSIONS)
    dims["overall"] = overall
    dims["reasoning"] = str(raw.get("reasoning", ""))
    return dims


def judge(
    client: anthropic.Anthropic,
    judge_model: str,
    task: str,
    reference: str,
    prediction: str,
    rubric: str,
    timeout: float = 200,
) -> dict:
    """调用 judge 模型评分。"""
    prompt = build_judge_prompt(task, reference, prediction, rubric)
    message = client.messages.create(
        model=judge_model,
        max_tokens=1024,
        temperature=0.0,
        messages=[{"role": "user", "content": prompt}],
        timeout=timeout,
    )
    parts = []
    for block in message.content:
        if hasattr(block, "text"):
            parts.append(block.text)
    return parse_judge_scores("\n".join(parts))


# ─────────────────────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="DRACO 基准评测")
    parser.add_argument("--api-url", required=True, help="moe API 根 URL")
    parser.add_argument("--api-key", required=True, help="moe API 认证 token")
    parser.add_argument("--model", default="moa-sonnet", help="被评测的模型名")
    parser.add_argument("--judge-model", default=None, help="judge 模型名（默认同 --model）")
    parser.add_argument("--limit", type=int, default=100, help="评测任务数上限")
    parser.add_argument("--work-dir", default="outputs/draco_eval", help="输出目录")
    parser.add_argument("--timeout", type=float, default=200, help="单次请求超时秒")
    parser.add_argument("--retries", type=int, default=3, help="失败重试次数")
    parser.add_argument("--judge-endpoint", default=None, help="judge 独立 API URL（默认同 --api-url）")
    parser.add_argument("--judge-key", default=None, help="judge 独立 API key（默认同 --api-key）")
    args = parser.parse_args()

    judge_model = args.judge_model or args.model
    work_dir = Path(args.work_dir)
    pred_dir = work_dir / "predictions" / args.model
    review_dir = work_dir / "reviews" / args.model
    report_dir = work_dir / "reports" / args.model
    pred_dir.mkdir(parents=True, exist_ok=True)
    review_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    # 客户端
    pred_client = create_client(args.api_url, args.api_key)
    judge_url = args.judge_endpoint or args.api_url
    judge_key = args.judge_key or args.api_key
    judge_client = create_client(judge_url, judge_key)

    # 加载数据集
    print(f"[DRACO] 加载数据集 {HF_DATASET}（limit={args.limit}）...")
    dataset = load_draco_dataset(args.limit)
    print(f"[DRACO] 加载 {len(dataset)} 个任务")
    if not dataset:
        print("[DRACO] 错误：数据集为空，退出", file=sys.stderr)
        sys.exit(1)

    pred_path = pred_dir / "draco.jsonl"
    review_path = review_dir / "draco.jsonl"

    results = []
    with open(pred_path, "w") as pred_f, open(review_path, "w") as review_f:
        for i, sample in enumerate(dataset):
            task_id = sample["id"] or str(i)
            task = sample["task"]
            reference = sample["reference_answer"]
            rubric = sample["rubric"]
            domain = sample["domain"]

            print(f"[DRACO] ({i + 1}/{len(dataset)}) domain={domain} id={task_id} ...", end="", flush=True)

            # 预测（带重试）
            prediction = ""
            for attempt in range(args.retries + 1):
                try:
                    prediction = predict(pred_client, args.model, task, timeout=args.timeout)
                    break
                except Exception as e:
                    if attempt >= args.retries:
                        prediction = f"[PREDICTION_FAILED] {e}"
                        break
                    time.sleep(15)

            # 评分（带重试）
            scores = None
            for attempt in range(args.retries + 1):
                try:
                    scores = judge(judge_client, judge_model, task, reference, prediction, rubric, timeout=args.timeout)
                    break
                except Exception as e:
                    if attempt >= args.retries:
                        scores = {"accuracy": 0.0, "completeness": 0.0, "objectivity": 0.0, "citation": 0.0, "overall": 0.0, "reasoning": f"judge_failed: {e}"}
                        break
                    time.sleep(15)

            overall = scores["overall"]
            print(f" overall={overall:.3f}")

            # 写预测
            pred_f.write(json.dumps({
                "id": task_id,
                "domain": domain,
                "task": task,
                "prediction": prediction,
            }, ensure_ascii=False) + "\n")
            pred_f.flush()

            # 写评分
            review_f.write(json.dumps({
                "id": task_id,
                "domain": domain,
                "target": reference,
                "prediction": prediction,
                "scores": scores,
            }, ensure_ascii=False) + "\n")
            review_f.flush()

            results.append({"id": task_id, "domain": domain, "scores": scores})

    # 汇总
    _write_summary(report_dir, results, args.model)
    _print_summary(results, args.model)


def _print_summary(results: list[dict], model: str):
    print()
    print("=" * 78)
    print(f"  DRACO 评测报告  (模型: {model})")
    print(f"  对照: Fable 5 = 65.3%, 平价 Fusion = 64.7%, 达标阈值 ≥ 60%")
    print("=" * 78)

    dims = [key for key, _ in JUDGE_DIMENSIONS]
    for dim in dims:
        vals = [r["scores"][dim] for r in results]
        avg = sum(vals) / len(vals) if vals else 0
        print(f"  {dim:<16} {avg * 100:6.2f}%")

    overalls = [r["scores"]["overall"] for r in results]
    overall_avg = sum(overalls) / len(overalls) if overalls else 0
    print(f"  {'OVERALL':<16} {overall_avg * 100:6.2f}%   [Fable 5: 65.3%, 差距: {overall_avg * 100 - 65.3:+.1f}]")
    print()

    # 按领域
    by_domain: dict[str, list[float]] = {}
    for r in results:
        by_domain.setdefault(r["domain"], []).append(r["scores"]["overall"])
    print("  按领域：")
    for domain in sorted(by_domain):
        vals = by_domain[domain]
        avg = sum(vals) / len(vals) * 100
        print(f"    {domain:<25} {avg:6.2f}%  ({len(vals)} 任务)")
    print("=" * 78)


def _write_summary(report_dir: Path, results: list[dict], model: str):
    dims = [key for key, _ in JUDGE_DIMENSIONS]
    summary = {
        "model": model,
        "benchmark": "draco",
        "num_tasks": len(results),
        "fable5_reference": 65.3,
        "threshold": 60.0,
        "dimension_scores": {},
        "overall": 0,
        "by_domain": {},
    }
    for dim in dims:
        vals = [r["scores"][dim] for r in results]
        summary["dimension_scores"][dim] = round(sum(vals) / len(vals) * 100, 2) if vals else 0
    overalls = [r["scores"]["overall"] for r in results]
    summary["overall"] = round(sum(overalls) / len(overalls) * 100, 2) if overalls else 0
    by_domain: dict[str, list[float]] = {}
    for r in results:
        by_domain.setdefault(r["domain"], []).append(r["scores"]["overall"])
    for domain, vals in by_domain.items():
        summary["by_domain"][domain] = {
            "num_tasks": len(vals),
            "overall": round(sum(vals) / len(vals) * 100, 2),
        }
    path = report_dir / "draco_summary.json"
    with open(path, "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n[DRACO] 报告已保存到: {path}")


if __name__ == "__main__":
    main()
