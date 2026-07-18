import type { RuntimeConfig } from "../config";
import { AGGREGATOR_MODEL, PROPOSER_MODELS } from "../workers-ai/models";

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

export function getExecutionPlan(input: { layer_count?: number; proposer_count?: number }, config: RuntimeConfig): ExecutionPlan {
  const requestedLayers = input.layer_count ?? 2;
  const requestedProposers = input.proposer_count ?? PROPOSER_MODELS.length;
  const proposerCount = Math.min(requestedProposers, config.maxProposers);
  return {
    layers: 2,
    proposerCount,
    proposerModels: PROPOSER_MODELS,
    aggregatorModel: AGGREGATOR_MODEL,
    degraded: requestedLayers !== 2 || requestedProposers !== proposerCount || config.maxLayers < 2,
  };
}
