# MOA
Cloudflare Workers AI 上的 Mixture-of-Agents 服务

基于 [Mixture-of-Agents 论文](https://arxiv.org/abs/2406.04692)，在 Cloudflare Worker 上实现多层 MoA 推理编排，通过 Anthropic Messages API 和 MCP 两种协议接入 Claude Code / 任意 LLM 客户端。

用多个中小模型组合逼近前沿模型能力——不需要 Claude Fable 5 / gpt-5.6-sol 的预算，也能获得多视角、可复核、低幻觉的复杂任务处理。

## 背景

OpenRouter 前阵子在 DRACO 深度研究基准上做了个实验：**Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro** 三个模型 Fusion 起来，得分 **64.7%**，和 Claude Fable 5 单跑的 **65.3%** 只差 0.6 个百分点，而单任务成本大约只有一半。详见 [OpenRouter Fusion](https://openrouter.ai/blog/announcements/fusion-beats-frontier/)。

结论很直接：**单个模型不是终点，多个模型合体很多时候比单模型更强。**

但 OpenRouter 的 Fusion 是云端服务。我更想要的是：

- 模型可以换、供应商可以换、路由策略可以改
- 跑在免费 / 便宜的边缘推理上
- 最好支持各种 api 格式

于是就有了这个项目。

## 架构

```
请求
  │
  ├─ Layer 0: AnySearch 联网检索（可选）
  │    └─ 检索结果注入 <CONTEXT>，为深度研究任务提供证据
  │
  ├─ Layer 1: N 个 proposer 并行（不同模型提供多样化视角）
  │
  ├─ Layer 2: judge 冲突分析
  │    └─ 产出 CONSENSUS / CONFLICTS / OMISSIONS / UNSUPPORTED 清单
  │
  └─ Layer 3: aggregator（synthesizer）
       └─ 基于候选答案 + judge 分析综合最终答案，非简单拼接
```

## 功能

| 功能 | 说明 |
|------|------|
| Cloudflare Worker + Workers AI | `env.AI` 远程 binding，边缘推理 |
| Anthropic Messages API | `/v1/messages` 非流式 + SSE 流式，Claude Code 透明接入 |
| MCP Streamable HTTP | `/mcp` JSON-RPC，工具 `moa_reason` |
| 三层 MoA 编排 | proposer → judge → synthesizer，可配置为两层 |
| 联网搜索 | AnySearch / Tavily / SerpAPI 可插拔，best-effort 注入上下文 |
| 自由模型组合 | 12 个前沿模型可选，URL / MCP / 配置页三入口自由组合 |
| 模型预设 | Preset A（最强）/ B（均衡）/ C（对标 DeepSeek+Kimi+Qwen） |
| 调用限制 | 预算 / 并发 / 超时 / 重试 / 输出大小全部可配置 |
| 中英文支持 | `auto` / `zh-CN` / `en-US` |
| 配置页 | Web UI 一键生成 curl / MCP JSON 配置 |

## 可用模型

| 短名 | Workers AI binding | 特点 |
|------|-----|------|
| `kimi-k2.7-code` | `@cf/moonshotai/kimi-k2.7-code` | reasoning + agentic + vision + code |
| `glm-5.2` | `@cf/zai-org/glm-5.2` | reasoning + agentic + code |
| `kimi-k2.6` | `@cf/moonshotai/kimi-k2.6` | reasoning + agentic + vision |
| `nemotron-3-120b-a12b` | `@cf/nvidia/nemotron-3-120b-a12b` | 120B reasoning |
| `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` | aggregator 默认，便宜 |
| `gpt-oss-20b` | `@cf/openai/gpt-oss-20b` | fast |
| `gemma-4-26b-a4b-it` | `@cf/google/gemma-4-26b-a4b-it` | vision + 便宜 |
| `qwen3-30b-a3b` | `@cf/qwen/qwen3-30b-a3b-fp8` | reasoning |
| `glm-4.7-flash` | `@cf/zai-org/glm-4.7-flash` | flash |
| `qwen2.5-coder-32b` | `@cf/qwen/qwen2.5-coder-32b-instruct` | code |
| `mistral-small-3.1-24b` | `@cf/mistralai/mistral-small-3.1-24b-instruct` | — |
| `llama-3.3-70b` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 70B |

**预设组合**：

| 预设 | 组合 | 说明 |
|------|------|------|
| A | `kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/kimi-k2.6` | 3 前沿 proposer + kimi-k2.6 aggregator，最强 |
| B | `kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/gpt-oss-120b` | proposer 全前沿，aggregator 省 |
| C | `kimi-k2.6/qwen3-30b-a3b/glm-5.2/gpt-oss-120b` | 对标 DeepSeek+Kimi+Qwen Fusion |

组合格式：`proposer1/proposer2/.../aggregator`（最后一个为 aggregator）。

## 快速开始

### 部署

```bash
npm install
npm run typecheck

# 配置鉴权 token
cp .dev.vars.example .dev.vars  # 编辑 .dev.vars 填入 token

# 部署到 Cloudflare
npx wrangler secret put MOA_AUTH_TOKEN
npm run deploy
```

### 接入 Claude Code

在 `~/.claude/settings.json` 中配置：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<你的 MOA_AUTH_TOKEN>",
    "ANTHROPIC_BASE_URL": "https://<worker-domain>",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/kimi-k2.6",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/gpt-oss-120b",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "moa-haiku",
    "API_TIMEOUT_MS": "300000"
  }
}
```

> `ANTHROPIC_BASE_URL` 填 Worker 域名根地址，不要追加 `/v1`。模型字段可以是别名（`moa-opus`）或组合字符串（含 `/`）。

### 联网搜索（可选）

为深度研究任务（如 DRACO 基准）启用联网检索：

```bash
# wrangler.jsonc 已默认启用 anysearch
# 配置 API key（可选，无 key 也可用，只是限频更低）
npx wrangler secret put ANYSEARCH_API_KEY
```

支持的搜索引擎：[AnySearch](https://www.anysearch.com/)（默认）/ Tavily / SerpAPI，通过 `MOA_SEARCH_PROVIDER` 环境变量切换。

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `MOA_AUTH_TOKEN` | — | 鉴权 token（必设） |
| `MOA_JUDGE_ENABLED` | `false` | 启用三层 MoA（judge 层） |
| `MOA_SEARCH_PROVIDER` | `none` | 搜索引擎：`anysearch` / `tavily` / `serpapi` / `none` |
| `MOA_SEARCH_MAX_RESULTS` | `5` | 每次检索返回结果数 |
| `MOA_MAX_PROPOSERS` | `3` | proposer 数量上限 |
| `MOA_MAX_AI_CALLS` | `4` | 单次请求 AI 调用预算 |
| `MOA_MAX_CONCURRENT_AGENTS` | `3` | 并行 Agent 数 |
| `MOA_REQUEST_TIMEOUT_MS` | `120000` | 请求超时 |
| `MOA_MAX_OUTPUT_TOKENS` | `16384` | 单 Agent 输出 token 上限 |
| `ANYSEARCH_API_KEY` | — | AnySearch API key（可选） |
| `TAVILY_API_KEY` | — | Tavily API key |
| `SERPAPI_API_KEY` | — | SerpAPI API key |

完整配置见 `wrangler.jsonc`。

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查（无需鉴权） |
| `/v1/models` | GET | 模型列表 |
| `/v1/messages` | POST | Anthropic Messages API（非流式 + SSE） |
| `/mcp` | POST | MCP JSON-RPC（`moa_reason` 工具） |
| `/` | GET | 配置页 Web UI |

### 示例

```bash
WORKER_URL="https://your-worker.workers.dev"
TOKEN="<your-token>"

