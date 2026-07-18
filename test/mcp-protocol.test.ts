import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "../src/mcp/server";
import type { Env } from "../src/env";

const env = {
  MOA_AUTH_TOKEN: "test-token",
  MOA_MAX_INPUT_CHARS: "1000",
  MOA_DEFAULT_PROFILE: "balanced",
} as Env;

async function call(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  return handleMcpRequest(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  );
}

function rpc(method: string, id: number, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("MCP protocol", () => {
  it("initializes", async () => {
    const response = await call(rpc("initialize", 1, { capabilities: {}, clientInfo: { name: "test", version: "1" } }));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { serverInfo: { name: string }; capabilities: unknown } };
    expect(body.result.serverInfo.name).toBe("moa");
    expect(body.result.capabilities).toBeTruthy();
  });

  it("acknowledges initialized notifications", async () => {
    const response = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
  });

  it("lists the moa_reason tool", async () => {
    const response = await call(rpc("tools/list", 2));
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["moa_reason"]);
  });

  it("returns a stable mock tool result with intermediate output", async () => {
    const response = await call(rpc("tools/call", 3, {
      name: "moa_reason",
      arguments: { task: "测试任务", language: "zh-CN", include_trace: true },
    }));
    const body = await response.json() as { result: { content: Array<{ type: string; text: string }>; isError: boolean } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].type).toBe("text");
    const output = JSON.parse(body.result.content[0].text) as { answer: string; intermediate_results: unknown[]; trace: unknown };
    expect(output.answer).toContain("测试任务");
    expect(output.intermediate_results).toHaveLength(2);
    expect(output.trace).toBeTruthy();
  });

  it("can omit trace without omitting intermediate results", async () => {
    const response = await call(rpc("tools/call", 4, {
      name: "moa_reason",
      arguments: { task: "hello", language: "en-US", include_trace: false },
    }));
    const body = await response.json() as { result: { content: Array<{ text: string }> } };
    const output = JSON.parse(body.result.content[0].text) as { intermediate_results: unknown[]; trace?: unknown };
    expect(output.intermediate_results.length).toBeGreaterThan(0);
    expect(output.trace).toBeUndefined();
  });

  it("returns protocol errors for unknown methods and tools", async () => {
    const unknownMethod = await call(rpc("missing", 5));
    expect((await unknownMethod.json() as { error: { code: number } }).error.code).toBe(-32601);

    const unknownTool = await call(rpc("tools/call", 6, { name: "missing", arguments: {} }));
    expect((await unknownTool.json() as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("rejects invalid content types and methods", async () => {
    const contentType = await call(rpc("tools/list", 7), { "Content-Type": "text/plain" });
    expect(contentType.status).toBe(415);

    const method = await handleMcpRequest(new Request("https://example.com/mcp", { method: "GET" }), env);
    expect(method.status).toBe(405);
  });
});
