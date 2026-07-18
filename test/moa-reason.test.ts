import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { handleMcpRequest } from "../src/mcp/server";

const env = { MOA_MAX_INPUT_CHARS: "10", MOA_DEFAULT_PROFILE: "balanced" } as Env;

describe("moa_reason validation", () => {
  it("rejects a missing task", async () => {
    const response = await handleMcpRequest(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "moa_reason", arguments: {} } }),
      }),
      env,
    );
    expect((await response.json() as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("rejects an overlong task", async () => {
    const response = await handleMcpRequest(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "moa_reason", arguments: { task: "12345678901" } } }),
      }),
      env,
    );
    expect((await response.json() as { error: { message: string } }).error.message).toContain("maximum");
  });
});
