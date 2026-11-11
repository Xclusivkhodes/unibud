import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, test } from "vitest";
import { get, openDatabase, run, type Db } from "../src/db.js";
import { bookmarkVideo, putYouTubeCache, readYouTubeCache, saveArtifact } from "../src/domain.js";
import { configuredGeminiModelIds, fallbackAfter, planRoute, REGISTRY, trainingBlock, type RegistryEntry, type RouteInput } from "../src/providers/registry.js";
import { runChatProvider } from "../src/providers/chat.js";
import { handleApi } from "../src/server/api.js";
import { handleNodeRequest } from "../src/server/node-http.js";
import { inflightKey, MAX_INFLIGHT, reserveInflight, resetInflightForTests } from "../src/server/limits.js";
import { databasePath, uploadRoot } from "../src/server/paths.js";
import { searchFromServerEnv } from "../src/youtube/api.js";
import { displaySavedYouTube, purgeExpiredYouTubeMetadata, readFreshYouTubeMetadata, saveYouTubeItem, writeYouTubeMetadata } from "../src/youtube/saved.js";

const dirs: string[] = [];
const previousUpload = process.env.UNIBUD_UPLOAD_DIR;
const previousDevice = process.env.UNIBUD_DEVICE_DIR;
const previousDb = process.env.UNIBUD_DB_PATH;
const previousInsecure = process.env.UNIBUD_COOKIE_INSECURE;
const previousYoutube = process.env.YOUTUBE_API_KEY;
const previousGemini = process.env.GEMINI_API_KEY;
const previousOpenAI = process.env.OPENAI_API_KEY;
const previousModels = process.env.UNIBUD_GEMINI_MODELS;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  restore("UNIBUD_UPLOAD_DIR", previousUpload);
  restore("UNIBUD_DEVICE_DIR", previousDevice);
  restore("UNIBUD_DB_PATH", previousDb);
  restore("UNIBUD_COOKIE_INSECURE", previousInsecure);
  restore("YOUTUBE_API_KEY", previousYoutube);
  restore("GEMINI_API_KEY", previousGemini);
  restore("OPENAI_API_KEY", previousOpenAI);
  restore("UNIBUD_GEMINI_MODELS", previousModels);
  resetInflightForTests();
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-remediation-"));
  dirs.push(dir);
  const file = path.join(dir, "unibud.sqlite");
  process.env.UNIBUD_DB_PATH = file;
  process.env.UNIBUD_UPLOAD_DIR = path.join(dir, "uploads");
  process.env.UNIBUD_DEVICE_DIR = path.join(dir, "device");
  return openDatabase(file);
}

function withSignup(pathname: string, body?: unknown): unknown {
  if (pathname !== "/api/auth/register" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  return { education_level: "university", age_band: "18_plus", ...(body as Record<string, unknown>) };
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string, source = "198.51.100.10") {
  const headers = new Headers({ host: "127.0.0.1:3000", "x-unibud-request": "1" });
  if (cookie) headers.set("cookie", cookie);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(withSignup(pathname, body)) }), database, { source });
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

test("default data paths stay under .data unless env overrides them", () => {
  delete process.env.UNIBUD_DB_PATH;
  delete process.env.UNIBUD_UPLOAD_DIR;
  expect(databasePath()).toBe(path.join(".data", "unibud.sqlite"));
  expect(uploadRoot()).toBe(path.join(".data", "uploads"));
  process.env.UNIBUD_DB_PATH = "/tmp/explicit.sqlite";
  process.env.UNIBUD_UPLOAD_DIR = "/tmp/explicit-uploads";
  expect(databasePath()).toBe("/tmp/explicit.sqlite");
  expect(uploadRoot()).toBe("/tmp/explicit-uploads");
});

