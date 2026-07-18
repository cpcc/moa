import type { RuntimeConfig } from "../config";
import { AGGREGATOR_MODEL, PROPOSER_MODELS } from "../workers-ai/models";
import type { ModelSelection } from "./model-selection";

export interface ExecutionPlan {
  layers: 2;
  proposerCount: number;
  /** 每个 proposer 对应的模型（按顺序），长度 >= proposerCount */
  proposerModels: readonly string[];
  aggregatorModel: string;
  degraded: boolean;
}

/** 按 index 取 proposer 模型，超过数组长度时循环复用 */
export function proposerModelFor(plan: ExecutionPlan, index: number): string {
  return plan.proposerModels[(index - 1) % plan.proposerModels.length];
}

/**
 * 构造两层 MoA 执行计划。
 *
 * @param input 请求侧参数（层数、proposer 数量）
 * @param config 运行时配置（上限）
 * @param selection 可选的模型组合覆盖（来自 URL / MCP / 配置页）；undefined 时用默认组合
 */
export function getExecutionPlan(
  input: { layer_count?: number; proposer_count?: number },
  config: RuntimeConfig,
  selection?: ModelSelection,
): ExecutionPlan {
  const requestedLayers = input.layer_count ?? 2;
  const baseProposers = selection?.proposers ?? PROPOSER_MODELS;
  const requestedProposers = input.proposer_count ?? baseProposers.length;
  const proposerCount = Math.min(requestedProposers, config.maxProposers, baseProposers.length);
  const proposerModels =
    baseProposers.length > proposerCount ? baseProposers.slice(0, proposerCount) : baseProposers;
  const aggregatorModel = selection?.aggregator ?? AGGREGATOR_MODEL;
  return {
    layers: 2,
    proposerCount,
    proposerModels,
    aggregatorModel,
    degraded:
      requestedLayers !== 2 ||
      requestedProposers !== proposerCount ||
      config.maxLayers < 2 ||
      baseProposers.length > proposerCount,
  };
}
