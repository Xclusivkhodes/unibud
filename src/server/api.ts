import nodePath from "node:path";
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
  createParentCircle,
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
  completeProfile,
  profileClaimsFor,
  joinCircleByCode,
  publicProfile,
  recordYouTubeWatch,
  registerUser,
  reportMember,
  revokeMember,
  searchPublicProfiles,
  sendCircleDm,
  setVerifiedTeacher,
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
import { accountCapabilities, assertCircleAllowed } from "./account-policy.js";
import { ageBandFromDateOfBirth, rejectTrackingFields, safeSearchFor } from "./minor-safety.js";
import { completeConsent, exportChild, loginParent, parentFromSession, purgePendingConsent, requestConsent, revokeChild, viewChild } from "./consent.js";
import { auditYouTubeUrl, buildSearchListUrl } from "../youtube/api.js";
import { assertBodyBudget, assertLoginAllowed, clearLoginFailures, inflightKey, recordLoginFailure, reserveInflight, trustedRequestSource } from "./limits.js";
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
      blockReason: [configured ? null : "unconfigured", policy ?? (configured ? "not_live_authorized" : null)].filter(Boolean).join(",") || "not_live_authorized",
    };
  });
}

function meBody(db: Db, actor: { id: string; email: string; data_class: string }) {
  const capabilities = accountCapabilities(profileClaimsFor(db, actor.id));
  return {
    id: actor.id,
    email: actor.email,
    dataClass: actor.data_class,
    education_level: capabilities.education_level,
    age_band: capabilities.age_band,
    account_status: capabilities.account_status,
    ai_available: capabilities.ai_available,
    needs_profile_completion: capabilities.needs_profile_completion,
  };
}

