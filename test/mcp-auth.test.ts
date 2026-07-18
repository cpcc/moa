import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const env = { MOA_AUTH_TOKEN: "test-token" } as Env;

describe("MCP authentication", () => {
  it("uses the same unauthorized response for missing and wrong credentials", async () => {
    const missing = await worker.fetch(new Request("https://example.com/mcp", { method: "POST" }), env);
    const wrong = await worker.fetch(new Request("https://example.com/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    }), env);

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe(wrong.headers.get("WWW-Authenticate"));
    expect(await missing.text()).not.toContain("test-token");
    expect(await wrong.text()).not.toContain("test-token");
  });
});
