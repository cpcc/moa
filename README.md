# MOE Cloudflare Worker

面向 Claude Code 的 Cloudflare Workers AI MoA MCP 服务。

## 当前实现

已部署到生产环境并验证通过。生产地址：`https://moe-cloudflare-worker.arthur-162.workers.dev`

已实现的功能：

- Cloudflare Worker + Workers AI binding `env.AI`；
- MCP Streamable HTTP 风格的无状态 `/mcp` JSON-RPC 处理；
- Bearer Token 鉴权（MCP 和 Anthropic API 双通道）；
- MCP `initialize`、`notifications/initialized`、`tools/list`、`tools/call`；
- Anthropic Messages API 兼容路由 `/v1/messages`、`/v1/models`；
- SSE 流式输出（协议级 `text/event-stream`）；
- 没有 AI binding 的测试/本地环境使用确定性 mock；
- 有 AI binding 时使用服务端固定模型 `@cf/openai/gpt-oss-120b`；
- 默认执行三 proposer 并行 + 一个 aggregator 的两层 MoA；
- 返回最终答案和中间 Agent 结果（含每层 Agent 状态、模型、耗时）；
- 实施调用次数、并发、超时、重试和输出大小限制；
- 支持中文、英文和中英混合任务。

尚未实现：Workers AI token 级 streaming、动态模型路由、三层以上 MoA、MCP 资源/prompts。

## 本地启动

```bash
npm install
cp .dev.vars.example .dev.vars
npm run typecheck
npm test
npm run dev
```

本地 Worker 默认地址为 `http://127.0.0.1:8787`。健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## Claude Code 直接配置（Messages API）

如果不使用 MCP，可以让 Claude Code 把本 Worker 当作 Anthropic Messages API 网关。配置文件示例见 `.claude-code.env.example`：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<与 MOA_AUTH_TOKEN 相同>",
    "ANTHROPIC_BASE_URL": "https://<worker-domain>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "moa-haiku",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "moa-opus",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "moa-sonnet",
    "API_TIMEOUT_MS": "300000"
  }
}
```

`ANTHROPIC_BASE_URL` 填 Worker 的域名根地址，不要追加 `/v1`；Claude Code 会请求 `/v1/messages`。当前公开模型别名为 `moa-opus`、`moa-sonnet` 和 `moa-haiku`，服务端会将它们映射到受控的 Workers AI 模型 `@cf/openai/gpt-oss-120b`。

当前 Messages API 支持文本消息、对话历史和协议级 SSE 流式输出；图片、文件、服务端工具和真实 token 级 streaming 仍未实现。

## 生产环境 smoke test

将 `WORKER_URL` 和 `TOKEN` 替换为你的实际值：

```bash
WORKER_URL="https://moe-cloudflare-worker.arthur-162.workers.dev"
TOKEN="<your-moa-auth-token>"

# 健康检查
curl -s $WORKER_URL/health

# MCP initialize
curl -s $WORKER_URL/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# MCP tools/list
curl -s $WORKER_URL/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# MCP tools/call（真实 Workers AI MoA）
curl -s --max-time 120 $WORKER_URL/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"moa_reason","arguments":{"task":"解释 Cloudflare Worker 是什么","language":"zh-CN","include_trace":true}}}'

# Anthropic Messages API

curl -s --max-time 120 $WORKER_URL/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"moa-opus","max_tokens":256,"messages":[{"role":"user","content":"What is 2+2?"}]}'
```

## Cloudflare 配置

`wrangler.jsonc` 已声明：

```jsonc
{
  "ai": { "binding": "AI", "remote": true }
}
```

本地 `wrangler dev` 使用 `.dev.vars` 中的 `MOA_AUTH_TOKEN`。`.dev.vars.example` 只是模板，不会自动成为本地 secret；请复制后填写真实的本地测试 token：

```bash
cp .dev.vars.example .dev.vars
# 将 replace-with-a-long-random-token 替换为本地测试 token
```

生产环境的鉴权 token 应通过 Cloudflare Secret 配置，不要写入 `wrangler.jsonc` 或源码：

```bash
npx wrangler secret put MOA_AUTH_TOKEN
npm run deploy
```

Workers AI 真实调用会根据 `env.AI` 是否存在选择；没有 binding 时使用 mock，有 binding 时执行受限的两层 MoA。部署前应确认当前账户计划、`WORKERS_AI_REGION`、模型可用性和预算限制。
