import { describe, expect, it } from "vitest";
import type { MoaReasonInput, TextRunner, TextRunnerRequest, TextRunnerResult } from "../src/contracts";
import { runMoaReason } from "../src/moa/orchestrator";
import type { ModelSelection } from "../src/moa/model-selection";
import { getRuntimeConfig } from "../src/config";
import { AGGREGATOR_MODEL, PROPOSER_MODELS } from "../src/workers-ai/models";

function config() {
  return getRuntimeConfig({
    MOA_MAX_AI_CALLS: "4",
    MOA_MAX_CONCURRENT_AGENTS: "3",
    MOA_MAX_PROPOSERS: "3",
    MOA_REQUEST_TIMEOUT_MS: "2000",
  });
}

function runner(callback: (request: TextRunnerRequest) => Promise<TextRunnerResult>): TextRunner {
  return { runText: callback };
}

describe("two-layer MoA orchestrator", () => {
  it("runs proposers concurrently and aggregates successful candidates", async () => {
    let active = 0;
    let maxActive = 0;
    const requests: TextRunnerRequest[] = [];
    const fake = runner(async (request) => {
      requests.push(request);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { model: request.model, text: request.prompt.includes("final aggregator") ? "synthesized" : `candidate-${requests.length}`, duration_ms: 5 };
    });
    const input: MoaReasonInput = { task: "Explain tests", language: "en-US" };
    const output = await runMoaReason(input, config(), fake, "req_orchestrator");
    expect(maxActive).toBe(3);
    expect(requests).toHaveLength(4);
    expect(output.answer).toBe("synthesized");
    expect(output.intermediate_results).toHaveLength(2);
    expect(output.intermediate_results[0].agents).toHaveLength(3);
    expect(requests[3]?.prompt).toContain("Candidate 1");
    // 多模型支持：3 个 proposer 应收到 3 个不同的模型，aggregator 收到 AGGREGATOR_MODEL
    const proposerModels = requests.slice(0, 3).map((r) => r.model);
    expect(new Set(proposerModels).size).toBe(3);
    expect(proposerModels).toEqual([...PROPOSER_MODELS]);
    expect(requests[3]?.model).toBe(AGGREGATOR_MODEL);
    // intermediate_results 里记录的 model 也应是真实模型名
    expect(output.intermediate_results[0]?.agents.map((a) => a.model)).toEqual([...PROPOSER_MODELS]);
    expect(output.intermediate_results[1]?.agents[0]?.model).toBe(AGGREGATOR_MODEL);
  });

  it("continues after one proposer failure", async () => {
    let count = 0;
    const fake = runner(async (request) => {
      count += 1;
      if (count === 1) throw new Error("failed proposer");
      return { model: request.model, text: request.prompt.includes("final aggregator") ? "answer" : "candidate", duration_ms: 0 };
    });
    const output = await runMoaReason({ task: "task", language: "en-US" }, config(), fake, "req_partial");
    expect(output.answer).toBe("answer");
    expect(output.intermediate_results[0]?.agents.some((agent) => agent.status === "failed")).toBe(true);
    expect(output.trace?.degraded).toBe(true);
  });

  it("does not call aggregator when all proposers fail", async () => {
    let calls = 0;
    const fake = runner(async () => { calls += 1; throw new Error("failed"); });
    await expect(runMoaReason({ task: "task" }, config(), fake, "req_all_failed"))
      .rejects.toMatchObject({ code: "ALL_AGENTS_FAILED", requestId: "req_all_failed" });
    expect(calls).toBe(3);
  });

  it("degrades to best candidate when aggregator fails but proposers succeeded", async () => {
    // aggregator 失败时，应降级返回第一个成功 proposer 的答案，而非抛 500
    const fake = runner(async (request) => {
      if (request.prompt.includes("final aggregator")) {
        throw new Error("aggregator boom");
      }
      return { model: request.model, text: `candidate-${request.model.split("/").pop()}`, duration_ms: 0 };
    });
    const output = await runMoaReason({ task: "task", language: "en-US" }, config(), fake, "req_agg_fail");
    // 返回的是第一个成功 proposer 的候选答案
    expect(output.answer).toContain("candidate-");
    expect(output.answer).not.toBe("answer");
    // aggregator 标记为 failed
    const agg = output.intermediate_results[1]?.agents[0];
    expect(agg?.status).toBe("failed");
    expect(agg?.role).toBe("aggregator");
    // degraded 标记为 true
    expect(output.trace?.degraded).toBe(true);
    // 所有 3 个 proposer 应该都成功
    expect(output.intermediate_results[0]?.agents.filter((a) => a.status === "succeeded")).toHaveLength(3);
  });

  it("uses custom model selection when provided", async () => {
    const requests: TextRunnerRequest[] = [];
    const fake = runner(async (request) => {
      requests.push(request);
      return { model: request.model, text: request.prompt.includes("final aggregator") ? "synth" : "cand", duration_ms: 0 };
    });
    const selection: ModelSelection = {
      proposers: ["@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2"],
      aggregator: "@cf/moonshotai/kimi-k2.6",
    };
    const output = await runMoaReason({ task: "task" }, config(), fake, "req_sel", selection);
    const proposerModels = requests.slice(0, 2).map((r) => r.model);
    expect(proposerModels).toEqual([...selection.proposers]);
    expect(requests[2]?.model).toBe(selection.aggregator);
    expect(output.intermediate_results[0]?.agents).toHaveLength(2);
    expect(output.intermediate_results[0]?.agents.map((a) => a.model)).toEqual([...selection.proposers]);
    expect(output.intermediate_results[1]?.agents[0]?.model).toBe(selection.aggregator);
  });
});

