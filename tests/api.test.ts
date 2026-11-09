import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { openDatabase, type Db } from "../src/db.js";
import { handleApi } from "../src/server/api.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-api-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "unibud.sqlite"));
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string, origin?: string) {
  const headers = new Headers({ "x-unibud-request": "1", host: "127.0.0.1:3000" });
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), database);
}

function cookieFrom(response: Response): string {
  const set = response.headers.get("set-cookie") ?? "";
  return set.split(";")[0];
}

test("auth cookie, csrf, and course ownership", async () => {
  const database = db();
  const missing = await handleApi(new Request("http://127.0.0.1:3000/api/courses", { method: "POST", headers: { host: "127.0.0.1:3000", "content-type": "application/json" }, body: "{}" }), database);
  expect(missing.status).toBe(403);
  const cross = await call(database, "POST", "/api/auth/register", { email: "a@example.edu", password: "password123" }, undefined, "https://evil.example");
  expect(cross.status).toBe(403);
  const created = await call(database, "POST", "/api/auth/register", { email: "a@example.edu", password: "password123", displayName: "Ada" });
  expect(created.status).toBe(201);
  const cookie = cookieFrom(created);
  const me = await call(database, "GET", "/api/me", undefined, cookie);
  expect(await me.json()).toMatchObject({ email: "a@example.edu", dataClass: "learner" });
  const course = await call(database, "POST", "/api/courses", { name: "Acids", goal: "Exam" }, cookie);
  const courseId = ((await course.json()) as { course: { id: string } }).course.id;
  const other = await call(database, "POST", "/api/auth/register", { email: "b@example.edu", password: "password123" });
  const otherCookie = cookieFrom(other);
  const denied = await call(database, "GET", `/api/courses/${courseId}`, undefined, otherCookie);
  expect(denied.status).toBe(404);
});

test("cross-topic answer is rejected and does not enter the other topic", async () => {
  const database = db();
  const created = await call(database, "POST", "/api/auth/register", { email: "scope@example.edu", password: "password123" });
  const cookie = cookieFrom(created);
  const courseA = ((await (await call(database, "POST", "/api/courses", { name: "A" }, cookie)).json()) as { course: { id: string } }).course.id;
  const courseB = ((await (await call(database, "POST", "/api/courses", { name: "B" }, cookie)).json()) as { course: { id: string } }).course.id;
  const topicA = ((await (await call(database, "POST", `/api/courses/${courseA}/topics`, { name: "TA" }, cookie)).json()) as { topic: { id: string } }).topic.id;
  const topicB = ((await (await call(database, "POST", `/api/courses/${courseB}/topics`, { name: "TB" }, cookie)).json()) as { topic: { id: string } }).topic.id;
  const questionB = ((await (await call(database, "POST", "/api/questions", { courseId: courseB, topicId: topicB, prompt: "B?", choices: ["yes", "no"], correctIndex: 0 }, cookie)).json()) as { id: string }).id;
  const attempt = ((await (await call(database, "POST", "/api/attempts", { courseId: courseA, topicId: topicA, clientToken: "t1" }, cookie)).json()) as { id: string }).id;
  const rejected = await call(database, "POST", `/api/attempts/${attempt}/answers`, { questionId: questionB, selectedIndex: 1 }, cookie);
  expect(rejected.status).toBe(400);
  const evidence = await call(database, "GET", `/api/topics/${topicA}/evidence`, undefined, cookie);
  expect(((await evidence.json()) as { evidence: null }).evidence).toBeNull();
});

test("provider and youtube responses contain no credentials", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "dummy-test-key";
  const database = db();
  const cookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "p@example.edu", password: "password123" }));
  const providers = await call(database, "GET", "/api/providers", undefined, cookie);
  const body = JSON.stringify(await providers.json());
  expect(body).not.toContain("dummy-test-key");
  expect(body).toContain("google_live_blocked_pending_age_and_product_policy");
  const youtube = await call(database, "GET", "/api/youtube/status", undefined, cookie);
  const status = (await youtube.json()) as { captionDownload: boolean; search: string };
  expect(status.captionDownload).toBe(false);
  expect(["unconfigured", "not_executed"]).toContain(status.search);
  if (previous === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previous;
});

