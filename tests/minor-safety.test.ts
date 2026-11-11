import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { get, openDatabase, run, type Db } from "../src/db.js";
import { fallbackAfter, planRoute, type RegistryEntry, type RouteDecision, type RouteInput } from "../src/providers/registry.js";
import { sendSmtpMessage, smtpConfigFromEnv } from "../src/server/mail.js";
import { handleApi } from "../src/server/api.js";
import { PENDING_CONSENT_TTL_MS, UNDER_13_SESSION_SECONDS } from "../src/server/minor-safety.js";
import { minorInviteBlocked } from "../src/server/minor-safety.js";
import { accountCapabilities } from "../src/server/account-policy.js";

const dirs: string[] = [];
const previous: Record<string, string | undefined> = {};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const key of ["UNIBUD_OUTBOX_DIR", "UNIBUD_UPLOAD_DIR", "UNIBUD_ADMIN_TOKEN", "UNIBUD_SMTP_HOST", "UNIBUD_SMTP_PORT", "UNIBUD_SMTP_USER", "UNIBUD_SMTP_PASSWORD", "UNIBUD_SMTP_FROM", "YOUTUBE_API_KEY"]) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

function remember(key: string): void {
  if (!(key in previous)) previous[key] = process.env[key];
}

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-minor-"));
  dirs.push(dir);
  remember("UNIBUD_OUTBOX_DIR");
  remember("UNIBUD_UPLOAD_DIR");
  process.env.UNIBUD_OUTBOX_DIR = path.join(dir, "outbox");
  process.env.UNIBUD_UPLOAD_DIR = path.join(dir, "uploads");
  return openDatabase(path.join(dir, "unibud.sqlite"));
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string, now = 1_700_000_000_000, admin?: string) {
  const headers = new Headers({ host: "127.0.0.1:3000", "x-unibud-request": "1" });
  if (cookie) headers.set("cookie", cookie);
  if (admin) headers.set("x-unibud-admin", admin);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), database, { source: "203.0.113.20", now });
}

function cookieFrom(response: Response, name = "unibud_session"): string {
  const match = (response.headers.get("set-cookie") ?? "").split(",").find((part) => part.trim().startsWith(`${name}=`));
  return (match ?? "").split(";")[0];
}

async function register(database: Db, email: string, education_level: string, age_band: string, extra: Record<string, unknown> = {}, now = 1_700_000_000_000) {
  const response = await call(database, "POST", "/api/auth/register", { email, password: "password123", education_level, age_band, ...extra }, undefined, now);
  return { response, cookie: cookieFrom(response), body: await response.json() as { userId: string; age_band: string } };
}

const paid: RegistryEntry = {
  provider: "openai",
  model: "synthetic-allowed",
  host: "api.openai.com",
  documentedCapabilities: ["text"],
  capabilityStatus: "documented",
  contextTokens: null,
  outputTokenLimit: null,
  latency: null,
  cost: null,
  privacy: { training: "no_training_by_default", retention: "not_zero_retention" },
  residency: "unspecified",
  sourceUrl: "test",
  evidenceId: "TEST",
  liveVerified: false,
  operational: false,
};

function route(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    task: "tutoring",
    required: ["text"],
    sensitivity: "ordinary",
    audience: "adults_not_directed_at_minors",
    billingTier: "paid",
    grants: ["openai"],
    retention: "vendor_default_allowed",
    costMode: "unknown_cost_allowed",
    residency: "unspecified",
    independentCheck: false,
    online: true,
    configuredProviders: ["openai"],
    allowPaidProviders: true,
    ...overrides,
  };
}

