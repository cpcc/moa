import { describe, expect, it } from "vitest";
import { parseModelSelection, ModelSelectionError } from "../src/moa/model-selection";
import { getRuntimeConfig } from "../src/config";
import { DEFAULT_AGGREGATOR, MODEL_PRESETS } from "../src/workers-ai/models";

function config(overrides: Record<string, string> = {}) {
  return getRuntimeConfig({ MOA_MAX_PROPOSERS: "3", ...overrides });
}

describe("parseModelSelection", () => {
  it("returns undefined for empty / undefined spec (use default combo)", () => {
    expect(parseModelSelection(undefined, config())).toBeUndefined();
    expect(parseModelSelection("", config())).toBeUndefined();
    expect(parseModelSelection("   ", config())).toBeUndefined();
  });

  it("single model → 1 proposer + default aggregator", () => {
    const sel = parseModelSelection("kimi-k2.7-code", config());
    expect(sel?.proposers).toEqual(["@cf/moonshotai/kimi-k2.7-code"]);
    expect(sel?.aggregator).toBe(DEFAULT_AGGREGATOR);
  });

  it("multiple models → last is aggregator, rest are proposers", () => {
    const sel = parseModelSelection("kimi-k2.7-code/glm-5.2/nemotron-3-120b-a12b/gpt-oss-120b", config());
    expect(sel?.proposers).toEqual([
      "@cf/moonshotai/kimi-k2.7-code",
      "@cf/zai-org/glm-5.2",
      "@cf/nvidia/nemotron-3-120b-a12b",
    ]);
    expect(sel?.aggregator).toBe("@cf/openai/gpt-oss-120b");
  });

  it("accepts full binding IDs (not just short names)", () => {
    const sel = parseModelSelection("@cf/moonshotai/kimi-k2.6/@cf/openai/gpt-oss-120b", config());
    expect(sel?.proposers).toEqual(["@cf/moonshotai/kimi-k2.6"]);
    expect(sel?.aggregator).toBe("@cf/openai/gpt-oss-120b");
  });

  it("filters empty segments produced by stray slashes", () => {
    const sel = parseModelSelection("kimi-k2.7-code//gpt-oss-120b", config());
    expect(sel?.proposers).toEqual(["@cf/moonshotai/kimi-k2.7-code"]);
    expect(sel?.aggregator).toBe("@cf/openai/gpt-oss-120b");
  });

  it("throws ModelSelectionError on unknown short name", () => {
    expect(() => parseModelSelection("unknown-model", config())).toThrow(ModelSelectionError);
    expect(() => parseModelSelection("kimi-k2.7-code/unknown-model", config())).toThrow(ModelSelectionError);
  });

  it("throws ModelSelectionError when proposer count exceeds maxProposers", () => {
    // 4 proposers + 1 aggregator, but maxProposers=3
    expect(() =>
      parseModelSelection("kimi-k2.7-code/glm-5.2/kimi-k2.6/gemma-4-26b-a4b-it/gpt-oss-120b", config()),
    ).toThrow(ModelSelectionError);
  });

  it("all preset A/B/C parse to 3 proposers + 1 aggregator", () => {
    for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
      const sel = parseModelSelection(preset.models, config());
      expect(sel, `preset ${key} should parse`).toBeDefined();
      expect(sel?.proposers).toHaveLength(3);
      expect(sel?.aggregator).toBeTruthy();
    }
  });

  it("respects a higher maxProposers when configured", () => {
    // maxProposers=5 allows 4 proposers
    const sel = parseModelSelection(
      "kimi-k2.7-code/glm-5.2/kimi-k2.6/gemma-4-26b-a4b-it/gpt-oss-120b",
      config({ MOA_MAX_PROPOSERS: "5" }),
    );
    expect(sel?.proposers).toHaveLength(4);
    expect(sel?.aggregator).toBe("@cf/openai/gpt-oss-120b");
  });
});
