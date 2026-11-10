import { AppError } from "../security/crypto.js";

const inflight = new Map<string, number>();

export const MAX_INFLIGHT = 4;
export const MAX_BODY_CHARS = 100_000;

export function inflightKey(input: { token?: string | null; email?: string; source: string }): string {
  if (input.token) return `session:${input.token}`;
  const email = input.email?.trim().toLowerCase() ?? "";
  if (email) return `account:${email}|source:${input.source}`;
  return `source:${input.source}`;
}

export function resetInflightForTests(): void {
  inflight.clear();
}

export function reserveInflight(key: string): () => void {
  const current = inflight.get(key) ?? 0;
  if (current >= MAX_INFLIGHT) throw new AppError("busy", "Too many requests.", 429);
  inflight.set(key, current + 1);
  return () => {
    const next = (inflight.get(key) ?? 1) - 1;
    if (next <= 0) inflight.delete(key);
    else inflight.set(key, next);
  };
}

export function assertBodyBudget(request: Request): void {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_CHARS) {
    throw new AppError("body_too_large", "Body was rejected.", 413);
  }
  if (request.signal.aborted) throw new AppError("cancelled", "Cancelled.", 408);
}
