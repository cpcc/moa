import type { Env } from "../env";
import { getRuntimeConfig } from "../config";
import { runConfiguredMoaReason } from "../tools/moa-reason";
import { createRequestId } from "../tools/moa-reason";
import {
  type AnthropicMessageParam,
  type AnthropicMessagesRequest,
  type AnthropicTextBlock,
  type InternalMessageResult,
} from "./contracts";
import { anthropicError, errorStatus, errorType, safeErrorMessage } from "./errors";
import { getPublicModel, listPublicModels } from "./models";
import { messageResponse } from "./serialize";
import { messageStream } from "./stream";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextBlock(value: unknown): value is AnthropicTextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function validateContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (!Array.isArray(value)) throw new Error("message content must be text or supported blocks");
  const text: string[] = [];
  for (const block of value) {
    if (isTextBlock(block)) {
      text.push(block.text);
    } else if (isRecord(block) && block.type === "tool_result") {
      text.push(`[tool_result ${String(block.tool_use_id ?? "unknown")}] ${typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "")}`);
    } else if (isRecord(block) && block.type === "tool_use") {
      text.push(`[tool_use ${String(block.name ?? "unknown")}] ${JSON.stringify(block.input ?? {})}`);
    } else if (isRecord(block) && typeof block.text === "string") {
      text.push(block.text);
    } else if (isRecord(block)) {
      text.push(`[${String(block.type ?? "unknown")}]`);
    } else {
      text.push(String(block ?? ""));
    }
  }
  return text.join("\n");
}

function validateRequest(value: unknown, maxInputChars: number): AnthropicMessagesRequest {
  if (!isRecord(value)) throw new Error("request body must be an object");
  if (typeof value.model !== "string" || value.model === "") throw new Error("model is required");
  // model 可以是别名（moa-sonnet）或组合字符串（kimi-k2.7-code/.../gpt-oss-120b，含 /）
  if (!value.model.includes("/") && !getPublicModel(value.model)) {
    throw Object.assign(new Error("model not found"), { status: 404 });
  }
  if (!Number.isInteger(value.max_tokens) || Number(value.max_tokens) < 1) throw new Error("max_tokens must be a positive integer");
  if (!Array.isArray(value.messages) || value.messages.length === 0) throw new Error("messages is required");
  let total = 0;
  const messages: AnthropicMessageParam[] = value.messages.map((message) => {
    if (!isRecord(message) || typeof message.role !== "string" || message.role === "") throw new Error("message role must be a non-empty string");
    const content = validateContent(message.content);
    total += content.length;
    return { role: message.role, content: typeof message.content === "string" ? message.content : [{ type: "text", text: content }] };
  });
  if (total > maxInputChars) throw Object.assign(new Error("request exceeds maximum input size"), { code: "INPUT_TOO_LARGE" });
  const system = value.system === undefined ? undefined : validateContent(value.system);
  return {
    model: value.model,
    max_tokens: Number(value.max_tokens),
    messages,
    system,
    stream: value.stream === true,
  };
}

function taskFromRequest(request: AnthropicMessagesRequest): string {
  const system = request.system ? `SYSTEM:\n${typeof request.system === "string" ? request.system : request.system.map((block) => block.text).join("\n")}\n` : "";
  return `${system}${request.messages.map((message) => `${message.role.toUpperCase()}: ${typeof message.content === "string" ? message.content : message.content.map((block) => block.type === "text" ? block.text : JSON.stringify(block)).join("\n")}`).join("\n")}`;
}

function json(data: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "request-id": requestId,
      "X-Moa-Request-Id": requestId,
    },
  });
}

export function modelsResponse(): Response {
  return new Response(JSON.stringify({ object: "list", data: listPublicModels().map(({ internalModel: _internal, ...model }) => model) }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleAnthropicRequest(request: Request, env: Env): Promise<Response> {
  const requestId = createRequestId();
  if (request.method !== "POST") return json(anthropicError(requestId, "invalid_request_error", "POST is required"), 405, requestId);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(anthropicError(requestId, "invalid_request_error", "Content-Type must be application/json"), 415, requestId);
  }
  try {
    const body = await request.json();
    const input = validateRequest(body, getRuntimeConfig(env).maxInputChars);
    const queryModels = new URL(request.url).searchParams.get("models");
    // 优先用 ?models= 查询参数；否则若 model 字段含 / 视为组合 spec
    const models = queryModels ?? (input.model.includes("/") ? input.model : undefined);
    const output = await runConfiguredMoaReason({ task: taskFromRequest(input), language: "auto", include_trace: false, models }, getRuntimeConfig(env), env, requestId);
    const response = messageResponse(input.model, [{ type: "text", text: output.answer }], "end_turn", { input_tokens: 0, output_tokens: 0 });
    return input.stream ? messageStream(response) : json(response, 200, requestId);
  } catch (error) {
    const validation = error instanceof Error && !("code" in error) && !("status" in error);
    const status = validation ? 400 : typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 404 ? 404 : errorStatus(error);
    const type = validation ? "invalid_request_error" : status === 404 ? "not_found_error" : error instanceof Error && (error as { code?: unknown }).code === "INPUT_TOO_LARGE" ? "request_too_large" : errorType(error);
    return json(anthropicError(requestId, type, error instanceof Error && status < 500 ? error.message : safeErrorMessage(error)), status, requestId);
  }
}