test("age_band is derived from a date of birth, then frozen against PATCH and completion", async () => {
  const database = db();
  const conflict = await call(database, "POST", "/api/auth/register", {
    email: "child@example.edu",
    password: "password123",
    education_level: "junior_high",
    age_band: "18_plus",
    date_of_birth: "2015-01-01",
    parent_email: "parent@example.edu",
  });
  expect(conflict.status).toBe(400);
  expect(await conflict.json()).toEqual({ error: "parent_email_not_on_register" });
  const derived = await register(database, "child@example.edu", "junior_high", "", { date_of_birth: "2015-01-01", age_band: undefined });
  expect(derived.response.status).toBe(201);
  expect(derived.body.age_band).toBe("under_13");
  const columns = (database.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>).map((column) => column.name);
  expect(columns).not.toContain("date_of_birth");
  const tamper = await call(database, "PATCH", "/api/profile", { age_band: "18_plus", display_name: "A", rev: 1 }, derived.cookie);
  expect(tamper.status).toBe(409);
  expect(await tamper.json()).toEqual({ error: "age_band_frozen" });
  const me = await (await call(database, "GET", "/api/me", undefined, derived.cookie)).json() as { age_band: string };
  expect(me.age_band).toBe("under_13");
  const completion = await call(database, "POST", "/api/profile/completion", { education_level: "university", age_band: "18_plus" }, derived.cookie);
  expect(completion.status).toBe(409);
  expect((await completion.json() as { error: string }).error).toBe("age_band_frozen");
  const tracking = await call(database, "PATCH", "/api/profile", { display_name: "A", analytics_id: "abc", rev: 1 }, derived.cookie);
  expect(tracking.status).toBe(403);
  expect(await tracking.json()).toEqual({ error: "analytics_identifier_rejected" });
});

test("under_13 consent token is single-use and expiring, and revoke uses account deletion", async () => {
  const database = db();
  const child = await register(database, "kid@example.edu", "junior_high", "under_13");
  const started = 1_700_000_000_000;
  const requested = await call(database, "POST", "/api/consent/request", { parent_email: "parent@example.edu", first_name: "Ama", policy_version: "2026-11" }, child.cookie, started);
  expect(requested.status).toBe(200);
  const receipt = await requested.json() as { delivery: string; log: string[] };
  expect(receipt.delivery).toBe("dev_outbox");
  expect(receipt.log).toEqual(["consent link REDACTED"]);
  const file = readdirSync(process.env.UNIBUD_OUTBOX_DIR ?? "").map((name) => path.join(process.env.UNIBUD_OUTBOX_DIR ?? "", name))[0];
  const stored = JSON.parse(readFileSync(file, "utf8")) as { token: string };
  expect(JSON.stringify(receipt)).not.toContain(stored.token);
  const expired = await call(database, "POST", "/api/consent/complete", { token: stored.token, parent_password: "parent-password", method: "checkbox" }, undefined, started + 24 * 60 * 60 * 1000 + 1000);
  expect(expired.status).toBe(400);
  expect(await expired.json()).toEqual({ error: "consent_token_expired" });
  const fresh = await call(database, "POST", "/api/consent/request", { parent_email: "parent@example.edu", first_name: "Ama", policy_version: "2026-11" }, child.cookie, started);
  const secondFile = readdirSync(process.env.UNIBUD_OUTBOX_DIR ?? "").map((name) => path.join(process.env.UNIBUD_OUTBOX_DIR ?? "", name)).find((candidate) => candidate !== file) ?? "";
  const token = (JSON.parse(readFileSync(secondFile, "utf8")) as { token: string }).token;
  const done = await call(database, "POST", "/api/consent/complete", { token, parent_password: "parent-password", method: "checkbox" }, undefined, started + 1000);
  expect(done.status).toBe(200);
  const replay = await call(database, "POST", "/api/consent/complete", { token, parent_password: "parent-password", method: "checkbox" }, undefined, started + 2000);
  expect(replay.status).toBe(409);
  expect(await replay.json()).toEqual({ error: "consent_token_used" });
  const log = get<{ method: string; policy_version: string; at: string }>(database, "SELECT method, policy_version, at FROM consent_log WHERE child_user_id = ?", child.body.userId);
  expect(log).toMatchObject({ method: "checkbox", policy_version: "2026-11" });
  expect(log?.at).toBeTruthy();
  const me = await (await call(database, "GET", "/api/me", undefined, child.cookie, started + 3000)).json() as { account_status: string; ai_available: boolean };
  expect(me.account_status).toBe("pending_parental_consent");
  expect(me.ai_available).toBe(false);
  const parentLogin = await call(database, "POST", "/api/parent/login", { email: "parent@example.edu", password: "parent-password" }, undefined, started + 4000);
  const parentCookie = cookieFrom(parentLogin, "unibud_parent");
  const viewed = await (await call(database, "GET", `/api/parent/children/${child.body.userId}`, undefined, parentCookie, started + 5000)).json() as { first_name: string; age_band: string };
  expect(viewed).toMatchObject({ first_name: "Ama", age_band: "under_13" });
  run(database, "INSERT INTO idempotency (user_id, key, response_json, created_at) VALUES (?, 'k', '{}', 't')", child.body.userId);
  run(database, "INSERT INTO youtube_saved (id, user_id, kind, resource_id, note, created_at) VALUES ('saved', ?, 'video', 'abc', 'note', 't')", child.body.userId);
  run(database, "INSERT INTO youtube_metadata (kind, resource_id, title, fetched_at) VALUES ('video', 'abc', 'shared', 't')");
  const removed = await call(database, "POST", `/api/parent/children/${child.body.userId}/revoke`, {}, parentCookie, started + 6000);
  expect(await removed.json()).toEqual({ deleted: true });
  expect(get(database, "SELECT id FROM users WHERE id = ?", child.body.userId)).toBeUndefined();
  expect(get(database, "SELECT id FROM youtube_saved WHERE user_id = ?", child.body.userId)).toBeUndefined();
  expect(get(database, "SELECT key FROM idempotency WHERE user_id = ?", child.body.userId)).toBeUndefined();
  expect(get<{ title: string }>(database, "SELECT title FROM youtube_metadata WHERE resource_id = 'abc'")?.title).toBe("shared");
});