test("cram confirm dates a task and a non-member cannot read a circle", async () => {
  const database = db();
  const ownerCookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "owner@example.edu", password: "password123" }));
  const otherCookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "other@example.edu", password: "password123" }));
  const courseId = ((await (await call(database, "POST", "/api/courses", { name: "Plan" }, ownerCookie)).json()) as { course: { id: string } }).course.id;
  await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "Cells" }, ownerCookie);
  const preview = await call(database, "POST", "/api/cram/preview", { courseId, title: "Midterm", examDate: "2026-11-20", availableHours: 2, syllabus: "cells", now: "2026-11-09T15:00:00.000Z" }, ownerCookie);
  const previewBody = (await preview.json()) as { previewId: string; dueSemantics: string; priorities: Array<{ dueAt: string | null }> };
  expect(previewBody.dueSemantics).toBe("calendar_day");
  expect(previewBody.priorities.some((item) => item.dueAt?.includes("T09:00"))).toBe(false);
  const cram = await call(database, "POST", "/api/cram/confirm", { previewId: previewBody.previewId }, ownerCookie);
  expect(cram.status).toBe(201);
  const tasks = await call(database, "GET", "/api/tasks", undefined, ownerCookie);
  const saved = ((await tasks.json()) as { tasks: Array<{ due_at: string | null }> }).tasks;
  expect(saved.some((task) => task.due_at)).toBe(true);
  const circle = ((await (await call(database, "POST", "/api/circles", { name: "Group" }, ownerCookie)).json()) as { id: string }).id;
  const hidden = await call(database, "GET", `/api/circles/${circle}/posts`, undefined, otherCookie);
  expect(hidden.status).toBe(404);
  const me = await call(database, "GET", "/api/me", undefined, ownerCookie);
  expect(me.headers.get("cache-control")).toContain("no-store");
  expect(me.headers.get("access-control-allow-origin")).toBeNull();
  const spoof = await call(database, "POST", "/api/courses", { name: "Spoof" }, ownerCookie, "https://evil.example");
  expect(spoof.status).toBe(403);
  const forwarded = new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "x-forwarded-host": "evil.example", "x-unibud-request": "1", cookie: ownerCookie, "content-type": "application/json" });
  const ignored = await handleApi(new Request("http://127.0.0.1:3000/api/courses", { method: "POST", headers: forwarded, body: JSON.stringify({ name: "Still local" }) }), database);
  expect(ignored.status).toBe(201);
  const deck = ((await (await call(database, "POST", "/api/decks", { title: "Deck" }, ownerCookie)).json()) as { deck: { id: string } }).deck.id;
  const card = ((await (await call(database, "POST", `/api/decks/${deck}/cards`, { front: "Q", back: "A" }, ownerCookie)).json()) as { card: { id: string } }).card.id;
  const cardCookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "card-other@example.edu", password: "password123" }));
  const hiddenCard = await call(database, "POST", `/api/cards/${card}/reviews`, { quality: 5, revealed: true }, cardCookie);
  expect(hiddenCard.status).toBe(404);
});

test("autopilot confirm binds the preview token and same-course topics stay separate", async () => {
  const database = db();
  const cookie = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "bind@example.edu", password: "password123" }));
  const courseId = ((await (await call(database, "POST", "/api/courses", { name: "One course" }, cookie)).json()) as { course: { id: string } }).course.id;
  const topicA = ((await (await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "A" }, cookie)).json()) as { topic: { id: string } }).topic.id;
  const topicB = ((await (await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "B" }, cookie)).json()) as { topic: { id: string } }).topic.id;
  const questionB = ((await (await call(database, "POST", "/api/questions", { courseId, topicId: topicB, prompt: "B?", choices: ["yes", "no"], correctIndex: 0 }, cookie)).json()) as { id: string }).id;
  const attempt = ((await (await call(database, "POST", "/api/attempts", { courseId, topicId: topicA, clientToken: "same-course" }, cookie)).json()) as { id: string }).id;
  const rejected = await call(database, "POST", `/api/attempts/${attempt}/answers`, { questionId: questionB, selectedIndex: 1 }, cookie);
  expect(((await rejected.json()) as { error: string }).error).toBe("question_out_of_scope");
  const preview = await call(database, "POST", "/api/autopilot/preview", { courseId, now: "2026-11-09T15:00:00.000Z" }, cookie);
  const shown = (await preview.json()) as { previewId: string; after: Array<{ id: string; dueAt: string | null; dueDay: string | null }> };
  await call(database, "POST", "/api/tasks", { title: "Added after preview", courseId, confirmed: true }, cookie);
  const stale = await call(database, "POST", "/api/autopilot/confirm", { previewId: shown.previewId }, cookie);
  expect(stale.status).toBe(409);
  const tasks = ((await (await call(database, "GET", "/api/tasks", undefined, cookie)).json()) as { tasks: Array<{ title: string; due_at: string | null }> }).tasks;
  expect(tasks.find((task) => task.title === "Added after preview")?.due_at ?? null).toBeNull();
});
