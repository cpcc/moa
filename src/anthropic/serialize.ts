import type { AnthropicMessageResponse } from "./contracts";

export function messageResponse(
  model: string,
  content: AnthropicMessageResponse["content"],
  stopReason: AnthropicMessageResponse["stop_reason"] = "end_turn",
  usage: AnthropicMessageResponse["usage"] = { input_tokens: 0, output_tokens: 0 },
): AnthropicMessageResponse {
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  };
}
