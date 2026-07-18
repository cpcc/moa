// Workers AI 模型配置
//
// 白名单已扩展到全部 Workers AI binding 支持的文本生成模型。
// 用户可通过 URL / MCP / 配置页自由组合 proposer + aggregator（见 `src/moa/model-selection.ts`）。
//
// 短名（如 `kimi-k2.7-code`）通过 MODEL_ALIASES 映射到完整 binding ID（`@cf/moonshotai/kimi-k2.7-code`）。

/** Aggregator 默认模型（第二层聚合）。 */
export const DEFAULT_AGGREGATOR = "@cf/openai/gpt-oss-120b" as const;

/** Proposer 默认模型数组（第一层并行）。 */
export const DEFAULT_PROPOSERS = [
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
] as const;

// 向后兼容旧导出（adapter / anthropic.models 仍引用）
export const AGGREGATOR_MODEL = DEFAULT_AGGREGATOR;
export const PROPOSER_MODELS = DEFAULT_PROPOSERS;

/**
 * 全部允许使用的 Workers AI 文本生成模型。
 * 既包含默认组合，也包含用户可在 URL / MCP 里自由选用的前沿模型。
 */
const ALLOWED_MODELS: ReadonlySet<string> = new Set<string>([
  // 默认组合
  DEFAULT_AGGREGATOR,
  ...DEFAULT_PROPOSERS,
  // 前沿 reasoning / agentic 模型
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/moonshotai/kimi-k2.5",
  "@cf/zai-org/glm-5.2",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
]);

/**
 * 短名 → 完整 binding ID 映射。
 * 用户在 URL / MCP 里用短名（如 `kimi-k2.7-code`），内部解析为 binding ID。
 * 完整 binding ID 本身也合法（resolveModelAlias 透传）。
 */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  // 默认组合
  "gpt-oss-120b": "@cf/openai/gpt-oss-120b",
  "qwen2.5-coder-32b": "@cf/qwen/qwen2.5-coder-32b-instruct",
  "glm-4.7-flash": "@cf/zai-org/glm-4.7-flash",
  "mistral-small-3.1-24b": "@cf/mistralai/mistral-small-3.1-24b-instruct",
  // 前沿模型
  "kimi-k2.7-code": "@cf/moonshotai/kimi-k2.7-code",
  "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
  "kimi-k2.5": "@cf/moonshotai/kimi-k2.5",
  "glm-5.2": "@cf/zai-org/glm-5.2",
  "nemotron-3-120b-a12b": "@cf/nvidia/nemotron-3-120b-a12b",
  "gemma-4-26b-a4b-it": "@cf/google/gemma-4-26b-a4b-it",
  "qwen3-30b-a3b": "@cf/qwen/qwen3-30b-a3b-fp8",
  "gpt-oss-20b": "@cf/openai/gpt-oss-20b",
  "llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "llama-4-scout-17b": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "deepseek-r1-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
};

/** 保留旧导出兼容（adapter 在 request.model 传入时使用） */
export const MODEL_ID = DEFAULT_AGGREGATOR;

export type AllowedModel = string;

/** 判断一个值是否在白名单内（接受完整 binding ID）。 */
export function isAllowedModel(value: string): value is AllowedModel {
  return ALLOWED_MODELS.has(value);
}

/**
 * 把短名或完整 binding ID 解析为白名单内的 binding ID。
 * - 短名（如 `kimi-k2.7-code`）→ 查 MODEL_ALIASES
 * - 完整 binding ID（以 `@cf/` 或 `@hf/` 开头）→ 透传后用 isAllowedModel 校验
 * 返回 undefined 表示无法识别。
 */
export function resolveModelAlias(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  // 先查短名表
  const aliased = MODEL_ALIASES[trimmed];
  if (aliased && isAllowedModel(aliased)) return aliased;
  // 再当完整 binding ID 校验
  if (isAllowedModel(trimmed)) return trimmed;
  return undefined;
}

/** 模型元信息（供配置页渲染）。 */
export interface ModelMeta {
  shortName: string;
  bindingId: string;
  contextWindow: number | null;
  reasoning: boolean;
  functionCalling: boolean;
  vision: boolean;
  priceInPerM: number | null;
  priceOutPerM: number | null;
  tags: readonly string[];
}