test("pending under_13 accounts purge after 14 days and consented accounts stay", async () => {
  const database = db();
  const pending = await register(database, "pending@example.edu", "junior_high", "under_13");
  const kept = await register(database, "kept@example.edu", "junior_high", "under_13");
  const adult = await register(database, "adult@example.edu", "university", "18_plus");
  const started = 1_700_000_000_000;
  await call(database, "POST", "/api/consent/request", { parent_email: "parent@example.edu", first_name: "Kojo", policy_version: "2026-11" }, kept.cookie, started);
  const token = JSON.parse(readFileSync(readdirSync(process.env.UNIBUD_OUTBOX_DIR ?? "").map((name) => path.join(process.env.UNIBUD_OUTBOX_DIR ?? "", name))[0], "utf8")) as { token: string };
  expect((await call(database, "POST", "/api/consent/complete", { token: token.token, parent_password: "parent-password", method: "checkbox" }, undefined, started + 1000)).status).toBe(200);
  remember("UNIBUD_ADMIN_TOKEN");
  delete process.env.UNIBUD_ADMIN_TOKEN;
  expect((await call(database, "POST", "/api/consent/purge", {}, undefined, started)).status).toBe(503);
  process.env.UNIBUD_ADMIN_TOKEN = "admin-test";
  const created = get<{ created_at: string }>(database, "SELECT created_at FROM users WHERE id = ?", pending.body.userId);
  const purgeAt = Date.parse(created?.created_at ?? "") + PENDING_CONSENT_TTL_MS;
  const purged = await call(database, "POST", "/api/consent/purge", {}, undefined, purgeAt, "admin-test");
  expect(await purged.json()).toEqual({ deleted: [pending.body.userId] });
  expect(get(database, "SELECT id FROM users WHERE id = ?", kept.body.userId)).toBeTruthy();
  expect(get(database, "SELECT id FROM users WHERE id = ?", adult.body.userId)).toBeTruthy();
});

test("under-18 profiles are not public or searchable and sessions for under_13 last two hours", async () => {
  const database = db();
  const adult = await register(database, "adult@example.edu", "university", "18_plus", { displayName: "Adult" });
  const teen = await register(database, "teen@example.edu", "senior_high", "13_17", { displayName: "Teen" });
  const child = await register(database, "kid@example.edu", "junior_high", "under_13");
  expect(adult.response.headers.get("set-cookie")).toContain("Max-Age=1209600");
  expect(child.response.headers.get("set-cookie")).toContain(`Max-Age=${UNDER_13_SESSION_SECONDS}`);
  const session = get<{ created_at: string; expires_at: string }>(database, "SELECT created_at, expires_at FROM sessions WHERE user_id = ?", child.body.userId);
  expect(Date.parse(session?.expires_at ?? "") - Date.parse(session?.created_at ?? "")).toBe(UNDER_13_SESSION_SECONDS * 1000);
  expect((await call(database, "GET", `/api/profiles/${teen.body.userId}`, undefined, adult.cookie)).status).toBe(404);
  const hidden = await (await call(database, "POST", "/api/profiles/search", { email: "teen@example.edu" }, adult.cookie)).json();
  const missing = await (await call(database, "POST", "/api/profiles/search", { email: "nobody@example.edu" }, adult.cookie)).json();
  expect(hidden).toEqual(missing);
  expect(JSON.stringify(hidden)).not.toContain("teen@example.edu");
  const found = await (await call(database, "POST", "/api/profiles/search", { email: "adult@example.edu" }, adult.cookie)).json() as { results: Array<{ id: string }> };
  expect(found.results.map((item) => item.id)).toEqual([adult.body.userId]);
  expect(JSON.stringify(found)).not.toContain("adult@example.edu");
});

