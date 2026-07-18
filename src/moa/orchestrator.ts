import type { Language, RuntimeConfig } from "../config";
import {
  MoaExecutionError,
  type IntermediateAgentResult,
  type IntermediateLayerResult,
  type MoaReasonInput,
  type MoaReasonOutput,
  type TextRunner,
} from "../contracts";
import { CallBudget } from "../limits/budget";
import { Semaphore } from "../limits/concurrency";
import { createDeadline } from "../limits/timeout";
import { getExecutionPlan, proposerModelFor } from "./profiles";
import { buildAggregatorPrompt, buildProposerPrompt } from "./prompts";
import { failedAgent, truncateOutput } from "./results";

function languageFor(input: MoaReasonInput): Language {
  return input.language ?? "auto";
}

function modeFor(input: MoaReasonInput, config: RuntimeConfig) {
  return input.mode ?? config.defaultProfile;
}

export async function runMoaReason(
  input: MoaReasonInput,
  config: RuntimeConfig,
  runner: TextRunner,
  requestId: string,
): Promise<MoaReasonOutput> {
  const started = Date.now();
  const language = languageFor(input);
  const mode = modeFor(input, config);
  const plan = getExecutionPlan(input, config);
  const deadline = createDeadline(config.requestTimeoutMs);
  const budget = new CallBudget(config.maxAiCalls);
  const semaphore = new Semaphore(config.maxConcurrentAgents);
  const proposerAgents: IntermediateAgentResult[] = [];
  const candidateOutputs: string[] = [];

  const proposerResults = await Promise.all(
    Array.from({ length: plan.proposerCount }, (_, offset) => {
      const index = offset + 1;
      const agentId = `layer-1-agent-${index}`;
      const proposerModel = proposerModelFor(plan, index);
      return semaphore.use(async () => {
        const callStarted = Date.now();
        if (deadline.expired() || !budget.reserve()) {
          return { index, result: failedAgent(agentId, "proposer", proposerModel, Date.now() - callStarted, new MoaExecutionError("BUDGET_EXCEEDED", requestId, "AI call budget exceeded")) };
        }
        try {
          const result = await runner.runText({
            model: proposerModel,
            prompt: buildProposerPrompt(input.task, language, index),
            requestId,
            deadline: deadline.at,
            reserveCall: () => budget.reserve(),
          });
          const bounded = truncateOutput(result.text, config.maxOutputChars);
          candidateOutputs.push(bounded.value);
          return {
            index,
            result: {
              agent_id: agentId,
              role: "proposer" as const,
              model: result.model,
              status: "succeeded" as const,
              output: bounded.value,
              duration_ms: result.duration_ms,
              truncated: bounded.truncated || undefined,
            },
          };
        } catch (error) {
          return { index, result: failedAgent(agentId, "proposer", proposerModel, Date.now() - callStarted, error) };
        }
      });
    }),
  );

  proposerResults.sort((left, right) => left.index - right.index);
  proposerAgents.push(...proposerResults.map(({ result }) => result));
  const successful = proposerAgents.filter((agent) => agent.status === "succeeded");
  if (successful.length < config.minSuccessfulProposers) {
    throw new MoaExecutionError("ALL_AGENTS_FAILED", requestId, "All proposer agents failed");
  }

  const candidates = successful.map((agent, index) => `Candidate ${index + 1}:\n${agent.output}`).join("\n\n");
  const boundedCandidates = truncateOutput(candidates, Math.min(config.maxTotalResponseChars, config.maxOutputChars * plan.proposerCount));
  const layerOne: IntermediateLayerResult = {
    layer: 1,
    agents: proposerAgents,
    aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
    aggregation_output: null,
  };

  if (deadline.expired() || !budget.reserve()) {
    throw new MoaExecutionError("BUDGET_EXCEEDED", requestId, "AI call budget exceeded");
  }
  const aggregatorId = "layer-2-aggregator-1";
  const aggregatorStarted = Date.now();
  let aggregateResult: IntermediateAgentResult;
  try {
    const result = await runner.runText({
      model: plan.aggregatorModel,
      prompt: buildAggregatorPrompt(input.task, language, boundedCandidates.value),
      requestId,
      deadline: deadline.at,
      reserveCall: () => budget.reserve(),
    });
    const bounded = truncateOutput(result.text, config.maxOutputChars);
    aggregateResult = {
      agent_id: aggregatorId,
      role: "aggregator",
      model: result.model,
      status: "succeeded",
      output: bounded.value,
      duration_ms: result.duration_ms,
      truncated: bounded.truncated || undefined,
    };
    const layerTwo: IntermediateLayerResult = {
      layer: 2,
      agents: [aggregateResult],
      aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
      aggregation_output: bounded.value,
    };
    return {
      request_id: requestId,
      answer: bounded.value,
      intermediate_results: [layerOne, layerTwo],
      trace: input.include_trace === false ? undefined : {
        total_duration_ms: Date.now() - started,
        degraded: plan.degraded || proposerAgents.some((agent) => agent.status === "failed") || boundedCandidates.truncated || Boolean(bounded.truncated),
        mode,
        language,
        call_count: budget.count,
      },
    };
  } catch (error) {
    aggregateResult = failedAgent(aggregatorId, "aggregator", plan.aggregatorModel, Date.now() - aggregatorStarted, error);
    // 降级：aggregator 失败但已有成功 proposer 时，返回最佳候选答案而非直接 500
    // 能到这里说明 successful.length >= minSuccessfulProposers >= 1，降级一定可用
    if (successful.length > 0) {
      const bestCandidate = truncateOutput(successful[0].output, config.maxOutputChars);
      const layerTwo: IntermediateLayerResult = {
        layer: 2,
        agents: [aggregateResult],
        aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
        aggregation_output: bestCandidate.value,
      };
      return {
        request_id: requestId,
        answer: bestCandidate.value,
        intermediate_results: [layerOne, layerTwo],
        trace: input.include_trace === false ? undefined : {
          total_duration_ms: Date.now() - started,
          degraded: true,
          mode,
          language,
          call_count: budget.count,
        },
      };
    }
    throw new MoaExecutionError(
      error instanceof MoaExecutionError ? error.code : "INTERNAL_ERROR",
      requestId,
      error instanceof Error ? error.message : "Aggregator failed",
      error instanceof MoaExecutionError ? error.retryable : false,
    );
  }
}
