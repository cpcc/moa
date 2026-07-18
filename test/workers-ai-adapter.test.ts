import { describe, expect, it } from "vitest";
import type { Ai } from "../src/env";
import { WorkersAIAdapter, ModelExecutionError } from "../src/workers-ai/adapter";
import { AGGREGATOR_MODEL, PROPOSER_MODELS, isAllowedModel } from "../src/workers-ai/models";

describe("Workers AI adapter", () => {
  it("passes the request model (not a hardcoded one) to env.AI.run", async () => {
    // 多模型支持：adapter 必须用 request.model 调用 ai.run，而不是硬编码 MODEL_ID
    let received: { model: string; input: unknown; signal?: AbortSignal } | undefined;
    const ai: Ai = {
      async run<T = unknown>(model: string, input: unknown, options?: { signal?: AbortSignal }) {
        received = { model, input, signal: options?.signal };
        return { output_text: "ok" } as T;
      },
    };
    const proposerModel = PROPOSER_MODELS[0];
    const result = await new WorkersAIAdapter(ai, 0).runText({
      model: proposerModel,
      prompt: "prompt",
      requestId: "req_test",
      deadline: Date.now() + 1_000,
    });
    expect(result.text).toBe("ok");
    expect(received?.model).toBe(proposerModel);
    expect(received?.model).not.toBe(AGGREGATOR_MODEL);
    expect(result.model).toBe(proposerModel);
    expect(received?.input).toEqual({ messages: [{ role: "user", content: "prompt" }] });
    expect(received?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries transient failures but not permanent failures", async () => {
    let attempts = 0;
    const transient: Ai = {
      async run<T = unknown>() {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("busy"), { status: 503 });
        return { response: "ok" } as T;
      },
    };
    await expect(new WorkersAIAdapter(transient, 1).runText({
      model: PROPOSER_MODELS[0], prompt: "p", requestId: "r", deadline: Date.now() + 2_000,
    })).resolves.toMatchObject({ text: "ok" });
    expect(attempts).toBe(2);

    let permanentAttempts = 0;
    const permanent: Ai = { async run<T = unknown>() { permanentAttempts += 1; throw Object.assign(new Error("bad"), { status: 400 }); } };
    await expect(new WorkersAIAdapter(permanent, 2).runText({
      model: PROPOSER_MODELS[0], prompt: "p", requestId: "r", deadline: Date.now() + 2_000,
    })).rejects.toBeInstanceOf(ModelExecutionError);
    expect(permanentAttempts).toBe(1);
  });

  it("allows all configured aggregator + proposer models", async () => {
    // 白名单应包含 aggregator 和所有 proposer
    expect(isAllowedModel(AGGREGATOR_MODEL)).toBe(true);
    for (const model of PROPOSER_MODELS) {
      expect(isAllowedModel(model)).toBe(true);
    }
    expect(isAllowedModel("@cf/unapproved/some-model")).toBe(false);
  });

  it("rejects a model not in the allowlist", async () => {
    const ai: Ai = { async run<T = unknown>() { return {} as T; } };
    await expect(new WorkersAIAdapter(ai, 0).runText({
      model: "@cf/unapproved/some-model", prompt: "p", requestId: "r", deadline: Date.now() + 1_000,
    })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});
