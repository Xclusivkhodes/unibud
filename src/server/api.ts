import { all, get, type Db } from "../db.js";
import type { ProviderPublicStatus, YoutubePublicStatus } from "../contract/types.js";
import {
  acceptInvite,
  addQuestion,
  addSource,
  answerAttempt,
  confirmAutopilotPreview,
  confirmCramPreview,
  issueAutopilotPreview,
  issueCramPreview,
  createCircle,
  createCourse,
  createTask,
  createTopic,
  deleteAccount,
  exportAccount,
  interruptAttempt,
  inviteToCircle,
  listMisconceptions,
  login,
  logout,
  postToCircle,
  readPosts,
  registerUser,
  revokeMember,
  saveProfile,
  startAttempt,
  submitAttempt,
  twin,
  userFromSession,
  correctMisconception,
} from "../domain.js";
import { GOOGLE_LIVE_USE, REGISTRY, googlePolicyFailures, type RouteInput } from "../providers/registry.js";
import { AppError } from "../security/crypto.js";
import { captionDownloadStatus } from "../youtube/api.js";
import { readLimitedJson } from "./body.js";
import { clearedSessionCookie, sessionCookie, tokenFromRequest } from "./http.js";
import { assertBodyBudget, inflightKey, reserveInflight } from "./limits.js";
import { handleOwnedResources } from "./resources.js";

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  return new Response(JSON.stringify(body), { status, headers });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) return json({ error: error.code }, error.status);
  return json({ error: "internal" }, 500);
}

function readJson(request: Request): Promise<Record<string, unknown>> {
  return readLimitedJson(request);
}

function assertMutation(request: Request): void {
  if (request.headers.get("x-unibud-request") !== "1") throw new AppError("csrf_required", "Missing request header.", 403);
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("csrf_origin", "Origin was rejected.", 403);
  }
  const host = request.headers.get("host");
  if (!host || originHost !== host) throw new AppError("csrf_origin", "Origin was rejected.", 403);
}