test("account deletion removes owned files and saved youtube ids but not the shared cache", async () => {
  const database = db();
  const created = await call(database, "POST", "/api/auth/register", { email: "gone@example.edu", password: "password123" });
  const cookie = cookieFrom(created);
  const userId = ((await created.json()) as { userId: string }).userId;
  expect((created.headers.get("set-cookie") ?? "").includes("Secure")).toBe(true);
  const upload = await call(database, "POST", "/api/uploads", { declaredMime: "text/plain", dataBase64: Buffer.from("notes").toString("base64") }, cookie);
  expect(upload.status).toBe(201);
  expect((await call(database, "POST", "/api/device/notes", { artifactId: "note-1", body: "local", rev: 0 }, cookie)).status).toBe(201);
  expect((await call(database, "POST", "/api/decks", { title: "Once", idempotencyKey: "deck-key" }, cookie)).status).toBe(201);
  const saved = saveYouTubeItem(database, userId, { kind: "video", resourceId: "abcdefghijk", note: "keep this note" });
  bookmarkVideo(database, userId, { videoId: "abcdefghijk", note: "bookmark note" });
  putYouTubeCache(database, "sharedcache1", { title: "Shared" }, "2026-03-10T00:00:00.000Z");
  writeYouTubeMetadata(database, { kind: "video", resourceId: "abcdefghijk", title: "Snap", channel: "Channel", thumbnailUrl: null, fetchedAt: "2026-03-10T00:00:00.000Z" });
  const removed = await call(database, "DELETE", "/api/account", undefined, cookie);
  expect(removed.status).toBe(200);
  expect(existsSync(path.join(process.env.UNIBUD_UPLOAD_DIR ?? "", userId))).toBe(false);
  expect(existsSync(path.join(process.env.UNIBUD_DEVICE_DIR ?? "", `${userId}.json`))).toBe(false);
  expect(get(database, "SELECT 1 FROM idempotency WHERE user_id = ?", userId)).toBeUndefined();
  expect(get(database, "SELECT 1 FROM youtube_saved WHERE id = ?", saved.id)).toBeUndefined();
  expect(get(database, "SELECT 1 FROM video_bookmarks WHERE user_id = ?", userId)).toBeUndefined();
  expect(readYouTubeCache(database, "sharedcache1", "2026-03-15T00:00:00.000Z")).toEqual({ title: "Shared" });
  expect(readFreshYouTubeMetadata(database, "video", "abcdefghijk", "2026-03-15T00:00:00.000Z")?.title).toBe("Snap");
});

test("stale saved metadata is excluded and display refreshes through the mock transport", async () => {
  const database = db();
  const userId = ((await (await call(database, "POST", "/api/auth/register", { email: "yt@example.edu", password: "password123" })).json()) as { userId: string }).userId;
  const saved = saveYouTubeItem(database, userId, { kind: "video", resourceId: "abcdefghijk", note: "learner note" });
  saveYouTubeItem(database, userId, { kind: "playlist", resourceId: "PLabcdefghij", note: "playlist note" });
  writeYouTubeMetadata(database, { kind: "video", resourceId: "abcdefghijk", title: "Stale title", channel: "Old", thumbnailUrl: null, fetchedAt: "2026-01-01T00:00:00.000Z" });
  const now = "2026-03-15T00:00:00.000Z";
  expect(readFreshYouTubeMetadata(database, "video", "abcdefghijk", now)).toBeNull();
  expect(purgeExpiredYouTubeMetadata(database, now)).toBe(1);
  writeYouTubeMetadata(database, { kind: "video", resourceId: "abcdefghijk", title: "Stale title", channel: "Old", thumbnailUrl: null, fetchedAt: "2026-01-01T00:00:00.000Z" });
  delete process.env.YOUTUBE_API_KEY;
  const blocked = await displaySavedYouTube(database, userId, saved.id, now);
  expect(blocked.saved.note).toBe("learner note");
  expect(blocked.metadata).toBeNull();
  expect(blocked.metadataState).toBe("unconfigured");
  process.env.YOUTUBE_API_KEY = "dummy-test-key";
  let calls = 0;
  const shown = await displaySavedYouTube(database, userId, saved.id, now, async (url) => {
    calls += 1;
    expect(url).toContain("key=dummy-test-key");
    return { ok: true, json: async () => ({ items: [{ snippet: { title: "Refreshed", channelTitle: "Channel" } }] }) };
  });
  expect(calls).toBe(1);
  expect(shown.metadata?.title).toBe("Refreshed");
  expect(JSON.stringify(shown)).not.toContain("dummy-test-key");
  expect(shown.saved.note).toBe("learner note");
  const again = await displaySavedYouTube(database, userId, saved.id, now, async () => {
    throw new Error("fresh metadata must not refetch");
  });
  expect(again.metadataState).toBe("fresh");
  expect(get<{ note: string }>(database, "SELECT note FROM youtube_saved WHERE id = ?", saved.id)?.note).toBe("learner note");
});

