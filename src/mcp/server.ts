import type { Env } from "../env";
import type { JsonRpcRequest, JsonRpcResponse, MoaReasonInput, MoaExecutionError } from "../contracts";
import { getRuntimeConfig } from "../config";
import { runConfiguredMoaReason } from "../tools/moa-reason";
import { ModelSelectionError } from "../moa/model-selection";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  jsonResponse,
  rpcError,
} from "./errors";
import { listToolsResult } from "./tools";

const SERVER_INFO = {
  name: "moa",
  version: "0.1.0",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

function parseInput(value: unknown, maxInputChars: number): MoaReasonInput {
  if (!isRecord(value) || typeof value.task !== "string" || value.task.trim() === "") {
    throw new InputValidationError("task is required");
  }
  if (value.task.length > maxInputChars) throw new InputValidationError("task exceeds maximum length");

  const language = value.language;
  if (language !== undefined && language !== "auto" && language !== "zh-CN" && language !== "en-US") {
    throw new InputValidationError("language must be auto, zh-CN, or en-US");
  }

  const mode = value.mode;
  if (mode !== undefined && mode !== "quality" && mode !== "balanced" && mode !== "fast") {
    throw new InputValidationError("mode must be quality, balanced, or fast");
  }

  for (const field of ["layer_count", "proposer_count"] as const) {
    const candidate = value[field];
    if (candidate !== undefined && (!Number.isInteger(candidate) || (candidate as number) < 1)) {
      throw new InputValidationError(`${field} must be a positive integer`);
    }
  }

  if (value.include_trace !== undefined && typeof value.include_trace !== "boolean") {
    throw new InputValidationError("include_trace must be boolean");
  }

  const models = value.models;
  if (models !== undefined && typeof models !== "string") {
    throw new InputValidationError("models must be a string");
  }

  return {
    task: value.task,
    language: language as MoaReasonInput["language"],
    mode: mode as MoaReasonInput["mode"],
    layer_count: value.layer_count as number | undefined,
    proposer_count: value.proposer_count as number | undefined,
    include_trace: value.include_trace as boolean | undefined,
    models: models as string | undefined,
  };
}

function initializeResult() {
  return {
    protocolVersion: "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
  };
}

function normalizeRequest(value: unknown): JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    throw new Error("invalid JSON-RPC request");
  }
  const id = value.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") {
    throw new Error("invalid JSON-RPC id");
  }
  return {
    jsonrpc: "2.0",
    id: id as string | number | null | undefined,
    method: value.method,
    params: isRecord(value.params) ? value.params : undefined,
  };
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json" }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, JSON_RPC_INVALID_REQUEST, "Invalid JSON"), 400);
  }

  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = normalizeRequest(body);
  } catch (error) {
    return jsonResponse(rpcError(null, JSON_RPC_INVALID_REQUEST, error instanceof Error ? error.message : "Invalid request"), 400);
  }

  const id = rpcRequest.id ?? null;
  let response: JsonRpcResponse | null = null;

  try {
    switch (rpcRequest.method) {
      case "initialize":
        response = { jsonrpc: "2.0", id, result: initializeResult() };
        break;
      case "notifications/initialized":
        return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
      case "tools/list":
        response = { jsonrpc: "2.0", id, result: listToolsResult() };
        break;
      case "tools/call": {
        const params = rpcRequest.params;
        if (!params || params.name !== "moa_reason") {
          response = rpcError(id, JSON_RPC_INVALID_PARAMS, "Unknown tool");
          break;
        }
        const config = getRuntimeConfig(env);
        const input = parseInput(params.arguments, config.maxInputChars);
        const output = await runConfiguredMoaReason(input, config, env);
        response = {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output) }],
            isError: false,
          },
        };
        break;
      }
      default:
        response = rpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${rpcRequest.method}`);
    }
  } catch (error) {
    if (rpcRequest.method === "tools/call") {
      if (error instanceof InputValidationError || error instanceof ModelSelectionError) {
        response = rpcError(id, JSON_RPC_INVALID_PARAMS, error.message);
      } else {
        const execution = error as Partial<MoaExecutionError>;
        response = rpcError(id, JSON_RPC_INTERNAL_ERROR, "MoA execution failed", {
          code: typeof execution.code === "string" ? execution.code : "INTERNAL_ERROR",
          request_id: typeof execution.requestId === "string" ? execution.requestId : undefined,
          retryable: execution.retryable === true,
        });
      }
    } else {
      response = rpcError(id, JSON_RPC_INTERNAL_ERROR, "Internal error");
    }
  }

  return jsonResponse(response);
}
