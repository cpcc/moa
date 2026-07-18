import type { Ai } from "../env";
import type { DomainErrorCode, ModelUsage, TextRunner, TextRunnerRequest, TextRunnerResult } from "../contracts";
import { MODEL_ID, isAllowedModel } from "./models";
import { normalizeModelResponse } from "./normalize";

export class ModelExecutionError extends Error {
  readonly code: DomainErrorCode;
  readonly retryable: boolean;

  constructor(code: DomainErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ModelExecutionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyError(error: unknown): ModelExecutionError {
  if (error instanceof ModelExecutionError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ModelExecutionError("UPSTREAM_TIMEOUT", "Workers AI request timed out", true);
  }
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (status === 429) return new ModelExecutionError("UPSTREAM_RATE_LIMITED", "Workers AI rate limited the request", true);
  if (typeof status === "number" && status >= 500) {
    return new ModelExecutionError("INTERNAL_ERROR", "Workers AI temporarily failed", true);
  }
  if (error instanceof TypeError) return new ModelExecutionError("INTERNAL_ERROR", "Workers AI transport failed", true);
  return new ModelExecutionError("INTERNAL_ERROR", "Workers AI request failed", false);
}

function delayMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2_000);
}

function usageFrom(value: unknown): ModelUsage | undefined {
  if (typeof value !== "object" || value === null || !("usage" in value)) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const input = (usage as { input_tokens?: unknown }).input_tokens;
  const output = (usage as { output_tokens?: unknown }).output_tokens;
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return {
    input_tokens: typeof input === "number" ? input : undefined,
    output_tokens: typeof output === "number" ? output : undefined,
  };
}

export class WorkersAIAdapter implements TextRunner {
  constructor(
    private readonly ai: Ai,
    private readonly maxRetries: number,
  ) {}

  async runText(request: TextRunnerRequest): Promise<TextRunnerResult> {
    if (!isAllowedModel(request.model)) {
      throw new ModelExecutionError("MODEL_UNAVAILABLE", "Configured Workers AI model is unavailable");
    }

    let lastError: ModelExecutionError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const remaining = request.deadline - Date.now();
      if (remaining <= 0) {
        throw new ModelExecutionError("UPSTREAM_TIMEOUT", "MoA request deadline exceeded", true);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      const started = Date.now();
      try {
        const raw = await this.ai.run<unknown>(MODEL_ID, {
          messages: [{ role: "user", content: request.prompt }],
        }, { signal: controller.signal });
        const normalized = normalizeModelResponse(raw);
        return {
          model: MODEL_ID,
          text: normalized.text,
          duration_ms: Date.now() - started,
          usage: usageFrom(raw),
        };
      } catch (error) {
        lastError = classifyError(error);
        if (!lastError.retryable || attempt >= this.maxRetries || request.deadline <= Date.now()) throw lastError;
        if (request.reserveCall && !request.reserveCall()) {
          throw new ModelExecutionError("BUDGET_EXCEEDED", "AI call budget exceeded");
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs(attempt), Math.max(0, request.deadline - Date.now()))));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new ModelExecutionError("INTERNAL_ERROR", "Workers AI request failed");
  }
}
