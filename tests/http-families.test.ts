import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { openDatabase, type Db } from "../src/db.js";
import { createCourse, saveArtifact } from "../src/domain.js";
import { handleApi } from "../src/server/api.js";
import { internalErrorHeaders } from "../src/server/http.js";
import * as bridge from "../src/app/api/[[...path]]/route.js";
import { buildPlaylistItemsUrl, buildPlaylistListUrl, buildSearchListUrl, buildVideosListUrl, runMockedPlaylist, runMockedSearch } from "../src/youtube/api.js";
import { executeProvider, normalizeStatus, runMockEval } from "../src/providers/execute.js";

const dirs: string[] = [];
const previousUpload = process.env.UNIBUD_UPLOAD_DIR;
const previousDevice = process.env.UNIBUD_DEVICE_DIR;
const previousDb = process.env.UNIBUD_DB_PATH;
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (previousUpload === undefined) delete process.env.UNIBUD_UPLOAD_DIR;
  else process.env.UNIBUD_UPLOAD_DIR = previousUpload;
  if (previousDevice === undefined) delete process.env.UNIBUD_DEVICE_DIR;
  else process.env.UNIBUD_DEVICE_DIR = previousDevice;
  if (previousDb === undefined) delete process.env.UNIBUD_DB_PATH;
  else process.env.UNIBUD_DB_PATH = previousDb;
});

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-http-"));
  dirs.push(dir);
  const file = path.join(dir, "unibud.sqlite");
  process.env.UNIBUD_DB_PATH = file;
  process.env.UNIBUD_UPLOAD_DIR = path.join(dir, "uploads");
  process.env.UNIBUD_DEVICE_DIR = path.join(dir, "device");
  return openDatabase(file);
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string) {
  const headers = new Headers({ host: "127.0.0.1:3000", "x-unibud-request": "1" });
  if (cookie) headers.set("cookie", cookie);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), database);
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function account(database: Db, email: string) {
  return cookieFrom(await call(database, "POST", "/api/auth/register", { email, password: "password123" }));
}

