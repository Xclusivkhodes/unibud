import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { MeResponse } from "../src/contract/types.js";
import { openDatabase, run, type Db } from "../src/db.js";
import { recordDevMailboxSimulation, registerUser } from "../src/domain.js";
import { GOOGLE_APP_BLOCK_REASON, LEARNER_PROVIDER_BLOCK, REGISTRY, fallbackAfter, planRoute, type RouteDecision, type RouteInput } from "../src/providers/registry.js";
import { setChatTransportForTests } from "../src/providers/chat.js";
import { passwordWorkCountSnapshot, resetPasswordWorkCount } from "../src/security/crypto.js";
import { handleApi } from "../src/server/api.js";
import { LOGIN_LOCK_AFTER, LOGIN_LOCK_MS, MAX_FAILURE_KEYS, failureKeyCount, recordLoginFailure, resetInflightForTests } from "../src/server/limits.js";
import { courseFit, type QualityScoreInput } from "../src/youtube/quality.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetInflightForTests();
  setChatTransportForTests(null);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-frozen-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "unibud.sqlite"));
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string, source = "203.0.113.10", now = 1_700_000_000_000) {
  const headers = new Headers({ host: "127.0.0.1:3000", "x-unibud-request": "1", "x-forwarded-for": "198.51.100.99" });
  if (cookie) headers.set("cookie", cookie);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), database, { source, now });
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function register(database: Db, email: string, education_level: string, age_band: string) {
  const response = await call(database, "POST", "/api/auth/register", { email, password: "password123", education_level, age_band });
  const cookie = cookieFrom(response);
  const me = (await (await call(database, "GET", "/api/me", undefined, cookie)).json()) as MeResponse;
  return { response, cookie, me };
}

const adultRoute = (overrides: Partial<RouteInput> = {}): RouteInput => ({
  task: "tutoring",
  required: ["text"],
  sensitivity: "ordinary",
  audience: "adults_not_directed_at_minors",
  billingTier: "paid",
  grants: [],
  retention: "vendor_default_allowed",
  costMode: "unknown_cost_allowed",
  residency: "unspecified",
  independentCheck: false,
  online: true,
  configuredProviders: ["google"],
  ...overrides,
});

test("signup validation and /api/me shapes stay on the frozen contract", async () => {
  const database = db();
  const missing = await call(database, "POST", "/api/auth/register", { email: "x@example.edu", password: "password123" });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: "invalid_education_level" });
  const badAge = await call(database, "POST", "/api/auth/register", { email: "x@example.edu", password: "password123", education_level: "university", age_band: "adult" });
  expect(badAge.status).toBe(400);
  expect(await badAge.json()).toEqual({ error: "invalid_age_band" });

  const adult = await register(database, "adult@example.edu", "university", "18_plus");
  expect(adult.me).toEqual({
    id: adult.me.id,
    email: "adult@example.edu",
    dataClass: "learner",
    education_level: "university",
    age_band: "18_plus",
    account_status: "active",
    ai_available: false,
    needs_profile_completion: false,
  });
  const child = await register(database, "child@example.edu", "junior_high", "under_13");
  expect(child.me.account_status).toBe("pending_parental_consent");
  expect(child.me.ai_available).toBe(false);
  expect(child.me.age_band).toBe("under_13");
  const teen = await register(database, "teen@example.edu", "senior_high", "13_17");
  expect(teen.me).toMatchObject({ age_band: "13_17", account_status: "active", ai_available: false, education_level: "senior_high" });
  const schoolAdult = await register(database, "jhs-adult@example.edu", "junior_high", "18_plus");
  expect(schoolAdult.me.age_band).toBe("18_plus");
  expect(schoolAdult.me.ai_available).toBe(false);
  const uniMinor = await register(database, "uni-minor@example.edu", "university", "13_17");
  expect(uniMinor.me.ai_available).toBe(false);

  const legacy = registerUser(database, { email: "legacy@example.edu", password: "password123" });
  run(database, "UPDATE profiles SET education_level = '', age_band = NULL WHERE user_id = ?", legacy.id);
  const legacyCookie = cookieFrom(await call(database, "POST", "/api/auth/login", { email: "legacy@example.edu", password: "password123" }));
  const legacyMe = (await (await call(database, "GET", "/api/me", undefined, legacyCookie)).json()) as MeResponse;
  expect(legacyMe.education_level).toBeNull();
  expect(legacyMe.age_band).toBeNull();
  expect(legacyMe.needs_profile_completion).toBe(true);
  expect(legacyMe.ai_available).toBe(false);
  expect(legacyMe.account_status).toBe("pending_parental_consent");
  const completed = await call(database, "POST", "/api/profile/completion", { education_level: "university", age_band: "18_plus" }, legacyCookie);
  expect(await completed.json()).toMatchObject({ education_level: "university", age_band: "18_plus", needs_profile_completion: false, ai_available: false });
});