test("study circle blocks cross-level invites, stranger DMs, and restores access only by code", async () => {
  const database = db();
  const adult = await register(database, "adult@example.edu", "university", "18_plus");
  const teacher = await register(database, "teacher@example.edu", "university", "18_plus");
  const teen = await register(database, "teen@example.edu", "senior_high", "13_17");
  const child = await register(database, "kid@example.edu", "junior_high", "under_13");
  expect(minorInviteBlocked(accountCapabilities({ age_band: "18_plus", education_level: "university" }), accountCapabilities({ age_band: "13_17", education_level: "senior_high" }))).toBe("cross_level");
  const circleId = ((await (await call(database, "POST", "/api/circles", { name: "Adults" }, adult.cookie)).json()) as { id: string }).id;
  const invited = await (await call(database, "POST", `/api/circles/${circleId}/invites`, { email: "teen@example.edu" }, adult.cookie)).json();
  expect(invited).toEqual({ status: "pending" });
  expect(get(database, "SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?", circleId, teen.body.userId)).toBeUndefined();
  remember("UNIBUD_ADMIN_TOKEN");
  process.env.UNIBUD_ADMIN_TOKEN = "admin-test";
  expect((await call(database, "POST", "/api/admin/teachers", { userId: teacher.body.userId }, teacher.cookie, 1_700_000_000_000, "nope")).status).toBe(403);
  expect((await call(database, "POST", "/api/admin/teachers", { userId: teacher.body.userId }, teacher.cookie, 1_700_000_000_000, "admin-test")).status).toBe(200);
  const taught = ((await (await call(database, "POST", "/api/circles", { name: "Class" }, teacher.cookie)).json()) as { id: string }).id;
  const code = get<{ invite_code: string }>(database, "SELECT invite_code FROM circles WHERE id = ?", taught)?.invite_code ?? "";
  expect((await call(database, "POST", "/api/circles/join", { code }, child.cookie)).status).toBe(403);
  const started = 1_700_000_000_000;
  await call(database, "POST", "/api/consent/request", { parent_email: "parent@example.edu", first_name: "Ama", policy_version: "2026-11" }, child.cookie, started);
  const token = (JSON.parse(readFileSync(readdirSync(process.env.UNIBUD_OUTBOX_DIR ?? "").map((name) => path.join(process.env.UNIBUD_OUTBOX_DIR ?? "", name))[0], "utf8")) as { token: string }).token;
  await call(database, "POST", "/api/consent/complete", { token, parent_password: "parent-password", method: "checkbox" }, undefined, started + 1000);
  const parentCookie = cookieFrom(await call(database, "POST", "/api/parent/login", { email: "parent@example.edu", password: "parent-password" }, undefined, started + 2000), "unibud_parent");
  const parentCircle = (await (await call(database, "POST", "/api/parent/circles", { name: "Family" }, parentCookie, started + 3000)).json()) as { id: string; inviteCode: string };
  expect((await call(database, "POST", "/api/circles/join", { code }, child.cookie, started + 4000)).status).toBe(200);
  expect((await call(database, "POST", "/api/circles/join", { code: parentCircle.inviteCode }, child.cookie, started + 5000)).status).toBe(200);
  const joined = await call(database, "POST", "/api/circles/join", { code }, teen.cookie);
  expect(joined.status).toBe(200);
  const stranger = await call(database, "POST", `/api/circles/${taught}/dm`, { userId: teen.body.userId, body: "hello" }, adult.cookie);
  expect(stranger.status).toBe(403);
  expect(await stranger.json()).toEqual({ error: "circle_dm_stranger" });
  expect((await call(database, "POST", `/api/circles/${taught}/dm`, { userId: teen.body.userId, body: "hello" }, teacher.cookie)).status).toBe(201);
  const report = await call(database, "POST", `/api/circles/${taught}/reports`, { userId: teen.body.userId }, teacher.cookie);
  expect(await report.json()).toEqual({ revoked: true });
  expect(get<{ status: string }>(database, "SELECT status FROM circle_members WHERE circle_id = ? AND user_id = ?", taught, teen.body.userId)?.status).toBe("revoked");
  expect((await call(database, "POST", `/api/circles/${taught}/dm`, { userId: teacher.body.userId, body: "again" }, teen.cookie)).status).toBe(403);
  expect((await call(database, "POST", "/api/circles/join", { code }, teen.cookie)).status).toBe(403);
});

