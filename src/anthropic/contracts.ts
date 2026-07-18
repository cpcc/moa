import type { DomainErrorCode, MoaExecutionError, MoaReasonOutput } from "../contracts";
import type { Language, Mode } from "../config";

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | AnthropicTextBlock[];
  is_error?: boolean;
}

export type SupportedContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;
export type SupportedContent = string | SupportedContentBlock[];

export interface AnthropicMessageParam {
  role: string;
  content: SupportedContent;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

export type AnthropicToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "none" }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string | AnthropicTextBlock[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AnthropicResponseContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicResponseContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicErrorBody {
  type: "error";
  error: { type: string; message: string };
  request_id: string;
}

export interface InternalMessageResult {
  content: AnthropicResponseContentBlock[];
  stop_reason: AnthropicMessageResponse["stop_reason"];
  usage: AnthropicUsage;
}

export function isMoaExecutionError(value: unknown): value is MoaExecutionError {
  // 识别所有带 code 字段的领域错误（MoaExecutionError、ModelExecutionError，
  // 以及 route.ts 里 Object.assign(new Error(), { code }) 抛出的 INPUT_TOO_LARGE）。
  // 不强制要求 requestId，因为不是所有错误来源都携带它。
  return value instanceof Error && typeof (value as { code?: unknown }).code === "string";
}

export type { DomainErrorCode, Language, Mode, MoaReasonOutput };