test("adult accounts cannot dispatch Gemini even with a key, including fallback", async () => {
  const database = db();
  process.env.GEMINI_API_KEY = "dummy-test-key";
  const adult = await register(database, "cleared@example.edu", "university", "18_plus");
  let calls = 0;
  setChatTransportForTests(async () => {
    calls += 1;
    return { status: 200, body: { candidates: [{ content: { parts: [{ text: "should not run" }] } }] } };
  });
  const chatId = ((await (await call(database, "POST", "/api/chats", { title: "Q" }, adult.cookie)).json()) as { id: string }).id;
  const asked = await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "synthetic prompt only" }, adult.cookie);
  const body = await asked.json() as { providerTurn: { status: string; text: string | null }; plan: { blocked: Array<{ provider: string; reason: string }> } };
  expect(calls).toBe(0);
  expect(body.providerTurn.text).toBeNull();
  expect(body.providerTurn.status).not.toBe("ok");
  expect(JSON.stringify(body)).not.toContain("dummy-test-key");
  expect(JSON.stringify(body.plan.blocked)).toContain(GOOGLE_APP_BLOCK_REASON);
  const adultPlan = planRoute(adultRoute());
  expect(adultPlan.status).toBe("unavailable");
  expect(adultPlan.primary?.provider).not.toBe("google");
  const google = REGISTRY.find((entry) => entry.provider === "google");
  const googleFallback: RouteDecision = {
    status: "selected",
    fallback: google,
    reason: "fixture",
    blocked: [],
    liveVerified: false,
    executed: false,
  };
  expect(fallbackAfter(googleFallback, "transient", adultRoute())).toBeNull();
});

test("under_13, 13_17, junior high, and senior high deny every provider including paid fallback", () => {
  const openai = REGISTRY.find((entry) => entry.provider === "openai");
  const cases: Array<Pick<RouteInput, "ageBand" | "educationLevel">> = [
    { ageBand: "under_13", educationLevel: "university" },
    { ageBand: "13_17", educationLevel: "university" },
    { ageBand: "18_plus", educationLevel: "junior_high" },
    { ageBand: "18_plus", educationLevel: "senior_high" },
    { ageBand: null, educationLevel: "university" },
  ];
  for (const claims of cases) {
    const input = adultRoute({ ...claims, allowPaidProviders: true, configuredProviders: ["openai", "google"], grants: ["openai", "google"], billingTier: "paid" });
    const plan = planRoute(input);
    expect(plan.status).toBe("unavailable");
    expect(plan.primary).toBeUndefined();
    expect(plan.blocked.length).toBeGreaterThan(0);
    expect(plan.blocked.every((item) => item.reason.includes(LEARNER_PROVIDER_BLOCK))).toBe(true);
    const forced: RouteDecision = { status: "selected", fallback: openai, reason: "fixture", blocked: [], liveVerified: false, executed: false };
    expect(fallbackAfter(forced, "transient", input)).toBeNull();
  }
});

test("school level does not unlock Gemini and under_13 circle stays blocked after a mailbox simulation", async () => {
  const database = db();
  const jhs = await register(database, "jhs@example.edu", "junior_high", "18_plus");
  const circle = await call(database, "POST", "/api/circles", { name: "Class" }, jhs.cookie);
  expect(circle.status).toBe(403);
  expect(await circle.json()).toEqual({ error: "circle_sharing_disabled" });
  const child = await register(database, "kid@example.edu", "university", "under_13");
  recordDevMailboxSimulation(database, child.me.id);
  const after = (await (await call(database, "GET", "/api/me", undefined, child.cookie)).json()) as MeResponse;
  expect(after.ai_available).toBe(false);
  expect(after.account_status).toBe("pending_parental_consent");
  expect((await call(database, "POST", "/api/circles", { name: "No" }, child.cookie)).status).toBe(403);
  const shs = await register(database, "shs@example.edu", "senior_high", "18_plus");
  const made = await call(database, "POST", "/api/circles", { name: "Form" }, shs.cookie);
  expect(made.status).toBe(201);
  const circleId = ((await made.json()) as { id: string }).id;
  const invite = await call(database, "POST", `/api/circles/${circleId}/invites`, { email: "jhs@example.edu" }, shs.cookie);
  expect(invite.status).toBe(403);
  expect(await invite.json()).toEqual({ error: "circle_sharing_restricted" });
  process.env.OPENAI_API_KEY = "dummy-openai-key";
  let calls = 0;
  setChatTransportForTests(async () => {
    calls += 1;
    return { status: 200, body: { choices: [{ message: { content: "should not run" } }] } };
  });
  const chatId = ((await (await call(database, "POST", "/api/chats", { title: "Q" }, jhs.cookie)).json()) as { id: string }).id;
  const asked = await (await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "synthetic prompt only" }, jhs.cookie)).json() as { providerTurn: { text: string | null }; plan: { blocked: Array<{ reason: string }> } };
  expect(calls).toBe(0);
  expect(asked.providerTurn.text).toBeNull();
  expect(asked.plan.blocked.every((item) => item.reason.includes(LEARNER_PROVIDER_BLOCK))).toBe(true);
  expect(JSON.stringify(asked)).not.toContain("dummy-openai-key");
  delete process.env.OPENAI_API_KEY;
});