async function bodyOf(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("resource routes keep owner access and reject the other account", async () => {
  const database = db();
  const owner = await account(database, "owner@example.edu");
  const other = await account(database, "other@example.edu");
  const course = ((await bodyOf(await call(database, "POST", "/api/courses", { name: "Chem" }, owner))) as { course: { id: string; subject_name: string } }).course;
  expect(course.subject_name).toBe("");
  expect("subjectName" in course).toBe(false);

  const lab = await call(database, "POST", "/api/labs/projectile", { speed: 10, degrees: 45, idempotencyKey: "lab-1" }, owner);
  expect(lab.status).toBe(201);
  const labAgain = await call(database, "POST", "/api/labs/projectile", { speed: 10, degrees: 45, idempotencyKey: "lab-1" }, owner);
  const labId = ((await bodyOf(lab)) as { id: string }).id;
  expect(((await bodyOf(labAgain)) as { id: string }).id).toBe(labId);
  expect((await call(database, "GET", `/api/labs/${labId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/labs/${labId}`, undefined, other)).status).toBe(404);
  expect((await call(database, "POST", "/api/labs/projectile", { speed: -1, degrees: 10 }, owner)).status).toBe(400);

  const game = await call(database, "POST", "/api/games/built-in", { answers: ["projectile", "ph"], idempotencyKey: "game-1" }, owner);
  expect(game.status).toBe(201);
  const gameId = ((await bodyOf(game)) as { id: string; learningClaim: string }).id;
  expect(((await bodyOf(await call(database, "POST", "/api/games/built-in", { answers: ["projectile", "ph"], idempotencyKey: "game-1" }, owner))) as { id: string }).id).toBe(gameId);
  expect((await call(database, "GET", `/api/games/${gameId}`, undefined, other)).status).toBe(404);

  const chat = await call(database, "POST", "/api/chats", { title: "Old", idempotencyKey: "chat-1" }, owner);
  const chatId = ((await bodyOf(chat)) as { id: string }).id;
  expect(typeof bridge.PATCH).toBe("function");
  const patched = await bridge.PATCH(new Request(`http://127.0.0.1:3000/api/chats/${chatId}`, { method: "PATCH", headers: { host: "127.0.0.1:3000", "x-unibud-request": "1", cookie: owner, "content-type": "application/json" }, body: JSON.stringify({ title: "New" }) }));
  expect(patched.status).toBe(200);
  expect((await call(database, "PATCH", `/api/chats/${chatId}`, { title: "Stolen" }, other)).status).toBe(404);
  const asked = await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "What is pH?", idempotencyKey: "msg-1" }, owner);
  const askedBody = await bodyOf(asked);
  expect((askedBody.providerTurn as { status: string }).status).toBe("not_executed");
  expect((await call(database, "GET", `/api/chats/${chatId}/messages`, undefined, other)).status).toBe(404);

  const upload = await call(database, "POST", "/api/uploads", { declaredMime: "text/plain", dataBase64: Buffer.from("notes").toString("base64"), idempotencyKey: "up-1" }, owner);
  expect(upload.status).toBe(201);
  const uploadId = ((await bodyOf(upload)) as { id: string }).id;
  expect((await call(database, "GET", `/api/uploads/${uploadId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/uploads/${uploadId}`, undefined, other)).status).toBe(404);
  const zip = await call(database, "POST", "/api/uploads", { declaredMime: "text/plain", dataBase64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64") }, owner);
  expect(((await bodyOf(zip)) as { error: string }).error).toBe("compressed_not_accepted");

  const node = await call(database, "POST", "/api/graph/nodes", { label: "Acid", idempotencyKey: "node-1" }, owner);
  const nodeId = ((await bodyOf(node)) as { id: string }).id;
  expect((await call(database, "GET", `/api/graph/nodes/${nodeId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/graph/nodes/${nodeId}`, undefined, other)).status).toBe(404);
  const edge = await call(database, "POST", "/api/graph/edges", { fromId: nodeId, toId: nodeId, origin: "learner", idempotencyKey: "edge-1" }, owner);
  expect(edge.status).toBe(201);

  const lens = await call(database, "POST", "/api/lens", { mode: "text", consent: false }, owner);
  expect(lens.status).toBe(200);
  expect((await bodyOf(lens)).interpretation).toBeNull();
  const unsigned = await handleApi(new Request("http://127.0.0.1:3000/api/labs"), database);
  expect(unsigned.status).toBe(401);
  expect(unsigned.headers.get("cache-control")).toContain("no-store");

  const artifactId = "device-note-1";
  expect((await call(database, "POST", "/api/device/notes", { artifactId, body: "local", rev: 0 }, owner)).status).toBe(201);
  expect((await call(database, "GET", `/api/device/notes/${artifactId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/device/notes/${artifactId}`, undefined, other)).status).toBe(404);

  const session = await call(database, "POST", "/api/sessions", { kind: "study", idempotencyKey: "sess-1" }, owner);
  const sessionId = ((await bodyOf(session)) as { id: string }).id;
  expect(((await bodyOf(await call(database, "POST", "/api/sessions", { kind: "study", idempotencyKey: "sess-1" }, owner))) as { id: string }).id).toBe(sessionId);
  expect((await call(database, "GET", `/api/sessions/${sessionId}`, undefined, other)).status).toBe(404);
  expect((await call(database, "POST", `/api/sessions/${sessionId}/pause`, { pausedMs: 1000 }, other)).status).toBe(404);
});

test("cram preview tokens are owned, exact, stale, and single use", async () => {
  const database = db();
  const owner = await account(database, "cram-owner@example.edu");
  const other = await account(database, "cram-other@example.edu");
  const courseId = ((await bodyOf(await call(database, "POST", "/api/courses", { name: "Course" }, owner))) as { course: { id: string } }).course.id;
  await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "Topic" }, owner);
  const missing = await call(database, "POST", "/api/cram/confirm", {}, owner);
  expect(missing.status).toBe(400);
  expect(await bodyOf(missing)).toEqual({ error: "preview_required" });
  const absent = await call(database, "POST", "/api/cram/confirm", { previewId: "missing" }, owner);
  expect(absent.status).toBe(404);
  expect(await bodyOf(absent)).toEqual({ error: "preview_not_found" });
  const preview = await call(database, "POST", "/api/cram/preview", { courseId, title: "Exam", examDate: "2026-11-20", availableHours: 2, syllabus: "topic", now: "2026-11-09T15:00:00.000Z" }, owner);
  const shown = (await bodyOf(preview)) as { previewId: string; priorities: Array<{ dueAt: string | null; dueDay: string | null }> };
  expect((await call(database, "POST", "/api/cram/confirm", { previewId: shown.previewId }, other)).status).toBe(404);
  await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "Added" }, owner);
  const stale = await call(database, "POST", "/api/cram/confirm", { previewId: shown.previewId }, owner);
  expect(stale.status).toBe(409);
  expect(await bodyOf(stale)).toEqual({ error: "stale_preview" });
  const fresh = await call(database, "POST", "/api/cram/preview", { courseId, title: "Exam", examDate: "2026-11-20", availableHours: 2, syllabus: "topic", now: "2026-11-09T15:00:00.000Z" }, owner);
  const exact = (await bodyOf(fresh)) as { previewId: string; priorities: Array<{ dueAt: string | null }> };
  const confirmed = await call(database, "POST", "/api/cram/confirm", { previewId: exact.previewId }, owner);
  expect(confirmed.status).toBe(201);
  const tasks = ((await bodyOf(await call(database, "GET", "/api/tasks", undefined, owner))) as { tasks: Array<{ due_at: string | null }> }).tasks;
  const expected = exact.priorities.map((item) => item.dueAt).filter((due): due is string => Boolean(due)).sort();
  expect(tasks.map((task) => task.due_at).filter((due): due is string => Boolean(due)).sort()).toEqual(expected);
  const replay = await call(database, "POST", "/api/cram/confirm", { previewId: exact.previewId }, owner);
  expect(replay.status).toBe(409);
  expect(await bodyOf(replay)).toEqual({ error: "preview_consumed" });
  const impossible = await call(database, "POST", "/api/cram/preview", { courseId, title: "Past", examDate: "2026-11-01", availableHours: 3, syllabus: "", now: "2026-11-09T15:00:00.000Z" }, owner);
  const impossibleBody = (await bodyOf(impossible)) as { previewId: string; impossible: boolean; priorities: Array<{ dueAt: string | null }> };
  expect(impossibleBody.impossible).toBe(true);
  expect(impossibleBody.priorities.every((item) => item.dueAt === null)).toBe(true);
  const saved = await call(database, "POST", "/api/cram/confirm", { previewId: impossibleBody.previewId }, owner);
  expect(((await bodyOf(saved)) as { taskIds: string[] }).taskIds).toEqual([]);
});

