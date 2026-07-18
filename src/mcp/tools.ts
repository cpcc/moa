export const MOA_REASON_TOOL = {
  name: "moa_reason",
  description:
    "Use Cloudflare Workers AI MoA agents to analyze a complex task and return a final answer with intermediate agent results.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description: "需要多 Agent 分析并回答的任务。",
      },
      language: {
        type: "string",
        enum: ["auto", "zh-CN", "en-US"],
        description: "输出语言；默认 auto，支持中文、英文和中英混合任务。",
      },
      mode: {
        type: "string",
        enum: ["quality", "balanced", "fast"],
        description: "服务端允许的质量/成本 profile。",
      },
      layer_count: {
        type: "integer",
        description: "请求层数；服务端会执行最大值限制。",
      },
      proposer_count: {
        type: "integer",
        description: "每层 proposer 数量；服务端会执行最大值限制。",
      },
      include_trace: {
        type: "boolean",
        description: "是否返回执行元数据；中间 Agent 结果始终返回。",
      },
    },
  },
} as const;

export function listToolsResult() {
  return { tools: [MOA_REASON_TOOL] };
}
