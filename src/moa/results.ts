import type { IntermediateAgentResult } from "../contracts";

export function truncateOutput(value: string, maxChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxChars) return { value, truncated: false };
  return { value: value.slice(0, Math.max(0, maxChars)), truncated: true };
}

export function safeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "INTERNAL_ERROR";
}

export function failedAgent(
  agentId: string,
  role: IntermediateAgentResult["role"],
  model: string,
  duration: number,
  error: unknown,
): IntermediateAgentResult {
  return {
    agent_id: agentId,
    role,
    model,
    status: "failed",
    output: "",
    duration_ms: duration,
    error: safeError(error),
  };
}
