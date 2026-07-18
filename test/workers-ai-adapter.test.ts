import { describe, expect, it } from "vitest";
import type { Ai } from "../src/env";
import { WorkersAIAdapter, ModelExecutionError } from "../src/workers-ai/adapter";
import { MODEL_ID } from "../src/workers-ai/models";

describe("Workers AI adapter", () => {
  it("passes the server model, input, and abort signal", async () => {
    let received: { model: string; input: unknown; signal?: AbortSignal } | undefined;
    const ai: Ai = {
      async run<T = unknown>(model: string, input: unknown, options?: { signal?: AbortSignal }) {
        received = { model, input, signal: options?.signal };
        return { output_text: "ok" } as T;
      },
    };
    const result = await new WorkersAIAdapter(ai, 0).runText({
      model: MODEL_ID,
      prompt: "prompt",
      requestId: "req_test",
      deadline: Date.now() + 1_000,
    });
    expect(result.text).toBe("ok");
    expect(received?.model).toBe(MODEL_ID);
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
      model: MODEL_ID, prompt: "p", requestId: "r", deadline: Date.now() + 2_000,
    })).resolves.toMatchObject({ text: "ok" });
    expect(attempts).toBe(2);

    let permanentAttempts = 0;
    const permanent: Ai = { async run<T = unknown>() { permanentAttempts += 1; throw Object.assign(new Error("bad"), { status: 400 }); } };
    await expect(new WorkersAIAdapter(permanent, 2).runText({
      model: MODEL_ID, prompt: "p", requestId: "r", deadline: Date.now() + 2_000,
    })).rejects.toBeInstanceOf(ModelExecutionError);
    expect(permanentAttempts).toBe(1);
  });
});
