export interface Deadline {
  readonly at: number;
  remaining(): number;
  expired(): boolean;
}

export function createDeadline(timeoutMs: number): Deadline {
  const at = Date.now() + timeoutMs;
  return {
    at,
    remaining: () => Math.max(0, at - Date.now()),
    expired: () => Date.now() >= at,
  };
}
