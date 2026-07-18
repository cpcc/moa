import type { Env } from "./env";
import { authorize, authorizeAnthropic } from "./auth";
import { handleAnthropicRequest, modelsResponse } from "./anthropic/route";
import { handleMcpRequest } from "./mcp/server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "moa", version: "0.1.0" });
    }

    if (url.pathname === "/v1/models") {
      const authError = authorizeAnthropic(request, env.MOA_AUTH_TOKEN);
      if (authError) return authError;
      return modelsResponse();
    }

    if (url.pathname === "/v1/messages") {
      const authError = authorizeAnthropic(request, env.MOA_AUTH_TOKEN);
      if (authError) return authError;
      return handleAnthropicRequest(request, env);
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "NOT_FOUND" }, 404);
    }

    const authError = authorize(request, env.MOA_AUTH_TOKEN);
    if (authError) return authError;

    return handleMcpRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
