import type { AnthropicMessageResponse } from "./contracts";

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function messageStream(response: AnthropicMessageResponse): Response {
  const chunks: string[] = [];
  chunks.push(event("message_start", {
    type: "message_start",
    message: { ...response, content: [], stop_reason: null },
  }));
  response.content.forEach((block, index) => {
    if (block.type === "text") {
      chunks.push(event("content_block_start", {
        type: "content_block_start", index, content_block: { type: "text", text: "" },
      }));
      chunks.push(event("content_block_delta", {
        type: "content_block_delta", index, delta: { type: "text_delta", text: block.text ?? "" },
      }));
    } else {
      chunks.push(event("content_block_start", {
        type: "content_block_start", index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      }));
      chunks.push(event("content_block_delta", {
        type: "content_block_delta", index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      }));
    }
    chunks.push(event("content_block_stop", { type: "content_block_stop", index }));
  });
  chunks.push(event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: response.stop_reason, stop_sequence: null },
    usage: { output_tokens: response.usage.output_tokens },
  }));
  chunks.push(event("message_stop", { type: "message_stop" }));
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunks.join("")));
      controller.close();
    },
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    },
  });
}
