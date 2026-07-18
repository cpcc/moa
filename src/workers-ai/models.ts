// Workers AI 模型配置
// Aggregator 用 gpt-oss-120b（高质量聚合），Proposer 用 3 个不同模型提供多样化视角。

/** Aggregator 使用的模型（第二层聚合） */
export const AGGREGATOR_MODEL = "@cf/openai/gpt-oss-120b" as const;

/** Proposer 模型数组（第一层并行，每个模型提供不同视角的候选答案） */
export const PROPOSER_MODELS = [
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
] as const;

/** 所有允许使用的 Workers AI 模型（aggregator + proposers） */
const ALLOWED_MODELS: ReadonlySet<string> = new Set<string>([AGGREGATOR_MODEL, ...PROPOSER_MODELS]);

/** 保留旧导出兼容（adapter 在 request.model 传入时使用） */
export const MODEL_ID = AGGREGATOR_MODEL;

export type AllowedModel = string;

export function isAllowedModel(value: string): value is AllowedModel {
  return ALLOWED_MODELS.has(value);
}
