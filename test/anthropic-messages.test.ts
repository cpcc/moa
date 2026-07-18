import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const env = { MOA_AUTH_TOKEN: "gateway-token", MOA_MAX_INPUT_CHARS: "2000" } as Env;

function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`https://example.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

const message = {
  model: "moa-opus",
  max_tokens: 256,
  messages: [{ role: "user", content: "Explain why tests matter" }],
};

describe("direct Anthropic Messages gateway", () => {
  it("requires gateway authentication and accepts x-api-key", async () => {
    expect((await request("/v1/models")).status).toBe(401);
    const response = await request("/v1/models", undefined, { "x-api-key": "gateway-token" });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: Array<{ id: string }> }).data.map((model) => model.id)).toContain("moa-opus");
  });

  it("returns an Anthropic message envelope", async () => {
    const response = await request("/v1/messages", message, { Authorization: "Bearer gateway-token" });
    expect(response.status).toBe(200);
    const body = await response.json() as { type: string; role: string; model: string; content: Array<{ type: string; text: string }>; stop_reason: string };
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.model).toBe("moa-opus");
    expect(body.content[0]?.type).toBe("text");
    expect(body.stop_reason).toBe("end_turn");
  });

  it("supports synthetic streaming", async () => {
    const response = await request("/v1/messages", { ...message, stream: true }, { Authorization: "Bearer gateway-token" });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text.indexOf("event: message_start")).toBeLessThan(text.indexOf("event: content_block_start"));
    expect(text.indexOf("event: content_block_start")).toBeLessThan(text.indexOf("event: content_block_delta"));
    expect(text).toContain("event: message_stop");
  });

  it("rejects unknown public models", async () => {
    const response = await request("/v1/messages", { ...message, model: "@cf/unapproved" }, { Authorization: "Bearer gateway-token" });
    expect(response.status).toBe(404);
    expect((await response.json() as { error: { type: string } }).error.type).toBe("not_found_error");
  });

  it("accepts system role and unknown content block types", async () => {
    const response = await request("/v1/messages", {
      ...message,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: [{ type: "thinking", text: "hmm" }, { type: "image" }] },
      ],
    }, { Authorization: "Bearer gateway-token" });
    expect(response.status).toBe(200);
    const body = await response.json() as { type: string };
    expect(body.type).toBe("message");
  });

  it("rejects oversized input with 413 and a real error message", async () => {
    // 回归测试：超大输入应返回 413 + 真实 message，而非 500 + 兜底文案 "The gateway could not complete the request"
    const oversized = "x".repeat(3000); // 超过 env.MOA_MAX_INPUT_CHARS=2000
    const response = await request("/v1/messages", {
      ...message,
      messages: [{ role: "user", content: oversized }],
    }, { Authorization: "Bearer gateway-token" });
    expect(response.status).toBe(413);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("request_too_large");
    expect(body.error.message).toBe("request exceeds maximum input size");
    expect(body.error.message).not.toBe("The gateway could not complete the request");
  });
});