/** 全部可选模型元信息（供配置页 / /v1/models 扩展使用）。 */
export const MODEL_CATALOG: readonly ModelMeta[] = [
  { shortName: "kimi-k2.7-code", bindingId: "@cf/moonshotai/kimi-k2.7-code", contextWindow: 262144, reasoning: true, functionCalling: true, vision: true, priceInPerM: 0.95, priceOutPerM: 4.0, tags: ["reasoning", "agentic", "vision", "code"] },
  { shortName: "glm-5.2", bindingId: "@cf/zai-org/glm-5.2", contextWindow: 262144, reasoning: true, functionCalling: true, vision: false, priceInPerM: 1.4, priceOutPerM: 4.4, tags: ["reasoning", "agentic", "code"] },
  { shortName: "kimi-k2.6", bindingId: "@cf/moonshotai/kimi-k2.6", contextWindow: 262144, reasoning: true, functionCalling: true, vision: true, priceInPerM: 0.95, priceOutPerM: 4.0, tags: ["reasoning", "agentic", "vision"] },
  { shortName: "nemotron-3-120b-a12b", bindingId: "@cf/nvidia/nemotron-3-120b-a12b", contextWindow: 256000, reasoning: true, functionCalling: true, vision: false, priceInPerM: 0.5, priceOutPerM: 1.5, tags: ["reasoning", "agentic", "120B"] },
  { shortName: "gemma-4-26b-a4b-it", bindingId: "@cf/google/gemma-4-26b-a4b-it", contextWindow: 256000, reasoning: true, functionCalling: true, vision: true, priceInPerM: 0.1, priceOutPerM: 0.3, tags: ["reasoning", "vision", "cheap"] },
  { shortName: "qwen3-30b-a3b", bindingId: "@cf/qwen/qwen3-30b-a3b-fp8", contextWindow: null, reasoning: true, functionCalling: true, vision: false, priceInPerM: null, priceOutPerM: null, tags: ["reasoning"] },
  { shortName: "gpt-oss-120b", bindingId: "@cf/openai/gpt-oss-120b", contextWindow: null, reasoning: true, functionCalling: true, vision: false, priceInPerM: 0.35, priceOutPerM: 0.75, tags: ["reasoning", "aggregator-default", "cheap"] },
  { shortName: "gpt-oss-20b", bindingId: "@cf/openai/gpt-oss-20b", contextWindow: null, reasoning: true, functionCalling: true, vision: false, priceInPerM: null, priceOutPerM: null, tags: ["reasoning", "fast"] },
  { shortName: "llama-3.3-70b", bindingId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", contextWindow: null, reasoning: false, functionCalling: false, vision: false, priceInPerM: null, priceOutPerM: null, tags: ["70B"] },
  { shortName: "glm-4.7-flash", bindingId: "@cf/zai-org/glm-4.7-flash", contextWindow: 131072, reasoning: true, functionCalling: true, vision: false, priceInPerM: null, priceOutPerM: null, tags: ["reasoning", "flash"] },
  { shortName: "qwen2.5-coder-32b", bindingId: "@cf/qwen/qwen2.5-coder-32b-instruct", contextWindow: null, reasoning: false, functionCalling: false, vision: false, priceInPerM: null, priceOutPerM: null, tags: ["code"] },
  { shortName: "mistral-small-3.1-24b", bindingId: "@cf/mistralai/mistral-small-3.1-24b-instruct", contextWindow: null, reasoning: false, functionCalling: false, vision: false, priceInPerM: null, priceOutPerM: null, tags: [] },
];

/** 预设方案（配置页一键填入）。 */
export const MODEL_PRESETS: Readonly<Record<string, { label: string; models: string; description: string }>> = {
  A: { label: "A 最强前沿", models: "kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/kimi-k2.6", description: "3 前沿 proposer + 1T aggregator，成本最高" },
  B: { label: "B 强 proposer + 省 aggregator", models: "kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/gpt-oss-120b", description: "proposer 全前沿，aggregator 保留最便宜" },
  C: { label: "C 均衡（对标目标.md）", models: "kimi-k2.6/qwen3-30b-a3b/glm-5.2/gpt-oss-120b", description: "对标 DeepSeek + Kimi + Qwen 的 Fusion 组合" },
};
