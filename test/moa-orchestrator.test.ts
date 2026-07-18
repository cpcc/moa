import { describe, expect, it } from "vitest";
import type { MoaReasonInput, TextRunner, TextRunnerRequest, TextRunnerResult } from "../src/contracts";
import { runMoaReason } from "../src/moa/orchestrator";
import { getRuntimeConfig } from "../src/config";

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
});