test("youtube builders stay on the data api and mocked providers do not call google", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("live network is not used");
  };
  try {
    const requested: string[] = [];
    const fetchImpl = async (url: string, init: { redirect: "error" }) => {
      expect(init.redirect).toBe("error");
      requested.push(url);
      if (url.includes("/search")) return { ok: true, json: async () => ({ items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Title" } }] }) };
      if (url.includes("/videos")) return { ok: true, json: async () => ({ items: [{ id: "abcdefghijk", snippet: { title: "Title", channelTitle: "Channel" } }] }) };
      if (url.includes("/playlists")) return { ok: true, json: async () => ({ items: [{ contentDetails: { itemCount: 1 } }] }) };
      return { ok: true, json: async () => ({ items: [{ contentDetails: { videoId: "abcdefghijk" } }] }) };
    };
    const search = await runMockedSearch({ apiKey: "dummy-test-key", query: "acids", fetchImpl });
    expect(new URL(search.requested[0]).pathname).toBe("/youtube/v3/search");
    expect(new URL(search.requested[1]).pathname).toBe("/youtube/v3/videos");
    expect(search.requested.join(" ")).not.toContain("dummy-test-key");
    expect(search.requested.some((url) => url.includes("/captions"))).toBe(false);
    expect(search.status).toBe("ok");
    if (search.status !== "ok") throw new Error("fixture search did not return cards");
    expect(JSON.stringify(search.cards)).not.toContain("dummy-test-key");
    expect(search.cards[0].duration).toBeNull();
    expect(search.cards[0].qualityScore).toBeNull();
    expect(buildSearchListUrl("acids", "dummy-test-key").hostname).toBe("www.googleapis.com");
    expect(buildSearchListUrl("acids", "dummy-test-key").searchParams.get("videoEmbeddable")).toBe("true");
    expect(buildVideosListUrl(["abcdefghijk"], "dummy-test-key").searchParams.get("part")).toBe("snippet,contentDetails,status");
    const playlist = await runMockedPlaylist({ apiKey: "dummy-test-key", playlistId: "PLxxxx", fetchImpl });
    expect(playlist.aggregateDuration).toBe("not_computed_policy_blocked");
    expect(playlist.requested.join(" ")).not.toContain("dummy-test-key");
    expect(new URL(buildPlaylistListUrl("PLxxxx", "k")).pathname).toBe("/youtube/v3/playlists");
    expect(new URL(buildPlaylistItemsUrl("PLxxxx", "k")).searchParams.get("maxResults")).toBe("50");
    const evaluated = await runMockEval([{ id: "g", provider: "google", model: "gemma-4-26b-a4b-it", prompt: "x", status: 200 }]);
    expect(evaluated[0].transportCalls).toBe(0);
    expect(evaluated[0].score).toBeNull();
    expect(normalizeStatus(429, false)).toEqual({ code: "rate_limited", retryable: true });
    const aborted = new AbortController();
    aborted.abort();
    expect((await executeProvider({ provider: "openai", model: "synthetic", prompt: "x", signal: aborted.signal })).status).toBe("cancelled");
    expect(requested.every((url) => url.startsWith("https://www.googleapis.com/") && url.includes("key=dummy-test-key"))).toBe(true);
    expect(buildSearchListUrl("acids", "dummy-test-key").searchParams.get("part")).toBe("snippet");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("remaining owned routes are visible to the owner and hidden from the other account", async () => {
  const database = db();
  const ownerResponse = await call(database, "POST", "/api/auth/register", { email: "owner2@example.edu", password: "password123" });
  const owner = cookieFrom(ownerResponse);
  const ownerId = ((await bodyOf(ownerResponse)) as { userId: string }).userId;
  const other = await account(database, "other2@example.edu");
  const course = createCourse(database, ownerId, { name: "Owned" }) as { id: string };
  const listed = await call(database, "GET", `/api/courses/${course.id}`, undefined, owner);
  const summary = ((await bodyOf(listed)) as { course: { subject_name: string; user_id?: string } }).course;
  expect(summary.subject_name).toBe("");
  expect(summary.user_id).toBeUndefined();

  const deck = ((await bodyOf(await call(database, "POST", "/api/decks", { title: "Facts" }, owner))) as { deck: { id: string } }).deck;
  const card = await call(database, "POST", `/api/decks/${deck.id}/cards`, { front: "Q", back: "A" }, owner);
  expect(card.status).toBe(201);
  const cardId = ((await bodyOf(card)) as { card: { id: string } }).card.id;
  expect((await call(database, "POST", `/api/decks/${deck.id}/cards`, { front: "no", back: "no" }, other)).status).toBe(404);
  const review = await call(database, "POST", `/api/cards/${cardId}/reviews`, { quality: 5, revealed: true }, owner);
  expect(review.status).toBe(201);
  const hiddenReview = await call(database, "POST", `/api/cards/${cardId}/reviews`, { quality: 5, revealed: true }, other);
  expect(hiddenReview.status).toBe(404);
  expect(hiddenReview.headers.get("cache-control")).toContain("no-store");
  expect(hiddenReview.headers.get("access-control-allow-origin")).toBeNull();
  const ownerCards = ((await bodyOf(await call(database, "GET", "/api/cards", undefined, owner))) as { cards: Array<{ id: string }> }).cards;
  const otherCards = ((await bodyOf(await call(database, "GET", "/api/cards", undefined, other))) as { cards: Array<{ id: string }> }).cards;
  expect(ownerCards.some((item) => item.id === cardId)).toBe(true);
  expect(otherCards.some((item) => item.id === cardId)).toBe(false);

  const game = await call(database, "POST", "/api/games/built-in", { answers: ["projectile", "ph"] }, owner);
  const gameId = ((await bodyOf(game)) as { id: string }).id;
  expect((await call(database, "GET", `/api/games/${gameId}`, undefined, owner)).status).toBe(200);
  const ownerGames = ((await bodyOf(await call(database, "GET", "/api/games", undefined, owner))) as { results: Array<{ id: string }> }).results;
  const otherGames = ((await bodyOf(await call(database, "GET", "/api/games", undefined, other))) as { results: Array<{ id: string }> }).results;
  expect(ownerGames.some((item) => item.id === gameId)).toBe(true);
  expect(otherGames.some((item) => item.id === gameId)).toBe(false);

  const lab = await call(database, "POST", "/api/labs/projectile", { speed: 12, degrees: 30 }, owner);
  const labId = ((await bodyOf(lab)) as { id: string }).id;
  const ownerLabs = ((await bodyOf(await call(database, "GET", "/api/labs", undefined, owner))) as { runs: Array<{ id: string }> }).runs;
  const otherLabs = ((await bodyOf(await call(database, "GET", "/api/labs", undefined, other))) as { runs: Array<{ id: string }> }).runs;
  expect(ownerLabs.some((item) => item.id === labId)).toBe(true);
  expect(otherLabs.some((item) => item.id === labId)).toBe(false);

  const chatId = ((await bodyOf(await call(database, "POST", "/api/chats", { title: "Chat" }, owner))) as { id: string }).id;
  expect((await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "pH?" }, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/chats/${chatId}/messages`, undefined, owner)).status).toBe(200);
  expect((await call(database, "POST", `/api/chats/${chatId}/messages`, { question: "steal" }, other)).status).toBe(404);
  expect((await call(database, "DELETE", `/api/chats/${chatId}`, undefined, other)).status).toBe(404);
  expect((await call(database, "DELETE", `/api/chats/${chatId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "GET", `/api/chats/${chatId}/messages`, undefined, owner)).status).toBe(404);

  const uploadDir = process.env.UNIBUD_UPLOAD_DIR ?? "";
  const upload = await call(database, "POST", "/api/uploads", { declaredMime: "text/plain", dataBase64: Buffer.from("notes").toString("base64") }, owner);
  const uploadBody = JSON.stringify(await bodyOf(upload));
  expect(uploadBody).not.toContain(uploadDir);
  expect(uploadBody).not.toContain(".data");
  expect(uploadBody).not.toContain("storagePath");
  const uploadId = (JSON.parse(uploadBody) as { id: string }).id;
  const file = await call(database, "GET", `/api/uploads/${uploadId}`, undefined, owner);
  expect([...file.headers.entries()].join(" ")).not.toContain(uploadDir);

  const nodeId = ((await bodyOf(await call(database, "POST", "/api/graph/nodes", { label: "Acid" }, owner))) as { id: string }).id;
  const ownerGraph = (await bodyOf(await call(database, "GET", "/api/graph", undefined, owner))) as { nodes: Array<{ id: string }>; edges: Array<{ id: string }> };
  const otherGraph = (await bodyOf(await call(database, "GET", "/api/graph", undefined, other))) as { nodes: Array<{ id: string }>; edges: Array<{ id: string }> };
  expect(ownerGraph.nodes.some((item) => item.id === nodeId)).toBe(true);
  expect(otherGraph.nodes.some((item) => item.id === nodeId)).toBe(false);
  const foreignEdge = await call(database, "POST", "/api/graph/edges", { fromId: nodeId, toId: nodeId, origin: "learner" }, other);
  expect(foreignEdge.status).toBe(201);
  const edgeId = ((await bodyOf(foreignEdge)) as { id: string }).id;
  const ownerAfter = (await bodyOf(await call(database, "GET", "/api/graph", undefined, owner))) as { edges: Array<{ id: string }> };
  expect(ownerAfter.edges.some((item) => item.id === edgeId)).toBe(false);

  const artifact = saveArtifact(database, ownerId, { courseId: course.id, kind: "note", title: "Note", body: "v1", label: "learner_authored" }) as { id: string; rev: number };
  expect((await call(database, "POST", "/api/device/notes", { artifactId: artifact.id, body: "local", rev: artifact.rev }, owner)).status).toBe(201);
  const synced = await call(database, "POST", `/api/device/notes/${artifact.id}/sync`, { rev: artifact.rev, body: "v2", idempotencyKey: "sync-1" }, owner);
  expect(synced.status).toBe(200);
  expect((await bodyOf(synced)).status).toBe("acked");
  expect((await call(database, "POST", `/api/device/notes/${artifact.id}/sync`, { rev: artifact.rev, body: "v3", idempotencyKey: "sync-2" }, other)).status).toBe(404);
  const notes = ((await bodyOf(await call(database, "GET", "/api/device/notes", undefined, owner))) as { records: Array<{ id: string }> }).records;
  const otherNotes = ((await bodyOf(await call(database, "GET", "/api/device/notes", undefined, other))) as { records: Array<{ id: string }> }).records;
  expect(notes.some((item) => item.id === artifact.id)).toBe(true);
  expect(otherNotes.some((item) => item.id === artifact.id)).toBe(false);

  const sessionId = ((await bodyOf(await call(database, "POST", "/api/sessions", { kind: "study" }, owner))) as { id: string }).id;
  expect((await call(database, "GET", `/api/sessions/${sessionId}`, undefined, owner)).status).toBe(200);
  expect((await call(database, "POST", `/api/sessions/${sessionId}/pause`, { pausedMs: 1000 }, owner)).status).toBe(200);
  expect((await call(database, "POST", `/api/sessions/${sessionId}/complete`, undefined, other)).status).toBe(404);
  expect((await call(database, "POST", `/api/sessions/${sessionId}/complete`, undefined, owner)).status).toBe(200);
  expect(internalErrorHeaders()["cache-control"]).toBe("private, no-store");
  expect(internalErrorHeaders()["access-control-allow-origin"]).toBeUndefined();
});