test("login failures lock an account and a source separately, then expire", async () => {
  const database = db();
  await register(database, "one@example.edu", "university", "18_plus");
  await register(database, "two@example.edu", "university", "18_plus");
  await register(database, "rotate@example.edu", "university", "18_plus");
  const start = 1_700_000_000_000;
  resetPasswordWorkCount();
  expect((await call(database, "POST", "/api/auth/login", { email: "missing@example.edu", password: "wrong-password" }, undefined, "203.0.113.1", start)).status).toBe(401);
  const missingWork = passwordWorkCountSnapshot();
  resetPasswordWorkCount();
  expect((await call(database, "POST", "/api/auth/login", { email: "one@example.edu", password: "wrong-password" }, undefined, "203.0.113.1", start)).status).toBe(401);
  expect(passwordWorkCountSnapshot()).toBe(missingWork);
  resetInflightForTests();
  for (let attempt = 0; attempt < LOGIN_LOCK_AFTER; attempt += 1) {
    const response = await call(database, "POST", "/api/auth/login", { email: "one@example.edu", password: "wrong-password" }, undefined, "203.0.113.8", start + attempt);
    expect(response.status).toBe(401);
  }
  const lockedAccount = await call(database, "POST", "/api/auth/login", { email: "one@example.edu", password: "password123" }, undefined, "203.0.113.9", start + 20);
  expect(lockedAccount.status).toBe(429);
  expect(await lockedAccount.json()).toEqual({ error: "login_locked" });
  const otherAccount = await call(database, "POST", "/api/auth/login", { email: "two@example.edu", password: "password123" }, undefined, "198.51.100.8", start + 21);
  expect(otherAccount.status).toBe(200);
  for (let attempt = 0; attempt < LOGIN_LOCK_AFTER; attempt += 1) {
    expect((await call(database, "POST", "/api/auth/login", { email: `rot-${attempt}@example.edu`, password: "wrong-password" }, undefined, "203.0.113.77", start + 100 + attempt)).status).toBe(401);
  }
  const sourceLocked = await call(database, "POST", "/api/auth/login", { email: "two@example.edu", password: "password123" }, undefined, "203.0.113.77", start + 200);
  expect(sourceLocked.status).toBe(429);
  const afterExpiry = await call(database, "POST", "/api/auth/login", { email: "one@example.edu", password: "password123" }, undefined, "203.0.113.9", start + LOGIN_LOCK_MS + 50);
  expect(afterExpiry.status).toBe(200);
  for (let attempt = 0; attempt < LOGIN_LOCK_AFTER; attempt += 1) {
    const rotated = await call(database, "POST", "/api/auth/login", { email: "rotate@example.edu", password: "wrong-password" }, undefined, `198.51.100.${attempt + 1}`, start + 5_000 + attempt);
    expect(rotated.status).toBe(401);
  }
  const accountFollowsRotation = await call(database, "POST", "/api/auth/login", { email: "rotate@example.edu", password: "password123" }, undefined, "203.0.113.250", start + 6_000);
  expect(accountFollowsRotation.status).toBe(429);
  resetInflightForTests();
  for (let index = 0; index < MAX_FAILURE_KEYS + 5; index += 1) recordLoginFailure(`acct-${index}@example.edu`, "203.0.113.1", start);
  expect(failureKeyCount()).toBe(MAX_FAILURE_KEYS + 1);
});

test("invite responses match and do the same password work, and course_fit ignores YouTube statistics", async () => {
  const database = db();
  const owner = await register(database, "owner@example.edu", "university", "18_plus");
  await register(database, "member@example.edu", "university", "18_plus");
  const circleId = ((await (await call(database, "POST", "/api/circles", { name: "Group" }, owner.cookie)).json()) as { id: string }).id;
  resetPasswordWorkCount();
  const known = await (await call(database, "POST", `/api/circles/${circleId}/invites`, { email: "member@example.edu" }, owner.cookie)).json();
  const knownWork = passwordWorkCountSnapshot();
  resetPasswordWorkCount();
  const unknown = await (await call(database, "POST", `/api/circles/${circleId}/invites`, { email: "missing@example.edu" }, owner.cookie)).json();
  expect(unknown).toEqual(known);
  expect(known).toEqual({ status: "pending" });
  expect(JSON.stringify(known)).not.toContain("member@example.edu");
  expect(passwordWorkCountSnapshot()).toBe(knownWork);
  const signals: QualityScoreInput = { syllabusTopicMatch: 1, studentFeedback: 0.5, savedRate: 0, completedRate: 0.5 };
  const clean = courseFit(signals);
  const extra: Record<string, unknown> = { viewCount: "1000", likeCount: "10", commentCount: "4", statistics: { viewCount: "9" } };
  const polluted = courseFit(Object.assign({}, signals, extra) as QualityScoreInput);
  expect(clean.score).toBe(polluted.score);
  expect(clean.score).toBeGreaterThanOrEqual(0);
  expect(clean.score).toBeLessThanOrEqual(100);
  expect(clean.signals).toEqual(["syllabus_topic_match", "student_feedback", "saved_rate", "completed_rate"]);
  expect(clean.signals.join(" ")).not.toMatch(/viewCount|likeCount|commentCount/);
});