# Messages API — 用预设组合
curl -s $WORKER_URL/v1/messages \
  -H "x-api-key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/kimi-k2.6","max_tokens":1024,"messages":[{"role":"user","content":"解释 Cloudflare Worker 是什么"}]}'

# Messages API — 用别名
curl -s $WORKER_URL/v1/messages \
  -H "x-api-key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moa-opus","max_tokens":256,"messages":[{"role":"user","content":"What is 2+2?"}]}'
```

## 评测

### 基础基准（GSM8K / ARC / C-Eval）

```bash
bash evalscope/run_eval.sh 10
```

历史结果：70 题，整体准确率 98.6%。

### DRACO 深度研究基准

DRACO 是 Perplexity AI 提出的深度研究评测集（100 个复杂任务，覆盖学术 / 金融 / 法律 / 医疗 / 技术等 10 个领域），考的是搜索、理解、综合、引用能力。OpenRouter 在此基准上测得 Claude Fable 5 单跑 65.3%，而 Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro 的 Fusion 组合 64.7%——本仓库对标该结果，达标阈值 ≥ 60%：

```bash
DATASETS="draco" bash evalscope/run_eval.sh 100
```

DRACO 100 个深度研究任务，4 维度 rubric（factual accuracy / breadth & depth / presentation quality / citation quality），LLM-as-judge 评分。需启用联网搜索。

当前结果（Preset A，AnySearch 免费档）：overall 均值 **18.6%**，中位数 0.0%，仅 10% 任务 ≥ 60%。**未达对标 Fable 5 的目标。**

拆解后发现主因是**基础设施超时**而非答案质量：100 题中 59 题 prediction 阶段连接失败（worker 内部 `MOA_REQUEST_TIMEOUT_MS=120s` 不够 MoA 五步调用），剩余 41 题真有答案的 overall 均值 **45.5%**、≥60% 占比 24%。也就是说 18.6% 的低分主要被超时拉下去，而非模型能力本身。下一步优先级：(1) 放宽 worker/eval 超时 + 重试，先把 59% 失败率压下来；(2) 给 aggregator 传入检索源并强制引用规范，提升 citation（当前 9.1%）；(3) 增加每任务检索次数（当前 `maxQueries=1` 偏薄）。基础基准（GSM8K / ARC / C-Eval）98.6% 表明推理与知识能力本身可用。

## 项目结构

```
src/
├── index.ts              # 入口路由
├── config.ts             # 运行时配置
├── contracts.ts          # 类型定义
├── env.ts                # 环境变量接口
├── anthropic/            # Anthropic Messages API 兼容层
│   ├── route.ts          # /v1/messages 路由
│   ├── stream.ts         # SSE 流式
│   └── models.ts         # 公开模型别名
├── moa/                  # MoA 编排核心
│   ├── orchestrator.ts   # 多层编排（Layer 0-3）
│   ├── search.ts         # 联网搜索 provider
│   ├── prompts.ts        # proposer/judge/aggregator prompt
│   ├── profiles.ts       # 执行计划
│   └── model-selection.ts # 模型组合解析
├── workers-ai/           # Workers AI 适配
│   ├── adapter.ts        # 调用 + 重试
│   └── models.ts         # 模型白名单 + 预设
├── mcp/                  # MCP 协议
└── limits/               # 预算/并发/超时
evalscope/                # 评测脚本
wrangler.jsonc            # Cloudflare Worker 配置
```

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars  # 填入本地测试 token
npm run dev                      # http://127.0.0.1:8787
```

## 技术栈

- Cloudflare Workers AI（边缘推理，12+ 模型可选）
- TypeScript + Wrangler 4
- Anthropic Messages API 兼容协议
- MCP（Model Context Protocol）Streamable HTTP
- AnySearch / Tavily / SerpAPI（联网搜索）
- EvalScope（评测框架）

## License

MIT