function user(db: Db, request: Request) {
  const token = tokenFromRequest(request);
  if (!token) throw new AppError("unauthenticated", "Sign in required.", 401);
  const found = userFromSession(db, token);
  if (!found) throw new AppError("unauthenticated", "Sign in required.", 401);
  return found;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function providerStatus(input: RouteInput): ProviderPublicStatus[] {
  const blocks = new Map<string, string>();
  for (const entry of REGISTRY.filter((item) => item.provider === "google")) {
    blocks.set(`${entry.provider}:${entry.model}`, googlePolicyFailures(input).join(","));
  }
  return REGISTRY.map((entry) => {
    const envName = entry.provider === "google" ? "GEMINI_API_KEY" : entry.provider === "openai" ? "OPENAI_API_KEY" : entry.provider === "anthropic" ? "ANTHROPIC_API_KEY" : entry.provider === "xai" ? "XAI_API_KEY" : "";
    const configured = envName ? Boolean(process.env[envName]?.trim()) : false;
    const policy = blocks.get(`${entry.provider}:${entry.model}`);
    return {
      provider: entry.provider,
      model: entry.model,
      configured,
      eligible: false,
      liveVerified: false,
      operational: false,
      blockReason: configured ? policy ?? "not_live_authorized" : "unconfigured",
    };
  });
}

export async function handleApi(request: Request, db: Db, options?: { source?: string }): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  const source = options?.source?.trim() || "local";
  let release = () => {};
  try {
    assertBodyBudget(request);
    if (method !== "GET" && method !== "HEAD") assertMutation(request);
    if ((path === "/api/auth/register" || path === "/api/auth/login") && method === "POST") {
      const body = await readJson(request);
      release = reserveInflight(inflightKey({ email: str(body.email), source }));
      if (path === "/api/auth/register") {
        const created = registerUser(db, { email: str(body.email), password: str(body.password) });
        if (str(body.displayName)) saveProfile(db, created.id, { display_name: str(body.displayName), onboarding_status: "completed" }, 1);
        const session = login(db, created.email, str(body.password));
        return json({ userId: created.id }, 201, { "set-cookie": sessionCookie(session.token) });
      }
      const session = login(db, str(body.email), str(body.password));
      return json({ userId: session.userId }, 200, { "set-cookie": sessionCookie(session.token) });
    }
    release = reserveInflight(inflightKey({ token: tokenFromRequest(request), source }));
    if (path === "/api/auth/logout" && method === "POST") {
      const token = tokenFromRequest(request);
      if (token) logout(db, token);
      return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
    }
    if (path === "/api/me" && method === "GET") {
      const actor = user(db, request);
      return json({ id: actor.id, email: actor.email, dataClass: actor.data_class });
    }
    if (path === "/api/providers" && method === "GET") {
      const actor = user(db, request);
      return json({
        userId: actor.id,
        googleLiveUse: GOOGLE_LIVE_USE,
        providers: providerStatus({
          task: "tutoring",
          required: ["text"],
          sensitivity: "unknown",
          audience: "unknown",
          billingTier: "unknown",
          grants: [],
          retention: "strict",
          costMode: "unknown_cost_allowed",
          residency: "unspecified",
          independentCheck: false,
          online: true,
          configuredProviders: [],
        }),
      });
    }
    if (path === "/api/youtube/status" && method === "GET") {
      user(db, request);
      const captions = captionDownloadStatus();
      const status: YoutubePublicStatus = {
        configured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
        search: process.env.YOUTUBE_API_KEY?.trim() ? "not_executed" : "unconfigured",
        captionDownload: false,
        captionReason: captions.reason,
      };
      return json(status);
    }
    if (path === "/api/courses" && method === "GET") {
      const actor = user(db, request);
      return json({ courses: all(db, "SELECT id, name, subject_name, goal_text FROM courses WHERE user_id = ? ORDER BY created_at", actor.id) });
    }
    if (path === "/api/courses" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const course = createCourse(db, actor.id, { name: str(body.name), subjectName: str(body.subjectName), goal: str(body.goal) });
      return json({ course }, 201);
    }
    const courseTopic = path.match(/^\/api\/courses\/([^/]+)\/topics$/);
    if (courseTopic && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const topic = createTopic(db, actor.id, decodeURIComponent(courseTopic[1]), str(body.name), str(body.selfReportedLevel));
      return json({ topic }, 201);
    }
    const courseOne = path.match(/^\/api\/courses\/([^/]+)$/);
    if (courseOne && method === "GET") {
      const actor = user(db, request);
      const course = get(db, "SELECT id, name, subject_name, goal_text FROM courses WHERE id = ? AND user_id = ?", decodeURIComponent(courseOne[1]), actor.id);
      if (!course) return json({ error: "not_found" }, 404);
      return json({ course });
    }
    if (path === "/api/sources" && method === "GET") {
      const actor = user(db, request);
      const courseId = url.searchParams.get("courseId");
      const sources = courseId
        ? all(db, "SELECT id, course_id, topic_id, title FROM sources WHERE user_id = ? AND course_id = ?", actor.id, courseId)
        : all(db, "SELECT id, course_id, topic_id, title FROM sources WHERE user_id = ?", actor.id);
      return json({ sources });
    }
    if (path === "/api/sources" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const source = addSource(db, actor.id, { courseId: str(body.courseId), topicId: str(body.topicId) || undefined, title: str(body.title), body: str(body.body) });
      return json({ source }, 201);
    }
    if (path === "/api/questions" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const choices = Array.isArray(body.choices) ? body.choices.map((item) => String(item)) : [];
      const id = addQuestion(db, actor.id, { courseId: str(body.courseId), topicId: str(body.topicId) || undefined, prompt: str(body.prompt), choices, correctIndex: Number(body.correctIndex), label: str(body.label) || "learner_authored" });
      return json({ id }, 201);
    }
    if (path === "/api/attempts" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const attempt = startAttempt(db, actor.id, { courseId: str(body.courseId), topicId: str(body.topicId) || undefined, kind: str(body.kind) || "practice", timingMode: str(body.timingMode) || "untimed", clientToken: str(body.clientToken) });
      return json(attempt, attempt.duplicate ? 200 : 201);
    }
    const answer = path.match(/^\/api\/attempts\/([^/]+)\/answers$/);
    if (answer && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const result = answerAttempt(db, actor.id, decodeURIComponent(answer[1]), str(body.questionId), Number(body.selectedIndex));
      return json(result);
    }
    const submit = path.match(/^\/api\/attempts\/([^/]+)\/submit$/);
    if (submit && method === "POST") {
      const actor = user(db, request);
      return json({ attempt: submitAttempt(db, actor.id, decodeURIComponent(submit[1])) });
    }
    const interrupt = path.match(/^\/api\/attempts\/([^/]+)\/interrupt$/);
    if (interrupt && method === "POST") {
      const actor = user(db, request);
      return json({ attempt: interruptAttempt(db, actor.id, decodeURIComponent(interrupt[1])) });
    }
    const evidence = path.match(/^\/api\/topics\/([^/]+)\/evidence$/);
    if (evidence && method === "GET") {
      const actor = user(db, request);
      return json(twin(db, actor.id, decodeURIComponent(evidence[1])));
    }
    if (path === "/api/tasks" && method === "GET") {
      const actor = user(db, request);
      return json({ tasks: all(db, "SELECT id, title, due_at, status, confirmed, course_id, topic_id FROM tasks WHERE user_id = ?", actor.id) });
    }
    if (path === "/api/tasks" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const task = createTask(db, actor.id, { title: str(body.title), courseId: str(body.courseId) || undefined, topicId: str(body.topicId) || undefined, dueAt: str(body.dueAt) || undefined, origin: "learner", confirmed: body.confirmed === true, reason: str(body.reason) });
      return json({ task }, 201);
    }
    if (path === "/api/cram/preview" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const availableHours = Number(body.availableHours);
      if (!Number.isFinite(availableHours)) throw new AppError("invalid_hours", "Hours were rejected.", 400);
      return json(issueCramPreview(db, actor.id, { courseId: str(body.courseId), title: str(body.title), examDate: str(body.examDate), availableHours, syllabus: str(body.syllabus), now: str(body.now) || undefined }));
    }
    if (path === "/api/cram/confirm" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      if (!str(body.previewId)) throw new AppError("preview_required", "Confirm the preview token.", 400);
      const result = confirmCramPreview(db, actor.id, str(body.previewId));
      return json(result, result.applied ? 201 : 409);
    }
    if (path === "/api/autopilot/preview" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(issueAutopilotPreview(db, actor.id, str(body.courseId), str(body.now) || undefined));
    }
    if (path === "/api/autopilot/confirm" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      if (!str(body.previewId)) throw new AppError("preview_required", "Confirm the preview token.", 400);
      const result = confirmAutopilotPreview(db, actor.id, str(body.previewId));
      return json(result, result.applied ? 200 : 409);
    }
    if (path === "/api/misconceptions" && method === "GET") {
      const actor = user(db, request);
      return json(listMisconceptions(db, actor.id));
    }
    const correct = path.match(/^\/api\/misconceptions\/([^/]+)\/correct$/);
    if (correct && method === "POST") {
      const actor = user(db, request);
      correctMisconception(db, actor.id, decodeURIComponent(correct[1]));
      return json({ ok: true });
    }
    if (path === "/api/circles" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json({ id: createCircle(db, actor.id, str(body.name)) }, 201);
    }
    const invite = path.match(/^\/api\/circles\/([^/]+)\/invites$/);
    if (invite && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(inviteToCircle(db, actor.id, decodeURIComponent(invite[1]), str(body.email)));
    }
    const accept = path.match(/^\/api\/circles\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      const actor = user(db, request);
      acceptInvite(db, actor.id, decodeURIComponent(accept[1]));
      return json({ ok: true });
    }
    const revoke = path.match(/^\/api\/circles\/([^/]+)\/members\/([^/]+)\/revoke$/);
    if (revoke && method === "POST") {
      const actor = user(db, request);
      revokeMember(db, actor.id, decodeURIComponent(revoke[1]), decodeURIComponent(revoke[2]));
      return json({ ok: true });
    }
    const posts = path.match(/^\/api\/circles\/([^/]+)\/posts$/);
    if (posts && method === "GET") {
      const actor = user(db, request);
      return json({ posts: readPosts(db, actor.id, decodeURIComponent(posts[1])) });
    }
    if (posts && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(postToCircle(db, actor.id, decodeURIComponent(posts[1]), str(body.body)), 201);
    }
    if (path === "/api/export" && method === "GET") {
      const actor = user(db, request);
      return json(exportAccount(db, actor.id));
    }
    if (path === "/api/account" && method === "DELETE") {
      const actor = user(db, request);
      deleteAccount(db, actor.id);
      return json({ deleted: true }, 200, { "set-cookie": clearedSessionCookie() });
    }
    const owned = await handleOwnedResources(request, db, path, method);
    if (owned) return owned;
    if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return toErrorResponse(error);
  } finally {
    release();
  }
}
