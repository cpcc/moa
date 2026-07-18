import type { Language, Mode } from "./config";

export type DomainErrorCode =
  | "INVALID_ARGUMENT"
  | "INPUT_TOO_LARGE"
  | "BUDGET_EXCEEDED"
  | "MODEL_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_RATE_LIMITED"
  | "PARTIAL_FAILURE"
  | "ALL_AGENTS_FAILED"
  | "INTERNAL_ERROR";

export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface TextRunnerRequest {
  model: string;
  prompt: string;
  requestId: string;
  deadline: number;
  reserveCall?: () => boolean;
}

export interface TextRunnerResult {
  model: string;
  text: string;
  duration_ms: number;
  usage?: ModelUsage;
}

export interface TextRunner {
  runText(request: TextRunnerRequest): Promise<TextRunnerResult>;
}

export class MoaExecutionError extends Error {
  readonly code: DomainErrorCode;
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(code: DomainErrorCode, requestId: string, message: string, retryable = false) {
    super(message);
    this.name = "MoaExecutionError";
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export interface MoaReasonInput {
  task: string;
  language?: Language;
  mode?: Mode;
  layer_count?: number;
  proposer_count?: number;
  include_trace?: boolean;
  /**
   * 模型组合字符串，格式 `proposer1/proposer2/.../aggregator`（最后一个为 aggregator）。
   * 每段可用短名（如 `kimi-k2.7-code`）或完整 binding ID。空 / undefined 表示用默认组合。
   * 详见 `src/moa/model-selection.ts` 的 parseModelSelection。
   */
  models?: string;
}

export interface IntermediateAgentResult {
  agent_id: string;
  role: "proposer" | "aggregator" | "judge";
  model: string;
  status: "succeeded" | "failed";
  output: string;
  duration_ms: number;
  truncated?: boolean;
  error?: string;
}

export interface IntermediateLayerResult {
  layer: number;
  agents: IntermediateAgentResult[];
  aggregation_input: { type: "candidate_summary"; content: string } | null;
  aggregation_output: string | null;
}

export interface MoaReasonOutput {
  request_id: string;
  answer: string;
  intermediate_results: IntermediateLayerResult[];
  trace?: {
    total_duration_ms: number;
    degraded: boolean;
    mode: Mode;
    language: Language;
    call_count?: number;
  };
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