describe("three-layer MoA with judge layer", () => {
  function judgeConfig() {
    return getRuntimeConfig({
      MOA_MAX_AI_CALLS: "5",
      MOA_MAX_CONCURRENT_AGENTS: "3",
      MOA_MAX_PROPOSERS: "3",
      MOA_REQUEST_TIMEOUT_MS: "2000",
      MOA_JUDGE_ENABLED: "true",
    });
  }

  it("runs proposer→judge→aggregator when judgeEnabled", async () => {
    const requests: TextRunnerRequest[] = [];
    const fake = runner(async (request) => {
      requests.push(request);
      if (request.prompt.includes("You are the judge")) {
        return { model: request.model, text: "CONSENSUS: all agree on 391. CONFLICTS: none.", duration_ms: 0 };
      }
      if (request.prompt.includes("final aggregator")) {
        return { model: request.model, text: "final-answer", duration_ms: 0 };
      }
      return { model: request.model, text: `candidate-${request.model.split("/").pop()}`, duration_ms: 0 };
    });
    const output = await runMoaReason({ task: "task" }, judgeConfig(), fake, "req_judge");
    // 5 calls: 3 proposer + 1 judge + 1 aggregator
    expect(requests).toHaveLength(5);
    // 3 layers
    expect(output.intermediate_results).toHaveLength(3);
    expect(output.intermediate_results[0]?.layer).toBe(1);
    expect(output.intermediate_results[0]?.agents).toHaveLength(3);
    expect(output.intermediate_results[0]?.agents[0]?.role).toBe("proposer");
    // judge layer
    expect(output.intermediate_results[1]?.layer).toBe(2);
    const judge = output.intermediate_results[1]?.agents[0];
    expect(judge?.role).toBe("judge");
    expect(judge?.status).toBe("succeeded");
    // aggregator layer
    expect(output.intermediate_results[2]?.layer).toBe(3);
    expect(output.intermediate_results[2]?.agents[0]?.role).toBe("aggregator");
    expect(output.answer).toBe("final-answer");
    // aggregator prompt should carry the judge analysis
    const aggRequest = requests[4];
    expect(aggRequest?.prompt).toContain("<ANALYSIS>");
    expect(aggRequest?.prompt).toContain("CONSENSUS");
  });

  it("degrades when judge fails (aggregator still runs without analysis)", async () => {
    const requests: TextRunnerRequest[] = [];
    const fake = runner(async (request) => {
      requests.push(request);
      if (request.prompt.includes("You are the judge")) {
        throw new Error("judge boom");
      }
      if (request.prompt.includes("final aggregator")) {
        return { model: request.model, text: "answer", duration_ms: 0 };
      }
      return { model: request.model, text: "candidate", duration_ms: 0 };
    });
    const output = await runMoaReason({ task: "task" }, judgeConfig(), fake, "req_judge_fail");
    // aggregator still produced an answer
    expect(output.answer).toBe("answer");
    expect(output.intermediate_results).toHaveLength(3);
    // judge marked failed
    const judge = output.intermediate_results[1]?.agents[0];
    expect(judge?.role).toBe("judge");
    expect(judge?.status).toBe("failed");
    // aggregator succeeded
    expect(output.intermediate_results[2]?.agents[0]?.status).toBe("succeeded");
    // degraded flag set
    expect(output.trace?.degraded).toBe(true);
    // aggregator must NOT carry analysis (judge failed)
    const aggRequest = requests[4];
    expect(aggRequest?.prompt).not.toContain("<ANALYSIS>");
  });
});
