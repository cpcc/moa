import { describe, expect, it } from "vitest";
import { normalizeModelResponse } from "../src/workers-ai/normalize";

describe("Workers AI response normalization", () => {
  it("normalizes responses output_text", () => {
    expect(normalizeModelResponse({ output_text: " answer " })).toEqual({ text: "answer" });
  });

  it("normalizes chat completions", () => {
    expect(normalizeModelResponse({ choices: [{ message: { content: "answer" } }] })).toEqual({ text: "answer" });
  });

  it("supports direct and compatibility text fields", () => {
    expect(normalizeModelResponse("answer")).toEqual({ text: "answer" });
    expect(normalizeModelResponse({ response: "answer" })).toEqual({ text: "answer" });
  });

  it("rejects empty and malformed output", () => {
    expect(() => normalizeModelResponse({ output_text: "  " })).toThrow();
    expect(() => normalizeModelResponse({ choices: [] })).toThrow();
    expect(() => normalizeModelResponse({ error: "provider failure" })).toThrow();
  });
});
