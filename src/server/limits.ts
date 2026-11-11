import { AppError } from "../security/crypto.js";

const inflight = new Map<string, number>();
type FailureState = { count: number; lockedUntil: number | null; updatedAt: number };
const accountFailures = new Map<string, FailureState>();
const sourceFailures = new Map<string, FailureState>();

export const MAX_INFLIGHT = 4;
export const MAX_BODY_CHARS = 100_000;
export const LOGIN_LOCK_AFTER = 8;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const FAILURE_RETENTION_MS = 60 * 60 * 1000;
export const MAX_FAILURE_KEYS = 64;

export function normalizeAccount(email: string): string {
  return email.trim().toLowerCase();
}

export function trustedRequestSource(remoteAddress: string | null | undefined): string {
  const value = remoteAddress?.trim().toLowerCase() ?? "";
  if (!value || value === "unknown") return "peer-unavailable";
  return value;
}

function pruneMap(map: Map<string, FailureState>, now: number): void {
  for (const [key, state] of map) {
    if ((state.lockedUntil !== null && state.lockedUntil <= now) || now - state.updatedAt > FAILURE_RETENTION_MS) map.delete(key);
  }
  while (map.size > MAX_FAILURE_KEYS) {
    const oldest = [...map.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (!oldest) break;
    map.delete(oldest[0]);
  }
}

export function pruneLoginFailures(now: number): void {
  pruneMap(accountFailures, now);
  pruneMap(sourceFailures, now);
}

function locked(map: Map<string, FailureState>, key: string, now: number): boolean {
  const state = map.get(key);
  if (!state?.lockedUntil) return false;
  if (state.lockedUntil <= now) {
    map.delete(key);
    return false;
  }
  return true;
}

export function assertLoginAllowed(email: string, source: string, now: number): void {
  pruneLoginFailures(now);
  if (locked(accountFailures, normalizeAccount(email), now) || locked(sourceFailures, source, now)) {
    throw new AppError("login_locked", "Login was locked.", 429);
  }
}

function bump(map: Map<string, FailureState>, key: string, now: number): void {
  const current = map.get(key);
  const stillCounting = current && current.lockedUntil === null && now - current.updatedAt <= LOGIN_LOCK_MS;
  const count = (stillCounting ? current.count : 0) + 1;
  map.set(key, { count, lockedUntil: count >= LOGIN_LOCK_AFTER ? now + LOGIN_LOCK_MS : null, updatedAt: now });
}

export function recordLoginFailure(email: string, source: string, now: number): void {
  bump(accountFailures, normalizeAccount(email), now);
  bump(sourceFailures, source, now);
  pruneLoginFailures(now);
}

export function clearLoginFailures(email: string, source: string): void {
  accountFailures.delete(normalizeAccount(email));
  sourceFailures.delete(source);
}

export function failureKeyCount(): number {
  return accountFailures.size + sourceFailures.size;
}

export function inflightKey(input: { token?: string | null; email?: string; source: string }): string {
  if (input.token) return `session:${input.token}`;
  const email = input.email?.trim().toLowerCase() ?? "";
  if (email) return `account:${email}|source:${input.source}`;
  return `source:${input.source}`;
}

export function resetInflightForTests(): void {
  inflight.clear();
  accountFailures.clear();
  sourceFailures.clear();
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
