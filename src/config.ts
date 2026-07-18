import type { Env } from "./env";

export type Language = "auto" | "zh-CN" | "en-US";
export type Mode = "quality" | "balanced" | "fast";

export interface RuntimeConfig {
  defaultProfile: Mode;
  maxLayers: number;
  maxProposers: number;
  requestTimeoutMs: number;
  maxInputChars: number;
  maxOutputChars: number;
  maxTotalResponseChars: number;
  maxRetries: number;
  maxAiCalls: number;
  maxConcurrentAgents: number;
  minSuccessfulProposers: number;
  accountPlan: string;
  region: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getRuntimeConfig(env: Env): RuntimeConfig {
  const profile = env.MOA_DEFAULT_PROFILE;
  const defaultProfile: Mode =
    profile === "fast" || profile === "quality" ? profile : "balanced";

  return {
    defaultProfile,
    maxLayers: positiveInt(env.MOA_MAX_LAYERS, 2),
    maxProposers: positiveInt(env.MOA_MAX_PROPOSERS, 3),
    requestTimeoutMs: positiveInt(env.MOA_REQUEST_TIMEOUT_MS, 60_000),
    maxInputChars: positiveInt(env.MOA_MAX_INPUT_CHARS, 12_000),
    maxOutputChars: positiveInt(env.MOA_MAX_OUTPUT_CHARS, 12_000),
    maxTotalResponseChars: positiveInt(env.MOA_MAX_TOTAL_RESPONSE_CHARS, 50_000),
    maxRetries: nonNegativeInt(env.MOA_MAX_RETRIES, 1),
    maxAiCalls: positiveInt(env.MOA_MAX_AI_CALLS, 4),
    maxConcurrentAgents: positiveInt(env.MOA_MAX_CONCURRENT_AGENTS, 3),
    minSuccessfulProposers: positiveInt(env.MOA_MIN_SUCCESSFUL_PROPOSERS, 1),
    accountPlan: env.CLOUDFLARE_ACCOUNT_PLAN ?? "free",
    region: env.WORKERS_AI_REGION ?? "US",
  };
}
