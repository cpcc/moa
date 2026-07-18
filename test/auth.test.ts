import { describe, expect, it } from "vitest";
import { authorize } from "../src/auth";

const token = "test-token";

function request(value?: string): Request {
  return new Request("https://example.com/mcp", {
    headers: value === undefined ? undefined : { Authorization: value },
  });
}

describe("authorize", () => {
  it("rejects a missing token", () => {
    const response = authorize(request(), token);
    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects malformed and incorrect tokens", () => {
    expect(authorize(request("Basic abc"), token)?.status).toBe(401);
    expect(authorize(request("Bearer wrong"), token)?.status).toBe(401);
    expect(authorize(request("Bearer test-token extra"), token)?.status).toBe(401);
  });

  it("accepts the exact bearer token", () => {
    expect(authorize(request("Bearer test-token"), token)).toBeNull();
  });

  it("fails closed when the configured token is missing", () => {
    expect(authorize(request("Bearer test-token"), undefined)?.status).toBe(401);
  });
});