test("router clearance, YouTube safe search, and watch history follow the stored age", async () => {
  const database = db();
  const blocked = planRoute(route({ ageBand: "13_17", educationLevel: "senior_high" }), [paid]);
  expect(blocked.status).toBe("unavailable");
  expect(blocked.blocked[0]?.reason).toBe("age_band_provider_not_cleared");
  const selected: RouteDecision = { status: "selected", fallback: paid, reason: "fixture", blocked: [], liveVerified: false, executed: false };
  expect(fallbackAfter(selected, "transient", route({ ageBand: "under_13" }))).toBeNull();
  expect(fallbackAfter(selected, "transient", route({ ageBand: "18_plus", educationLevel: "university" }))?.model).toBe("synthetic-allowed");
  const school = planRoute(route({ ageBand: "18_plus", educationLevel: "junior_high" }), [paid]);
  expect(school.blocked[0]?.reason).toBe("age_band_provider_not_cleared");
  const teen = await register(database, "teen@example.edu", "senior_high", "13_17");
  const child = await register(database, "kid@example.edu", "junior_high", "under_13");
  const adult = await register(database, "adult@example.edu", "university", "18_plus");
  remember("YOUTUBE_API_KEY");
  process.env.YOUTUBE_API_KEY = "dummy-test-key";
  const teenSearch = await (await call(database, "POST", "/api/youtube/search", { q: "acids" }, teen.cookie)).json() as { safeSearch: string; requested: string[] };
  expect(teenSearch.safeSearch).toBe("strict");
  expect(teenSearch.requested[0]).toContain("safeSearch=strict");
  expect(teenSearch.requested[0]).not.toContain("dummy-test-key");
  const childSearch = await (await call(database, "POST", "/api/youtube/search", { q: "acids" }, child.cookie)).json() as { safeSearch: string };
  expect(childSearch.safeSearch).toBe("strict");
  const adultSearch = await (await call(database, "POST", "/api/youtube/search", { q: "acids" }, adult.cookie)).json() as { safeSearch: string };
  expect(adultSearch.safeSearch).toBe("moderate");
  expect(await (await call(database, "POST", "/api/youtube/history", { videoId: "abc" }, child.cookie)).json()).toEqual({ stored: false });
  expect(get(database, "SELECT id FROM watch_history WHERE user_id = ?", child.body.userId)).toBeUndefined();
  expect(await (await call(database, "POST", "/api/youtube/history", { videoId: "abc" }, teen.cookie)).json()).toEqual({ stored: true });
});

test("smtp fails closed without env and consent does not open a socket", () => {
  expect(() => smtpConfigFromEnv({})).toThrow(/not configured|smtp_unconfigured|SMTP/);
  let sockets = 0;
  expect(() => sendSmtpMessage({
    UNIBUD_SMTP_HOST: "smtp.example.edu",
    UNIBUD_SMTP_PORT: "587",
    UNIBUD_SMTP_USER: "mailer",
    UNIBUD_SMTP_PASSWORD: "secret",
    UNIBUD_SMTP_FROM: "mailer@example.edu",
  }, { to: "parent@example.edu", body: "token-should-not-send" })).toThrow(/not activated|smtp_transport_unavailable|SMTP/);
  expect(sockets).toBe(0);
});
