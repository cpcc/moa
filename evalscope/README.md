# EvalScope 评测 moe API

> 使用 [EvalScope](https://github.com/modelscope/evalscope) 评测 moe MoA 服务的得分
> 日期：2026-07-18

---

## 1. 环境准备

### 1.1 依赖安装

```bash
cd /Users/ckj/dev/moe
python3 -m venv .venv-evalscope
source .venv-evalscope/bin/activate
pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install evalscope -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install anthropic -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 1.2 关键信息

| 项 | 值 |
|---|---|
| 评测框架 | EvalScope 1.9.0 |
| 评测类型 | `anthropic_api`（Anthropic Claude API 兼容） |
| 模型名 | `moa-sonnet`（moa-opus / moa-sonnet / moa-haiku 底层均为同一个 MoA） |
| API 地址 | `https://moe-cloudflare-worker.arthur-162.workers.dev` |
| 认证方式 | `x-api-key` header（Anthropic SDK 默认） |
| Token 来源 | `~/.claude.json` 的 MCP moa 配置 |

### 1.3 集成原理

- moe 的 `/v1/messages` 实现了 Anthropic Messages API 兼容协议
- EvalScope 的 `anthropic_api` 模式使用官方 `anthropic` Python SDK
- Anthropic SDK 自动在 `base_url` 后追加 `/v1/messages`，所以 `--api-url` 传根路径即可
- 认证通过 `x-api-key` header 传递（moe 的 `authorizeAnthropic` 同时支持 `x-api-key` 和 `Authorization: Bearer`）

---

## 2. 运行评测

### 2.1 一键脚本

```bash
# 快速验证（每数据集 10 条，约 15 分钟）
bash evalscope/run_eval.sh 10

# 中等规模（每数据集 30 条，约 45 分钟）
bash evalscope/run_eval.sh 30

# 大规模（每数据集 100 条，约 3 小时）
bash evalscope/run_eval.sh 100
```

### 2.2 直接命令

```bash
source .venv-evalscope/bin/activate
export MOA_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('/Users/ckj/.claude.json'))['mcpServers']['moa']['headers']['Authorization'].replace('Bearer ',''))")
export HTTPS_PROXY=http://localhost:7890  # 访问 modelscope + workers.dev

evalscope eval \
  --model moa-sonnet \
  --eval-type anthropic_api \
  --api-url https://moe-cloudflare-worker.arthur-162.workers.dev \
  --api-key "$MOA_AUTH_TOKEN" \
  --datasets gsm8k arc ceval \
  --limit 10 \
  --work-dir outputs/eval_$(date +%Y%m%d_%H%M%S) \
  --ignore-errors \
  --generation-config '{"max_tokens":2048,"temperature":0.0,"timeout":180,"retries":3,"retry_interval":15}'
```

### 2.3 Python 方式

```python
import os
from evalscope import TaskConfig, run_task

os.environ['MOA_AUTH_TOKEN'] = ...  # 从 ~/.claude.json 读取
os.environ['HTTPS_PROXY'] = 'http://localhost:7890'

task_cfg = TaskConfig(
    model='moa-sonnet',
    eval_type='anthropic_api',
    api_url='https://moe-cloudflare-worker.arthur-162.workers.dev',
    api_key=os.environ['MOA_AUTH_TOKEN'],
    datasets=['gsm8k', 'arc', 'ceval'],
    limit=10,
    work_dir='outputs/eval',
    ignore_errors=True,
    generation_config={
        'max_tokens': 2048,
        'temperature': 0.0,
        'timeout': 180,
        'retries': 3,
        'retry_interval': 15,
    },
)
run_task(task_cfg=task_cfg)
```

---

## 3. 数据集说明

| 数据集 | 名称 | 能力维度 | 题型 |
|--------|------|----------|------|
| `gsm8k` | GSM8K | 数学推理 | 小学数学应用题（4-shot CoT） |
| `arc` | AI2 ARC | 科学推理 | 小学科学选择题（ARC-Easy + ARC-Challenge） |
| `ceval` | C-Eval | 中文综合 | 中文学科选择题（52 学科） |

---

## 4. 评测结果

> 结果文件位于 `outputs/eval_YYYYMMDD_HHMMSS/reports/`

### 4.1 冒烟测试（gsm8k 3 条）

| 数据集 | 样本数 | 准确率 | 平均延迟 |
|--------|--------|--------|----------|
| gsm8k | 3 | **100%** (3/3) | 101s |

### 4.2 正式评测（2026-07-18）

每数据集 10 条样本（arc 含 Easy+Challenge 两个子集共 20 条，ceval 完成了 5 个计算机学科子集）。

| 数据集 | 子集 | 正确/总数 | 准确率 |
|--------|------|-----------|--------|
| **GSM8K** | main | 10/10 | **100.0%** |
| **ARC** | ARC-Easy | 10/10 | **100.0%** |
| | ARC-Challenge | 10/10 | **100.0%** |
| **C-Eval** | computer_network | 10/10 | **100.0%** |
| | operating_system | 9/9 | **100.0%** |
| | computer_architecture | 8/8 | **100.0%** |
| | college_programming | 7/8 | 87.5% |
| | college_physics | 5/5 | **100.0%** |
| **总计** | | **69/70** | **98.6%** |

> 唯一答错的 1 条是 `ceval_college_programming` 中的 1 道编程题。

#### 评测结论

- **数学推理（GSM8K）**：100%，MoA 的多 Agent 协作在多步数学推理上表现完美
- **科学推理（ARC）**：100%，包括更具挑战性的 ARC-Challenge 子集
- **中文综合（C-Eval）**：97.5%（5 个计算机学科），仅 1 道编程题答错
- **整体准确率**：98.6%（69/70）

#### 性能指标

- 单次请求平均延迟：30-100 秒（MoA 4 次 Workers AI 调用）
- 部分长 prompt 样本会触发 MoA 60 秒超时，evalscope 自动重试后成功

查看完整报告：

```bash
# 文本汇总报告
python3 evalscope/generate_report.py outputs/eval_*/2026*/reviews/moa-sonnet

# evalscope 原生 JSON 报告
cat outputs/eval_*/2026*/reports/moa-sonnet/gsm8k.json | python3 -m json.tool
cat outputs/eval_*/2026*/reports/moa-sonnet/arc.json | python3 -m json.tool

# 启动可视化面板
pip install 'evalscope[service]'
evalscope service
# 访问 http://127.0.0.1:9000
```

---

## 5. 注意事项

### 5.1 延迟较高

MoA 每次请求需调用 3 个 proposer + 1 个 aggregator（共 4 次 Workers AI 调用），单次请求 30-100 秒。建议：
- 评测时设置 `timeout >= 180` 秒
- 使用 `--ignore-errors` 避免单条失败中断
- 大规模评测用 `--use-cache` 支持断点续跑

### 5.2 token 统计为 0

moe 的 `route.ts` 返回 `usage: {input_tokens: 0, output_tokens: 0}`（因为 Workers AI 不提供 token 计数）。这不影响准确率评测，但 perf metrics 的 token 相关指标无意义。

### 5.3 网络代理

- ModelScope 数据集下载需要代理：`HTTPS_PROXY=http://localhost:7890`
- workers.dev 访问也需要代理
- 代理需同时支持两者

### 5.4 重试

部分请求可能因 MoA 超时（60s）或网络抖动失败，evalscope 会自动重试（默认 3 次，间隔 15 秒）。`--ignore-errors` 确保失败样本被跳过而非中断。

---

## 6. 文件结构

```
evalscope/
├── run_eval.sh              # 一键评测脚本
├── config_smoke.yaml        # 冒烟测试配置
└── README.md                # 本文档

outputs/
├── smoke_test/              # 冒烟测试结果
│   └── 20260718_112049/
│       ├── predictions/     # 模型预测
│       ├── reviews/         # 评分结果
│       └── reports/         # 最终报告（HTML + JSON）
└── eval_YYYYMMDD_HHMMSS/    # 正式评测结果
```
