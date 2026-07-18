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
import type { ModelSelection } from "./model-selection";
import { getExecutionPlan, proposerModelFor } from "./profiles";
import { buildAggregatorPrompt, buildJudgePrompt, buildProposerPrompt } from "./prompts";
import { failedAgent, truncateOutput } from "./results";
import { formatSearchContext, searchForTask } from "./search";

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
  selection?: ModelSelection,
): Promise<MoaReasonOutput> {
  const started = Date.now();
  const language = languageFor(input);
  const mode = modeFor(input, config);
  const plan = getExecutionPlan(input, config, selection);
  const deadline = createDeadline(config.requestTimeoutMs);
  const budget = new CallBudget(config.maxAiCalls);
  const semaphore = new Semaphore(config.maxConcurrentAgents);
  const proposerAgents: IntermediateAgentResult[] = [];
  const candidateOutputs: string[] = [];

  // Layer 0 (optional): 联网检索——为 DRACO 等深度研究任务提供证据上下文
  // best-effort：失败 / 未配置时返回空，不阻断 MoA 流程
  let searchContext = "";
  let searchUsed = false;
  if (config.search.enabled) {
    try {
      const searchResults = await searchForTask(input.task, config.search, deadline.at);
      searchContext = formatSearchContext(searchResults);
      searchUsed = searchContext !== "";
    } catch {
      // 检索失败不阻断主流程
      searchContext = "";
    }
  }

  // Layer 1: proposers 并行
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
            prompt: buildProposerPrompt(input.task, language, index, searchContext || undefined),
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

  // Layer 2 (optional): judge 冲突分析——产出共识/冲突/遗漏/证据不足清单
  let analysis: string | undefined;
  let judgeLayer: IntermediateLayerResult | undefined;
  let judgeFailed = false;
  if (plan.judgeModel) {
    const judgeId = "layer-2-judge-1";
    const judgeStarted = Date.now();
    if (deadline.expired() || !budget.reserve()) {
      // 预算耗尽：跳过 judge，降级为无 analysis 的 aggregator
      judgeFailed = true;
      judgeLayer = {
        layer: 2,
        agents: [failedAgent(judgeId, "judge", plan.judgeModel, 0, new MoaExecutionError("BUDGET_EXCEEDED", requestId, "AI call budget exceeded"))],
        aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
        aggregation_output: null,
      };
    } else {
      try {
        const judgeResult = await runner.runText({
          model: plan.judgeModel,
          prompt: buildJudgePrompt(input.task, language, boundedCandidates.value),
          requestId,
          deadline: deadline.at,
          reserveCall: () => budget.reserve(),
        });
        const boundedAnalysis = truncateOutput(judgeResult.text, config.maxOutputChars);
        analysis = boundedAnalysis.value;
        judgeLayer = {
          layer: 2,
          agents: [{
            agent_id: judgeId,
            role: "judge" as const,
            model: judgeResult.model,
            status: "succeeded" as const,
            output: boundedAnalysis.value,
            duration_ms: judgeResult.duration_ms,
            truncated: boundedAnalysis.truncated || undefined,
          }],
          aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
          aggregation_output: boundedAnalysis.value,
        };
      } catch (error) {
        // judge 失败不阻断：aggregator 仍跑，只是没有 analysis
        judgeFailed = true;
        judgeLayer = {
          layer: 2,
          agents: [failedAgent(judgeId, "judge", plan.judgeModel, Date.now() - judgeStarted, error)],
          aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
          aggregation_output: null,
        };
      }
    }
  }

  // Layer 3 (or 2 if no judge): aggregator (synthesizer) 综合最终答案
  const aggregatorLayerNum = plan.judgeModel ? 3 : 2;
  const aggregatorId = plan.judgeModel ? "layer-3-aggregator-1" : "layer-2-aggregator-1";
  if (deadline.expired() || !budget.reserve()) {
    throw new MoaExecutionError("BUDGET_EXCEEDED", requestId, "AI call budget exceeded");
  }
  const aggregatorStarted = Date.now();
  let aggregateResult: IntermediateAgentResult;
  try {
    const result = await runner.runText({
      model: plan.aggregatorModel,
      prompt: buildAggregatorPrompt(input.task, language, boundedCandidates.value, analysis),
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
    const finalLayer: IntermediateLayerResult = {
      layer: aggregatorLayerNum,
      agents: [aggregateResult],
      aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
      aggregation_output: bounded.value,
    };
    const intermediateResults: IntermediateLayerResult[] = judgeLayer
      ? [layerOne, judgeLayer, finalLayer]
      : [layerOne, finalLayer];
    return {
      request_id: requestId,
      answer: bounded.value,
      intermediate_results: intermediateResults,
      trace: input.include_trace === false ? undefined : {
        total_duration_ms: Date.now() - started,
        degraded: plan.degraded || judgeFailed || proposerAgents.some((agent) => agent.status === "failed") || boundedCandidates.truncated || Boolean(bounded.truncated),
        mode,
        language,
        call_count: budget.count,
        search_used: searchUsed,
      },
    };
  } catch (error) {
    aggregateResult = failedAgent(aggregatorId, "aggregator", plan.aggregatorModel, Date.now() - aggregatorStarted, error);
    // 降级：aggregator 失败但已有成功 proposer 时，返回最佳候选答案而非直接 500
    // 能到这里说明 successful.length >= minSuccessfulProposers >= 1，降级一定可用
    if (successful.length > 0) {
      const bestCandidate = truncateOutput(successful[0].output, config.maxOutputChars);
      const finalLayer: IntermediateLayerResult = {
        layer: aggregatorLayerNum,
        agents: [aggregateResult],
        aggregation_input: { type: "candidate_summary", content: boundedCandidates.value },
        aggregation_output: bestCandidate.value,
      };
      const intermediateResults: IntermediateLayerResult[] = judgeLayer
        ? [layerOne, judgeLayer, finalLayer]
        : [layerOne, finalLayer];
      return {
        request_id: requestId,
        answer: bestCandidate.value,
        intermediate_results: intermediateResults,
        trace: input.include_trace === false ? undefined : {
          total_duration_ms: Date.now() - started,
          degraded: true,
          mode,
          language,
          call_count: budget.count,
          search_used: searchUsed,
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
