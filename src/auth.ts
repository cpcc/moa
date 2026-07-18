const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": 'Bearer realm="moa"',
      "Cache-Control": "no-store",
    },
  });
}

export function authorize(request: Request, expectedToken: string | undefined): Response | null {
  if (!expectedToken) return unauthorized();
  const value = request.headers.get("Authorization");
  const match = value?.match(/^Bearer ([^\s]+)$/);
  if (!match || !constantTimeEqual(match[1], expectedToken)) return unauthorized();
  return null;
}

export function authorizeAnthropic(request: Request, expectedToken: string | undefined): Response | null {
  if (!expectedToken) return unauthorized();
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  const apiKey = request.headers.get("x-api-key") ?? undefined;
  if (bearer && apiKey && !constantTimeEqual(bearer, apiKey)) return unauthorized();
  const supplied = bearer ?? apiKey;
  if (!supplied || !constantTimeEqual(supplied, expectedToken)) return unauthorized();
  return null;
}
