#!/usr/bin/env bash
# EvalScope 评测 moe API 脚本
# 用法:
#   bash evalscope/run_eval.sh [limit]                                  # 默认数据集 + 默认模型
#   MODELS=kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/gpt-oss-120b bash evalscope/run_eval.sh 10  # 指定模型组合
#   DATASETS="humaneval ifeval" bash evalscope/run_eval.sh 20            # 指定数据集（对标 Fable 5）
#   DATASETS="draco" bash evalscope/run_eval.sh 100                     # DRACO 深度研究基准（对标 Fable 5 = 65.3%）
#   DATASETS="draco gsm8k" bash evalscope/run_eval.sh 50                # DRACO + 其它基准混合
#   MODEL=moa-opus DATASETS="humaneval" bash evalscope/run_eval.sh 5    # 用别名
set -euo pipefail
cd "$(dirname "$0")/.."

# 激活虚拟环境
source .venv-evalscope/bin/activate

# 从 ~/.claude.json 读取生产 token
export MOA_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('/Users/ckj/.claude.json'))['mcpServers']['moa']['headers']['Authorization'].replace('Bearer ',''))")

# 代理设置（访问 modelscope 下载数据集 + 访问 workers.dev + 访问 HuggingFace）
export HTTPS_PROXY=http://localhost:7890
export HTTP_PROXY=http://localhost:7890
export NO_PROXY=localhost,127.0.0.1

LIMIT=${1:-10}
# MODEL 可以是别名（moa-sonnet）或组合字符串（含 /，如 kimi-k2.7-code/glm-5.2/.../gpt-oss-120b）
MODEL="${MODELS:-moa-sonnet}"
DATASETS="${DATASETS:-gsm8k arc ceval}"
API_URL="${MOA_API_URL:-https://moe-cloudflare-worker.arthur-162.workers.dev}"
WORK_DIR="outputs/eval_$(date +%Y%m%d_%H%M%S)"

# 把 DATASETS 拆成数组
DATASET_ARRAY=($DATASETS)

# 分离 draco 和其它数据集
DRACO_INCLUDED=false
OTHER_DATASETS=()
for ds in "${DATASET_ARRAY[@]}"; do
  if [ "$ds" = "draco" ]; then
    DRACO_INCLUDED=true
  else
    OTHER_DATASETS+=("$ds")
  fi
done

echo "============================================"
echo "  EvalScope moe API 评测"
echo "  模型: $MODEL"
echo "  数据集: $DATASETS"
echo "  每数据集样本数: $LIMIT"
echo "  输出目录: $WORK_DIR"
echo "============================================"

# ─────────────────────────────────────────────────────────────
# Part 1: DRACO 深度研究基准（4 维度 rubric，LLM-as-judge）
# 文档：docs/DRACO接入方案.md §3.2 / Phase 2
# ─────────────────────────────────────────────────────────────
if [ "$DRACO_INCLUDED" = "true" ]; then
  echo ""
  echo ">>> [DRACO] 深度研究基准评测（100 任务，4 维度 rubric）..."
  echo ">>> 对照: Fable 5 = 65.3%, 平价 Fusion = 64.7%, 达标阈值 ≥ 60%"
  # judge 模型默认同被评测模型；可用 JUDGE_MODEL 环境变量覆盖
  JUDGE="${JUDGE_MODEL:-$MODEL}"
  python3 evalscope/draco_eval.py \
    --api-url "$API_URL" \
    --api-key "$MOA_AUTH_TOKEN" \
    --model "$MODEL" \
    --judge-model "$JUDGE" \
    --limit "$LIMIT" \
    --work-dir "$WORK_DIR" \
    --timeout 200 \
    --retries 3 \
    2>&1 | tee -a "$WORK_DIR/eval.log" || true
fi

# ─────────────────────────────────────────────────────────────
# Part 2: 标准确确率基准（gsm8k / arc / humaneval / ...）
# ─────────────────────────────────────────────────────────────
if [ ${#OTHER_DATASETS[@]} -gt 0 ]; then
  OTHER_STR="${OTHER_DATASETS[*]}"
  echo ""
  echo ">>> [EvalScope] 准确率基准评测: $OTHER_STR"
  mkdir -p "$WORK_DIR"
  evalscope eval \
    --model "$MODEL" \
    --eval-type anthropic_api \
    --api-url "$API_URL" \
    --api-key "$MOA_AUTH_TOKEN" \
    --datasets $OTHER_STR \
    --limit "$LIMIT" \
    --work-dir "$WORK_DIR" \
    --ignore-errors \
    --generation-config '{"max_tokens":2048,"temperature":0.0,"timeout":200,"retries":3,"retry_interval":15}' \
    2>&1 | tee -a "$WORK_DIR/eval.log" || true
fi

echo ""
echo "============================================"
echo "  评测完成！"
echo "  结果目录: $WORK_DIR"
echo "  报告: python3 evalscope/generate_report.py $WORK_DIR/reviews/$MODEL"
echo "============================================"