test("youtube server search is unconfigured without the env key and redacts it when mocked", async () => {
  delete process.env.YOUTUBE_API_KEY;
  let calls = 0;
  const missing = await searchFromServerEnv({ query: "acids", transport: async () => { calls += 1; return { ok: true, json: async () => ({}) }; } });
  expect(missing.status).toBe("unconfigured");
  expect(calls).toBe(0);
  process.env.YOUTUBE_API_KEY = "dummy-test-key";
  const found = await searchFromServerEnv({
    query: "acids",
    transport: async (url) => {
      expect(url).toContain("key=dummy-test-key");
      if (url.includes("/search")) return { ok: true, json: async () => ({ items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Title" } }] }) };
      return { ok: true, json: async () => ({ items: [{ id: "abcdefghijk", snippet: { title: "Title", channelTitle: "Channel" } }] }) };
    },
  });
  expect(found.status).toBe("ok");
  expect(JSON.stringify(found)).not.toContain("dummy-test-key");
});

test("oversized chunked bodies are rejected before parse", async () => {
  const database = db();
  const cookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "wide@example.edu", password: "password123" }));
  const chunk = new Uint8Array(60_000);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 2) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += 1;
    },
  });
  const denied = await handleApi(new Request("http://127.0.0.1:3000/api/labs/projectile", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "x-unibud-request": "1", cookie, "content-length": "2", "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit), database);
  expect(denied.status).toBe(413);
  expect(await denied.json()).toEqual({ error: "body_too_large" });
  expect(denied.headers.get("cache-control")).toContain("no-store");

  const incoming = Readable.from([Buffer.alloc(60_000), Buffer.alloc(60_000)]) as IncomingMessage;
  incoming.method = "POST";
  incoming.url = "/api/labs/projectile";
  incoming.headers = { host: "127.0.0.1:3000", "content-length": "2", "x-unibud-request": "1" };
  let status = 0;
  let raw = "";
  const outgoing = {
    writeHead(code: number) { status = code; },
    end(payload?: string | Uint8Array) { raw = Buffer.from(payload ?? "").toString("utf8"); },
  } as ServerResponse;
  await handleNodeRequest(incoming, outgoing, () => { throw new Error("database should not open"); });
  expect(status).toBe(413);
  expect(JSON.parse(raw)).toEqual({ error: "body_too_large" });
});

test("one source cannot fill the inflight bucket for every account", async () => {
  const database = db();
  const victimCookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "victim@example.edu", password: "password123" }, undefined, "198.51.100.20"));
  expect(victimCookie.startsWith("unibud_session=")).toBe(true);
  const attacker = inflightKey({ email: "attacker@example.edu", source: "203.0.113.8" });
  for (let count = 0; count < MAX_INFLIGHT; count += 1) reserveInflight(attacker);
  const victim = await call(database, "POST", "/api/auth/login", { email: "victim@example.edu", password: "password123" }, undefined, "198.51.100.20");
  expect(victim.status).toBe(200);
  const sameSource = await call(database, "POST", "/api/auth/login", { email: "victim@example.edu", password: "password123" }, undefined, "203.0.113.8");
  expect(sameSource.status).toBe(200);
  const locked = await call(database, "POST", "/api/auth/login", { email: "attacker@example.edu", password: "password123" }, undefined, "203.0.113.8");
  expect(locked.status).toBe(429);
  expect(await locked.json()).toEqual({ error: "busy" });
});

test("invites hide whether the email exists and the session cookie is secure by default", async () => {
  const database = db();
  const owner = await call(database, "POST", "/api/auth/register", { email: "owner@example.edu", password: "password123" });
  const ownerCookie = cookieFrom(owner);
  const member = await call(database, "POST", "/api/auth/register", { email: "member@example.edu", password: "password123" });
  const memberId = ((await member.json()) as { userId: string }).userId;
  const circle = ((await (await call(database, "POST", "/api/circles", { name: "Group" }, ownerCookie)).json()) as { id: string }).id;
  const known = await (await call(database, "POST", `/api/circles/${circle}/invites`, { email: "member@example.edu" }, ownerCookie)).json();
  const unknown = await (await call(database, "POST", `/api/circles/${circle}/invites`, { email: "missing@example.edu" }, ownerCookie)).json();
  expect(known).toEqual({ status: "pending" });
  expect(unknown).toEqual(known);
  expect(JSON.stringify(known)).not.toContain(memberId);
  expect(JSON.stringify(unknown)).not.toContain(memberId);
  process.env.UNIBUD_COOKIE_INSECURE = "1";
  const local = await call(database, "POST", "/api/auth/login", { email: "owner@example.edu", password: "password123" });
  expect(local.headers.get("set-cookie") ?? "").not.toContain("Secure");
});

