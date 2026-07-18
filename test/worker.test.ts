import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const env = { MOA_AUTH_TOKEN: "test-token" } as Env;

async function fetch(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://example.com${path}`, init), env);
}

describe("Worker routes", () => {
  it("serves an unauthenticated health check", async () => {
    const response = await fetch("/health");
    expect(response.status).toBe(200);
    expect((await response.json() as { ok: boolean }).ok).toBe(true);
  });

  it("returns 404 for unknown paths", async () => {
    expect((await fetch("/unknown")).status).toBe(404);
  });

  it("protects all MCP requests before parsing", async () => {
    const response = await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("allows an authenticated MCP request", async () => {
    const response = await fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(200);
  });
});
