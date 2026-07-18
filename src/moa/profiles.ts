import type { RuntimeConfig } from "../config";
import { MODEL_ID } from "../workers-ai/models";

export interface ExecutionPlan {
  layers: 2;
  proposerCount: number;
  proposerModel: typeof MODEL_ID;
  aggregatorModel: typeof MODEL_ID;
  degraded: boolean;
}

export function getExecutionPlan(input: { layer_count?: number; proposer_count?: number }, config: RuntimeConfig): ExecutionPlan {
  const requestedLayers = input.layer_count ?? 2;
  const requestedProposers = input.proposer_count ?? 3;
  const proposerCount = Math.min(requestedProposers, config.maxProposers);
  return {
    layers: 2,
    proposerCount,
    proposerModel: MODEL_ID,
    aggregatorModel: MODEL_ID,
    degraded: requestedLayers !== 2 || requestedProposers !== proposerCount || config.maxLayers < 2,
  };
}