test("training policy blocks unpaid or unknown models and fallback rechecks eligibility", () => {
  const unpaid = { ...REGISTRY[0], privacy: { ...REGISTRY[0].privacy, training: "unpaid_may_train" as const } };
  expect(trainingBlock(unpaid)).toBe("training_unpaid_or_unknown_denied");
  const unknown: RegistryEntry = {
    provider: "openai",
    model: "synthetic-unknown",
    host: "api.openai.com",
    documentedCapabilities: ["text"],
    capabilityStatus: "documented",
    contextTokens: null,
    outputTokenLimit: null,
    latency: null,
    cost: null,
    privacy: { training: "unknown", retention: "not_zero_retention" },
    residency: "unspecified",
    sourceUrl: "test",
    evidenceId: "TEST",
    liveVerified: false,
    operational: false,
  };
  const allowed: RegistryEntry = { ...unknown, model: "synthetic-allowed", privacy: { training: "no_training_by_default", retention: "not_zero_retention" } };
  const input: RouteInput = {
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
  };
  expect(planRoute({ ...input, allowPaidProviders: false }, [allowed]).status).toBe("unavailable");
  const denied = planRoute(input, [unknown, allowed]);
  expect(denied.primary?.model).toBe("synthetic-allowed");
  expect(denied.blocked.some((item) => item.reason === "training_unpaid_or_unknown_denied")).toBe(true);
  const plan = planRoute(input, [allowed, { ...allowed, model: "synthetic-fallback" }]);
  expect(fallbackAfter(plan, "transient", { ...input, grants: [] })).toBeNull();
  expect(fallbackAfter(plan, "transient", input)?.model).toBe("synthetic-fallback");
  expect(REGISTRY.some((entry) => entry.model.includes("gemini-2.5") || entry.model === "gemini-4-argon")).toBe(false);
  process.env.UNIBUD_GEMINI_MODELS = "gemini-2.5-flash, gemma-4-26b-a4b-it";
  expect(configuredGeminiModelIds()).toEqual(["gemma-4-26b-a4b-it"]);
});

test("gemini and chat fail closed without server keys and do not echo a dummy key", async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  const database = db();
  const cookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "gem@example.edu", password: "password123" }));
  const providers = await call(database, "GET", "/api/providers", undefined, cookie);
  const body = (await providers.json()) as { providers: Array<{ provider: string; configured: boolean; blockReason: string | null }> };
  expect(body.providers.filter((item) => item.provider === "google").every((item) => item.configured === false && (item.blockReason ?? "").includes("unconfigured") && (item.blockReason ?? "").includes("google_api_client_directed_at_or_likely_accessed_by_under_18"))).toBe(true);
  const chatId = ((await (await call(database, "POST", "/api/chats", { title: "Q" }, cookie)).json()) as { id: string }).id;
  const asked = await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "What is pH?" }, cookie);
  const askedBody = (await asked.json()) as { providerTurn: { status: string; text: string | null } };
  expect(askedBody.providerTurn).toEqual({ status: "unconfigured", text: null, executed: false, fixture: false, billing: "not_sent" });
  process.env.OPENAI_API_KEY = "dummy-test-key";
  const held = await runChatProvider({
    prompt: "explain",
    grants: ["openai"],
    route: { retention: "vendor_default_allowed", sensitivity: "ordinary", audience: "adults_not_directed_at_minors", billingTier: "paid", allowPaidProviders: true },
    catalog: [{
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
    }],
    transport: async (request) => {
      expect(request.headers.authorization).toBe("Bearer dummy-test-key");
      return { status: 200, body: { choices: [{ message: { content: "answer dummy-test-key" } }] } };
    },
  });
  expect(held.text).toBe("answer [redacted]");
  expect(JSON.stringify(held)).not.toContain("dummy-test-key");
});

test("sync conflict keeps the artifact and uses the error envelope", async () => {
  const database = db();
  const created = await call(database, "POST", "/api/auth/register", { email: "sync@example.edu", password: "password123" });
  const cookie = cookieFrom(created);
  const userId = ((await created.json()) as { userId: string }).userId;
  const course = ((await (await call(database, "POST", "/api/courses", { name: "Chem" }, cookie)).json()) as { course: { id: string } }).course;
  const artifact = saveArtifact(database, userId, { courseId: course.id, kind: "note", title: "Note", body: "original", label: "learner_authored" }) as { id: string; rev: number; body: string };
  expect((await call(database, "POST", "/api/device/notes", { artifactId: artifact.id, body: "local", rev: artifact.rev }, cookie)).status).toBe(201);
  const conflict = await call(database, "POST", `/api/device/notes/${artifact.id}/sync`, { rev: artifact.rev + 5, body: "stale", idempotencyKey: "sync-conflict" }, cookie);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "sync_conflict" });
  expect(get<{ body: string }>(database, "SELECT body FROM artifacts WHERE id = ?", artifact.id)?.body).toBe("original");
  run(database, "DELETE FROM sync_log WHERE user_id = ?", userId);
});
