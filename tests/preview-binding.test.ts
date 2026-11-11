import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { AutopilotPreviewResponse, CramPreviewResponse } from "../src/contract/types.js";
import { get, openDatabase, run, type Db } from "../src/db.js";
import { autopilotFingerprint } from "../src/domain.js";
import { handleApi } from "../src/server/api.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-preview-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "unibud.sqlite"));
}

function withSignup(pathname: string, body?: unknown): unknown {
  if (pathname !== "/api/auth/register" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  return { education_level: "university", age_band: "18_plus", ...(body as Record<string, unknown>) };
}

function call(database: Db, method: string, pathname: string, body?: unknown, cookie?: string) {
  const headers = new Headers({ host: "127.0.0.1:3000", "x-unibud-request": "1" });
  if (cookie) headers.set("cookie", cookie);
  return handleApi(new Request(`http://127.0.0.1:3000${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(withSignup(pathname, body)) }), database);
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

test("confirm writes the stored preview payload, including a date the scheduler would not recompute", async () => {
  const database = db();
  const owner = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "bind-owner@example.edu", password: "password123" }));
  const other = cookieFrom(await call(database, "POST", "/api/auth/register", { email: "bind-other@example.edu", password: "password123" }));
  const courseId = ((await (await call(database, "POST", "/api/courses", { name: "Course" }, owner)).json()) as { course: { id: string } }).course.id;
  await call(database, "POST", `/api/courses/${courseId}/topics`, { name: "Cells" }, owner);

  const cramMissing = await call(database, "POST", "/api/cram/confirm", { courseId }, owner);
  expect(cramMissing.status).toBe(400);
  expect(await cramMissing.json()).toEqual({ error: "preview_required" });

  const cram = await call(database, "POST", "/api/cram/preview", { courseId, title: "Midterm", examDate: "2026-11-20", availableHours: 2, syllabus: "cells", now: "2026-11-09T15:00:00.000Z" }, owner);
  const cramBody = (await cram.json()) as CramPreviewResponse;
  expect(cramBody.contractVersion).toBe(2);
  const originalDue = cramBody.priorities[0]?.dueAt;
  expect(originalDue).not.toBe("2099-01-02T00:00:00.000Z");
  const stored = get<{ payload_json: string }>(database, "SELECT payload_json FROM schedule_previews WHERE id = ?", cramBody.previewId);
  const payload = JSON.parse(stored?.payload_json ?? "{}") as { proposal: CramPreviewResponse };
  payload.proposal.priorities[0].dueAt = "2099-01-02T00:00:00.000Z";
  payload.proposal.priorities[0].minutes = Math.max(1, payload.proposal.priorities[0].minutes);
  run(database, "UPDATE schedule_previews SET payload_json = ? WHERE id = ?", JSON.stringify(payload), cramBody.previewId);
  const confirmed = await call(database, "POST", "/api/cram/confirm", { previewId: cramBody.previewId }, owner);
  expect(confirmed.status).toBe(201);
  const tasks = ((await (await call(database, "GET", "/api/tasks", undefined, owner)).json()) as { tasks: Array<{ due_at: string | null }> }).tasks;
  expect(tasks.some((task) => task.due_at === "2099-01-02T00:00:00.000Z")).toBe(true);
  expect(tasks.some((task) => task.due_at === originalDue)).toBe(false);
  const consumed = await call(database, "POST", "/api/cram/confirm", { previewId: cramBody.previewId }, owner);
  expect(consumed.status).toBe(409);
  expect(await consumed.json()).toEqual({ error: "preview_consumed" });

  await call(database, "POST", "/api/tasks", { title: "Read notes", courseId, confirmed: true }, owner);
  const autoMissing = await call(database, "POST", "/api/autopilot/confirm", {}, owner);
  expect(autoMissing.status).toBe(400);
  expect(await autoMissing.json()).toEqual({ error: "preview_required" });
  const absent = await call(database, "POST", "/api/autopilot/confirm", { previewId: "missing" }, owner);
  expect(absent.status).toBe(404);
  expect(await absent.json()).toEqual({ error: "preview_not_found" });

  const preview = await call(database, "POST", "/api/autopilot/preview", { courseId, now: "2026-11-09T15:00:00.000Z" }, owner);
  const shown = (await preview.json()) as AutopilotPreviewResponse;
  expect((await call(database, "POST", "/api/autopilot/confirm", { previewId: shown.previewId }, other)).status).toBe(404);
  await call(database, "POST", "/api/tasks", { title: "Added after", courseId, confirmed: true }, owner);
  const stale = await call(database, "POST", "/api/autopilot/confirm", { previewId: shown.previewId }, owner);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: "stale_preview" });

  const fresh = await call(database, "POST", "/api/autopilot/preview", { courseId, now: "2026-11-09T15:00:00.000Z" }, owner);
  const exact = (await fresh.json()) as AutopilotPreviewResponse;
  const target = exact.after.find((row) => row.changed && row.dueAt);
  expect(target).toBeTruthy();
  const row = get<{ payload_json: string }>(database, "SELECT payload_json FROM schedule_previews WHERE id = ?", exact.previewId);
  const autopilotPayload = JSON.parse(row?.payload_json ?? "{}") as { now: string; proposal: AutopilotPreviewResponse };
  const edited = autopilotPayload.proposal.after.find((item) => item.id === target?.id);
  if (!edited) throw new Error("stored autopilot row missing");
  edited.dueAt = "2099-03-03T00:00:00.000Z";
  edited.changed = true;
  edited.placed = true;
  run(database, "UPDATE schedule_previews SET payload_json = ? WHERE id = ?", JSON.stringify(autopilotPayload), exact.previewId);
  const applied = await call(database, "POST", "/api/autopilot/confirm", { previewId: exact.previewId }, owner);
  expect(applied.status).toBe(200);
  const dated = ((await (await call(database, "GET", "/api/tasks", undefined, owner)).json()) as { tasks: Array<{ id: string; due_at: string | null }> }).tasks;
  expect(dated.find((task) => task.id === edited.id)?.due_at).toBe("2099-03-03T00:00:00.000Z");
  const replay = await call(database, "POST", "/api/autopilot/confirm", { previewId: exact.previewId }, owner);
  expect(replay.status).toBe(409);
  expect(await replay.json()).toEqual({ error: "preview_consumed" });

  await call(database, "POST", "/api/tasks", { title: "Revision check", courseId, confirmed: true }, owner);
  const conflictPreview = await call(database, "POST", "/api/autopilot/preview", { courseId, now: "2026-11-09T15:00:00.000Z" }, owner);
  const conflictBody = (await conflictPreview.json()) as AutopilotPreviewResponse;
  const conflictRow = conflictBody.after[0];
  const userId = get<{ user_id: string }>(database, "SELECT user_id FROM courses WHERE id = ?", courseId)?.user_id ?? "";
  run(database, "UPDATE tasks SET rev = rev + 1 WHERE id = ?", conflictRow.id);
  const storedPayload = JSON.parse(get<{ payload_json: string }>(database, "SELECT payload_json FROM schedule_previews WHERE id = ?", conflictBody.previewId)?.payload_json ?? "{}") as { now: string };
  run(database, "UPDATE schedule_previews SET fingerprint = ? WHERE id = ?", autopilotFingerprint(database, userId, courseId, storedPayload.now), conflictBody.previewId);
  const raced = await call(database, "POST", "/api/autopilot/confirm", { previewId: conflictBody.previewId }, owner);
  expect(raced.status).toBe(409);
  expect(await raced.json()).toEqual({ error: "stale_preview" });
  const unchanged = get<{ due_at: string | null }>(database, "SELECT due_at FROM tasks WHERE id = ?", conflictRow.id);
  expect(unchanged?.due_at ?? null).toBe(conflictBody.before.find((item) => item.id === conflictRow.id)?.due_at ?? null);
});
