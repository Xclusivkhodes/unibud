import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export const STREAK_RULE =
  "Consecutive local dates with a completed study session, using the student timezone. Today counts only when a completed session exists. If today has none, a run that includes yesterday stays open. Paused or interrupted sessions are excluded. This is recorded attendance, not mastery.";

export function studyStreak(completedLocalDates: string[], today: string): { days: number; rule: string } {
  const unique = [...new Set(completedLocalDates)].sort();
  if (unique.length === 0) return { days: 0, rule: STREAK_RULE };
  const latest = unique[unique.length - 1];
  if (latest !== today && latest !== shiftDate(today, -1)) return { days: 0, rule: STREAK_RULE };
  let days = 0;
  let cursor = latest;
  const set = new Set(unique);
  while (set.has(cursor)) {
    days += 1;
    cursor = shiftDate(cursor, -1);
  }
  return { days, rule: STREAK_RULE };
}

export function recordedMinutes(startedAt: string, endedAt: string, pausedMs: number): number {
  const span = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round((span - pausedMs) / 60000));
}
