import type { IntermediateLayerResult, MoaReasonInput, MoaReasonOutput } from "../contracts";
import type { RuntimeConfig } from "../config";
import type { Env } from "../env";
import { WorkersAIAdapter } from "../workers-ai/adapter";
import { runMoaReason } from "../moa/orchestrator";

export function createRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

function languageFor(input: MoaReasonInput): "auto" | "zh-CN" | "en-US" {
  return input.language ?? "auto";
}

export function runMockMoaReason(
  input: MoaReasonInput,
  config: RuntimeConfig,
  requestId = createRequestId(),
): MoaReasonOutput {
  const language = languageFor(input);
  const mode = input.mode ?? config.defaultProfile;
  const output = language === "en-US"
    ? `Mock MoA answer for: ${input.task}`
    : `Mock MoA 回答：${input.task}`;
  const proposerOutput = language === "en-US"
    ? `Mock proposer considered the task: ${input.task}`
    : `Mock proposer 已分析任务：${input.task}`;
  const aggregationInput = language === "en-US"
    ? `Candidate response: ${proposerOutput}`
    : `候选结果：${proposerOutput}`;

  const intermediateResults: IntermediateLayerResult[] = [
    {
      layer: 1,
      agents: [{
        agent_id: "layer-1-agent-1",
        role: "proposer",
        model: "mock",
        status: "succeeded",
        output: proposerOutput,
        duration_ms: 0,
      }],
      aggregation_input: { type: "candidate_summary", content: aggregationInput },
      aggregation_output: null,
    },
    {
      layer: 2,
      agents: [{
        agent_id: "layer-2-aggregator-1",
        role: "aggregator",
        model: "mock",
        status: "succeeded",
        output,
        duration_ms: 0,
      }],
      aggregation_input: { type: "candidate_summary", content: aggregationInput },
      aggregation_output: output,
    },
  ];

  return {
    request_id: requestId,
    answer: output,
    intermediate_results: intermediateResults,
    trace: input.include_trace === false ? undefined : {
      total_duration_ms: 0,
      degraded: false,
      mode,
      language,
    },
  };
}

export async function runRealMoaReason(
  input: MoaReasonInput,
  config: RuntimeConfig,
  env: Env,
  requestId = createRequestId(),
): Promise<MoaReasonOutput> {
  if (!env.AI) throw new Error("Workers AI binding is unavailable");
  return runMoaReason(input, config, new WorkersAIAdapter(env.AI, config.maxRetries), requestId);
}

export async function runConfiguredMoaReason(
  input: MoaReasonInput,
  config: RuntimeConfig,
  env: Env,
  requestId = createRequestId(),
): Promise<MoaReasonOutput> {
  return env.AI
    ? runRealMoaReason(input, config, env, requestId)
    : runMockMoaReason(input, config, requestId);
}
