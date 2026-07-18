export interface Ai {
  run<T = unknown>(model: string, input: unknown, options?: { signal?: AbortSignal }): Promise<T>;
}

export interface Env {
  AI?: Ai;
  MOA_AUTH_TOKEN?: string;
  MOA_DEFAULT_PROFILE?: string;
  MOA_MAX_LAYERS?: string;
  MOA_MAX_PROPOSERS?: string;
  MOA_REQUEST_TIMEOUT_MS?: string;
  MOA_MAX_INPUT_CHARS?: string;
  MOA_MAX_OUTPUT_CHARS?: string;
  MOA_MAX_OUTPUT_TOKENS?: string;
  MOA_MAX_TOTAL_RESPONSE_CHARS?: string;
  MOA_MAX_RETRIES?: string;
  MOA_MAX_AI_CALLS?: string;
  MOA_MAX_CONCURRENT_AGENTS?: string;
  MOA_MIN_SUCCESSFUL_PROPOSERS?: string;
  MOA_JUDGE_ENABLED?: string;
  CLOUDFLARE_ACCOUNT_PLAN?: string;
  WORKERS_AI_REGION?: string;
}