export async function handleApi(request: Request, db: Db, options?: { source?: string; now?: number }): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  const source = trustedRequestSource(options?.source);
  const now = options?.now ?? Date.now();
  let release = () => {};
  try {
    assertBodyBudget(request);
    if (method !== "GET" && method !== "HEAD") assertMutation(request);
    if ((path === "/api/auth/register" || path === "/api/auth/login") && method === "POST") {
      const body = await readJson(request);
      release = reserveInflight(inflightKey({ email: str(body.email), source }));
      if (path === "/api/auth/register") {
        rejectTrackingFields(body);
        if (str(body.parent_email)) throw new AppError("parent_email_not_on_register", "Parent email is not part of registration.", 400);
        if (!str(body.education_level)) throw new AppError("invalid_education_level", "Education level was rejected.", 400);
        let ageBand = str(body.age_band);
        const dateOfBirth = str(body.date_of_birth);
        if (dateOfBirth) {
          const derived = ageBandFromDateOfBirth(dateOfBirth, new Date(now));
          if (ageBand && ageBand !== derived) throw new AppError("age_band_conflict", "Age band does not match the date of birth.", 400);
          ageBand = derived;
        }
        if (!ageBand) throw new AppError("invalid_age_band", "Age band was rejected.", 400);
        const created = registerUser(db, { email: str(body.email), password: str(body.password), educationLevel: str(body.education_level), ageBand });
        if (str(body.displayName)) saveProfile(db, created.id, { display_name: str(body.displayName), onboarding_status: "completed" }, 1);
        const session = login(db, created.email, str(body.password));
        return json({ userId: created.id, education_level: created.education_level, age_band: created.age_band }, 201, { "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) });
      }
      const email = str(body.email);
      assertLoginAllowed(email, source, now);
      try {
        const session = login(db, email, str(body.password));
        clearLoginFailures(email, source);
        return json({ userId: session.userId }, 200, { "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) });
      } catch (error) {
        if (error instanceof AppError && error.code === "invalid_login") recordLoginFailure(email, source, now);
        throw error;
      }
    }
    release = reserveInflight(inflightKey({ token: tokenFromRequest(request), source }));
    if (path === "/api/auth/logout" && method === "POST") {
      const token = tokenFromRequest(request);
      if (token) logout(db, token);
      return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
    }
    if (path === "/api/me" && method === "GET") {
      const actor = user(db, request);
      return json(meBody(db, actor));
    }
    if (path === "/api/profile" && method === "PATCH") {
      const actor = user(db, request);
      const body = await readJson(request);
      rejectTrackingFields(body);
      if ("age_band" in body) throw new AppError("age_band_frozen", "Age band is set by the server.", 409);
      const patch: Record<string, string> = {};
      if (typeof body.display_name === "string") patch.display_name = body.display_name;
      if (typeof body.first_name === "string") patch.first_name = body.first_name;
      if (Object.keys(patch).length === 0) throw new AppError("empty_patch", "Nothing to update.", 400);
      return json(saveProfile(db, actor.id, patch, Number(body.rev ?? 1)));
    }
    if (path === "/api/profile/completion" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      completeProfile(db, actor.id, { educationLevel: str(body.education_level), ageBand: str(body.age_band) });
      return json(meBody(db, actor));
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
      assertCircleAllowed(accountCapabilities(profileClaimsFor(db, actor.id)), "participate");
      const body = await readJson(request);
      return json({ id: createCircle(db, actor.id, str(body.name)) }, 201);
    }
    const invite = path.match(/^\/api\/circles\/([^/]+)\/invites$/);
    if (invite && method === "POST") {
      const actor = user(db, request);
      assertCircleAllowed(accountCapabilities(profileClaimsFor(db, actor.id)), "invite");
      const body = await readJson(request);
      return json(inviteToCircle(db, actor.id, decodeURIComponent(invite[1]), str(body.email)));
    }
    const accept = path.match(/^\/api\/circles\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      const actor = user(db, request);
      assertCircleAllowed(accountCapabilities(profileClaimsFor(db, actor.id)), "participate");
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
      assertCircleAllowed(accountCapabilities(profileClaimsFor(db, actor.id)), "participate");
      return json({ posts: readPosts(db, actor.id, decodeURIComponent(posts[1])) });
    }
    if (posts && method === "POST") {
      const actor = user(db, request);
      assertCircleAllowed(accountCapabilities(profileClaimsFor(db, actor.id)), "participate");
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
    if (path === "/api/consent/request" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const logs: string[] = [];
      const result = requestConsent(db, actor.id, {
        parentEmail: str(body.parent_email),
        firstName: str(body.first_name),
        policyVersion: str(body.policy_version),
        now: new Date(now),
        outboxDir: process.env.UNIBUD_OUTBOX_DIR?.trim() || nodePath.join(".data", "outbox"),
        log: (line) => logs.push(line),
      });
      return json({ ...result, log: logs });
    }
    if (path === "/api/consent/complete" && method === "POST") {
      const body = await readJson(request);
      const completed = completeConsent(db, { token: str(body.token), parentPassword: str(body.parent_password), method: str(body.method) || "checkbox", now: new Date(now) });
      return json({ childUserId: completed.childUserId, status: "recorded" });
    }
    if (path === "/api/parent/login" && method === "POST") {
      const body = await readJson(request);
      const session = loginParent(db, str(body.email), str(body.password), new Date(now).toISOString());
      return json({ parentId: session.parentId }, 200, { "set-cookie": `unibud_parent=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=7200` });
    }
    const parentToken = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("unibud_parent="))?.slice("unibud_parent=".length);
    const parent = parentToken ? parentFromSession(db, decodeURIComponent(parentToken), new Date(now).toISOString()) : null;
    const childRoute = path.match(/^\/api\/parent\/children\/([^/]+)(\/export|\/revoke)?$/);
    if (childRoute) {
      if (!parent) throw new AppError("unauthenticated", "Sign in required.", 401);
      const childId = decodeURIComponent(childRoute[1]);
      if (childRoute[2] === "/export" && method === "GET") return json(exportChild(db, parent.id, childId));
      if (childRoute[2] === "/revoke" && method === "POST") return json(revokeChild(db, parent.id, childId));
      if (!childRoute[2] && method === "GET") return json(viewChild(db, parent.id, childId));
      if (!childRoute[2] && method === "DELETE") return json(revokeChild(db, parent.id, childId));
    }
    if (path === "/api/parent/circles" && method === "POST") {
      if (!parent) throw new AppError("unauthenticated", "Sign in required.", 401);
      const body = await readJson(request);
      return json(createParentCircle(db, parent.id, str(body.name)), 201);
    }
    if (path === "/api/consent/purge" && method === "POST") {
      const expected = process.env.UNIBUD_ADMIN_TOKEN?.trim();
      if (!expected) throw new AppError("admin_unconfigured", "Admin token is not configured.", 503);
      if (request.headers.get("x-unibud-admin") !== expected) throw new AppError("forbidden", "Admin token was rejected.", 403);
      return json(purgePendingConsent(db, new Date(now)));
    }
    if (path === "/api/admin/teachers" && method === "POST") {
      const expected = process.env.UNIBUD_ADMIN_TOKEN?.trim();
      if (!expected) throw new AppError("admin_unconfigured", "Admin token is not configured.", 503);
      if (request.headers.get("x-unibud-admin") !== expected) throw new AppError("forbidden", "Admin token was rejected.", 403);
      const body = await readJson(request);
      setVerifiedTeacher(db, str(body.userId));
      return json({ ok: true });
    }
    if (path === "/api/youtube/search" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      const claims = accountCapabilities(profileClaimsFor(db, actor.id));
      const safeSearch = safeSearchFor(claims);
      const key = process.env.YOUTUBE_API_KEY?.trim();
      const url = buildSearchListUrl(str(body.q) || "study", key || "not-configured", safeSearch);
      return json({ status: key ? "not_executed" : "unconfigured", safeSearch, requested: [auditYouTubeUrl(url.toString())] });
    }
    if (path === "/api/youtube/history" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(recordYouTubeWatch(db, actor.id, str(body.videoId)));
    }
    if (path === "/api/profiles/search" && method === "POST") {
      user(db, request);
      const body = await readJson(request);
      return json({ results: searchPublicProfiles(db, str(body.email)) });
    }
    const profilePublic = path.match(/^\/api\/profiles\/([^/]+)$/);
    if (profilePublic && method === "GET") {
      user(db, request);
      return json(publicProfile(db, decodeURIComponent(profilePublic[1])));
    }
    if (path === "/api/circles/join" && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(joinCircleByCode(db, actor.id, str(body.code)));
    }
    const report = path.match(/^\/api\/circles\/([^/]+)\/reports$/);
    if (report && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      reportMember(db, actor.id, decodeURIComponent(report[1]), str(body.userId));
      return json({ revoked: true });
    }
    const dm = path.match(/^\/api\/circles\/([^/]+)\/dm$/);
    if (dm && method === "POST") {
      const actor = user(db, request);
      const body = await readJson(request);
      return json(sendCircleDm(db, actor.id, decodeURIComponent(dm[1]), str(body.userId), str(body.body)), 201);
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
