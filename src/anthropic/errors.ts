import type { MoaExecutionError } from "../contracts";
import { isMoaExecutionError, type AnthropicErrorBody } from "./contracts";

export function anthropicError(
  requestId: string,
  type: string,
  message: string,
): AnthropicErrorBody {
  return { type: "error", error: { type, message }, request_id: requestId };
}

export function errorStatus(error: unknown): number {
  if (isMoaExecutionError(error)) {
    if (error.code === "UPSTREAM_RATE_LIMITED") return 429;
    if (error.code === "UPSTREAM_TIMEOUT") return 504;
    if (error.code === "MODEL_UNAVAILABLE") return 404;
    if (error.code === "INPUT_TOO_LARGE") return 413;
  }
  return 500;
}

export function errorType(error: unknown): string {
  if (isMoaExecutionError(error)) {
    const map: Record<string, string> = {
      INPUT_TOO_LARGE: "request_too_large",
      MODEL_UNAVAILABLE: "not_found_error",
      UPSTREAM_RATE_LIMITED: "rate_limit_error",
      UPSTREAM_TIMEOUT: "api_error",
      BUDGET_EXCEEDED: "rate_limit_error",
    };
    return map[error.code] ?? "api_error";
  }
  return "api_error";
}

export function safeErrorMessage(error: unknown): string {
  if (isMoaExecutionError(error)) return error.message;
  return "The gateway could not complete the request";
}
