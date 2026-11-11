"use server";

// Server-only adapter. Browser code must not import this module's domain or database dependencies.
// New frontend work should call same-origin /api. This file stays on the backend side of the handoff.

import { redirect } from "next/navigation";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { all, get } from "../db.js";
import {
  acceptInvite,
  addCard,
  addGraphEdge,
  addGraphNode,
  addQuestion,
  addSource,
  answerAttempt,
  applyArtifactUpdate,
  askTutor,
  attachTranscript,
  bookmarkVideo,
  completeSession,
  completeTask,
  composePack,
  confirmAutopilot,
  confirmCram,
  confirmTask,
  correctMisconception,
  createChat,
  createCircle,
  createCourse,
  createDeck,
  createTask,
  createTopic,
  deleteAccount,
  deleteChat,
  grantPrivacy,
  interruptAttempt,
  inviteToCircle,
  lensDecision,
  login,
  logout,
  markNotificationRead,
  pauseSession,
  postToCircle,
  proposeAutopilot,
  profileClaimsFor,
  proposeCram,
  registerUser,
  renameChat,
  reviewCard,
  revokeMember,
  saveArtifact,
  saveGame,
  saveLab,
  saveProfile,
  startAttempt,
  startSession,
  submitAttempt,
} from "../domain.js";
import { projectile, scoreBuiltInGame } from "../learning/labs.js";
import { planRoute, type RouteInput } from "../providers/registry.js";
import { readProfileClaims } from "../server/account-policy.js";
import { AppError, newId } from "../security/crypto.js";
import { inspectUpload } from "../security/uploads.js";
import { DeviceStore } from "../device/store.js";
import { getAppDb } from "../server/appdb.js";
import { uploadRoot } from "../server/paths.js";
import { clearSession, requireUser, setSession } from "../server/session.js";

function fail(path: string, error: unknown): never {
  const code = error instanceof AppError ? error.code : "internal";
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  try {
    const educationLevel = String(formData.get("education_level") ?? "");
    const ageBand = String(formData.get("age_band") ?? "");
    if (!educationLevel) throw new AppError("invalid_education_level", "Education level was rejected.", 400);
    if (!ageBand) throw new AppError("invalid_age_band", "Age band was rejected.", 400);
    const user = registerUser(getAppDb(), { email, password, educationLevel, ageBand });
    if (displayName) saveProfile(getAppDb(), user.id, { display_name: displayName, onboarding_status: "completed" }, 1);
    const session = login(getAppDb(), email, password);
    await setSession(session.token);
  } catch (error) {
    fail("/register", error);
  }
  redirect("/today");
}

export async function loginAction(formData: FormData) {
  try {
    const session = login(getAppDb(), String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
    await setSession(session.token);
  } catch (error) {
    fail("/login", error);
  }
  redirect("/today");
}

export async function logoutAction() {
  const user = await requireUser();
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get("unibud_session")?.value;
  new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device").clear(user.id);
  if (value) logout(getAppDb(), value);
  await clearSession();
  redirect("/login");
}

export async function createCourseAction(formData: FormData) {
  const user = await requireUser();
  const course = createCourse(getAppDb(), user.id, { name: String(formData.get("name") ?? ""), subjectName: String(formData.get("subject") ?? ""), goal: String(formData.get("goal") ?? "") }) as { id: string };
  redirect(`/courses/${course.id}`);
}

export async function createTopicAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  try {
    createTopic(getAppDb(), user.id, courseId, String(formData.get("name") ?? ""), String(formData.get("level") ?? ""));
  } catch (error) {
    fail(`/courses/${courseId}`, error);
  }
  redirect(`/courses/${courseId}`);
}

export async function addSourceAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  try {
    addSource(getAppDb(), user.id, { courseId, topicId: String(formData.get("topicId") || "") || undefined, title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? ""), kind: "note" });
  } catch (error) {
    fail("/studio", error);
  }
  redirect(`/studio?course=${courseId}`);
}

export async function uploadSourceAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) fail("/studio", new AppError("empty_upload", "Choose a text file."));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decision = inspectUpload(bytes, file.type || "text/plain");
  if (!decision.ok) fail("/studio", new AppError(decision.code, "Upload was rejected."));
  if (decision.mime !== "text/plain" && decision.mime !== "text/markdown") fail("/studio", new AppError("mime_rejected", "Only text sources can become notes."));
  const dir = path.join(uploadRoot(), user.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, decision.id), bytes);
  addSource(getAppDb(), user.id, { courseId, title: file.name, body: new TextDecoder().decode(bytes), kind: "upload" });
  redirect(`/studio?course=${courseId}`);
}

export async function saveExplanationAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  saveArtifact(getAppDb(), user.id, {
    courseId,
    topicId: String(formData.get("topicId") || "") || undefined,
    sourceId: String(formData.get("sourceId") || "") || undefined,
    kind: String(formData.get("kind") ?? "explanation"),
    title: String(formData.get("title") ?? "Explanation"),
    body: String(formData.get("body") ?? ""),
    label: String(formData.get("label") ?? "learner_authored"),
    depth: String(formData.get("depth") ?? "intermediate"),
  });
  redirect(`/explainer?course=${courseId}`);
}

export async function composePackAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  const sourceIds = formData.getAll("sourceId").map(String).filter(Boolean);
  try {
    composePack(getAppDb(), user.id, sourceIds, courseId, String(formData.get("topicId") || "") || undefined);
  } catch (error) {
    fail("/compiler", error);
  }
  redirect(`/compiler?course=${courseId}`);
}

export async function syncNoteAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("artifactId") ?? "");
  const rev = Number(formData.get("rev") ?? 0);
  const body = String(formData.get("body") ?? "");
  const key = String(formData.get("idempotencyKey") ?? newId());
  const result = applyArtifactUpdate(getAppDb(), user.id, id, rev, body, key);
  const store = new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device");
  if ("rev" in result && result.status === "acked") store.applyAck(user.id, id, { status: "acked", rev: result.rev ?? rev + 1, body });
  else if ("server" in result) store.applyConflict(user.id, id, result.server, body);
  redirect(`/studio?sync=${result.status}`);
}

export async function saveDeviceNoteAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("artifactId") ?? "");
  const store = new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device");
  store.save(user.id, { entity: "note", id, body: String(formData.get("body") ?? ""), baseRev: Number(formData.get("rev") ?? 0), syncState: "saved_on_device" });
  redirect("/studio?device=saved_on_device");
}

export async function askAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") || "") || undefined;
  const chatId = String(formData.get("chatId") || "") || createChat(getAppDb(), user.id, String(formData.get("title") ?? "Study question"), courseId);
  const claims = readProfileClaims(profileClaimsFor(getAppDb(), user.id));
  const route: RouteInput = {
    task: "tutoring",
    required: ["text"],
    sensitivity: "ordinary",
    audience: claims.age_band === "18_plus" && claims.education_level === "university" ? "adults_not_directed_at_minors" : "under18_directed_or_likely",
    billingTier: "unknown",
    grants: all<{ provider: string }>(getAppDb(), "SELECT provider FROM privacy_grants WHERE user_id = ?", user.id).map((row) => row.provider),
    retention: "strict",
    costMode: "unknown_cost_allowed",
    residency: "unspecified",
    independentCheck: false,
    online: true,
    configuredProviders: [],
    ageBand: claims.age_band,
    educationLevel: claims.education_level,
  };
  askTutor(getAppDb(), user.id, chatId, String(formData.get("question") ?? ""), route);
  redirect(`/companion?chat=${chatId}`);
}

export async function labAction(formData: FormData) {
  const user = await requireUser();
  const speed = Number(formData.get("speed"));
  const degrees = Number(formData.get("degrees"));
  try {
    const result = projectile(speed, degrees);
    saveLab(getAppDb(), user.id, { lab: result.lab, params: { speed, degrees }, result: result.result, assumptions: result.assumptions, courseId: String(formData.get("courseId") || "") || undefined });
  } catch (error) {
    fail("/lab", error);
  }
  redirect("/lab");
}

export async function lensAction(formData: FormData) {
  const user = await requireUser();
  const mode = String(formData.get("mode") ?? "text") === "image" ? "image" : "text";
  const decision = lensDecision({
    mode,
    consent: formData.get("consent") === "on",
    route: { task: "images", required: ["image"], sensitivity: "unknown", audience: "unknown", billingTier: "unknown", grants: [], retention: "strict", costMode: "known_cost_only", residency: "unspecified", independentCheck: false, online: true, configuredProviders: [] },
  });
  redirect(`/lens?status=${decision.status}&reason=${encodeURIComponent(decision.reason)}`);
}

export async function graphAction(formData: FormData) {
  const user = await requireUser();
  const from = addGraphNode(getAppDb(), user.id, String(formData.get("from") ?? ""));
  const to = addGraphNode(getAppDb(), user.id, String(formData.get("to") ?? ""));
  addGraphEdge(getAppDb(), user.id, from, to, formData.get("origin") === "inferred" ? "inferred" : "learner");
  redirect("/universe");
}

export async function bookmarkAction(formData: FormData) {
  const user = await requireUser();
  const id = bookmarkVideo(getAppDb(), user.id, { videoId: String(formData.get("videoId") ?? ""), courseId: String(formData.get("courseId") || "") || undefined, note: String(formData.get("note") ?? "") });
  if (String(formData.get("transcript") ?? "").trim()) {
    try {
      attachTranscript(getAppDb(), user.id, id, String(formData.get("transcript")), formData.get("rights") === "on");
    } catch (error) {
      fail("/resources", error);
    }
  }
  redirect("/resources");
}

export async function questionAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  try {
    addQuestion(getAppDb(), user.id, {
      courseId,
      topicId: String(formData.get("topicId") || "") || undefined,
      prompt: String(formData.get("prompt") ?? ""),
      choices: [String(formData.get("a") ?? ""), String(formData.get("b") ?? "")],
      correctIndex: Number(formData.get("correct") ?? 0),
      label: "learner_authored",
    });
  } catch (error) {
    fail("/practice", error);
  }
  redirect(`/practice?course=${courseId}`);
}

export async function attemptAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  const topicId = String(formData.get("topicId") || "") || undefined;
  const attempt = startAttempt(getAppDb(), user.id, { courseId, topicId, kind: String(formData.get("kind") ?? "practice"), timingMode: String(formData.get("timing") ?? "untimed"), clientToken: String(formData.get("token") ?? newId()) });
  const questionId = String(formData.get("questionId") ?? "");
  const selected = Number(formData.get("selected"));
  try {
    if (formData.get("interrupt") === "1") {
      interruptAttempt(getAppDb(), user.id, attempt.id);
      redirect("/arena?status=interrupted");
    }
    answerAttempt(getAppDb(), user.id, attempt.id, questionId, selected);
    submitAttempt(getAppDb(), user.id, attempt.id);
  } catch (error) {
    fail("/practice", error);
  }
  redirect(`/practice?course=${courseId}&attempt=${attempt.id}`);
}

export async function cardAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") || "") || undefined;
  const deck = createDeck(getAppDb(), user.id, { title: String(formData.get("deck") ?? "Deck"), courseId }) as { id: string };
  addCard(getAppDb(), user.id, { deckId: deck.id, front: String(formData.get("front") ?? ""), back: String(formData.get("back") ?? ""), label: "learner_authored" });
  redirect("/cards");
}

export async function reviewAction(formData: FormData) {
  const user = await requireUser();
  try {
    reviewCard(getAppDb(), user.id, String(formData.get("cardId") ?? ""), Number(formData.get("quality") ?? 0), formData.get("revealed") === "on", "self_rated");
  } catch (error) {
    fail("/cards", error);
  }
  redirect("/cards");
}

export async function taskAction(formData: FormData) {
  const user = await requireUser();
  createTask(getAppDb(), user.id, { title: String(formData.get("title") ?? ""), courseId: String(formData.get("courseId") || "") || undefined, dueAt: String(formData.get("due") || "") || undefined, origin: "learner", confirmed: true, reason: "Added by the learner." });
  redirect("/planner");
}

export async function confirmTaskAction(formData: FormData) {
  const user = await requireUser();
  confirmTask(getAppDb(), user.id, String(formData.get("taskId") ?? ""));
  redirect("/planner");
}

export async function completeTaskAction(formData: FormData) {
  const user = await requireUser();
  try {
    completeTask(getAppDb(), user.id, String(formData.get("taskId") ?? ""));
  } catch (error) {
    fail("/planner", error);
  }
  redirect("/planner");
}

export async function sessionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("sessionId") || "") || startSession(getAppDb(), user.id, { courseId: String(formData.get("courseId") || "") || undefined, kind: "study" });
  if (formData.get("pause") === "1") pauseSession(getAppDb(), user.id, id, Number(formData.get("pausedMs") ?? 0));
  if (formData.get("complete") === "1") completeSession(getAppDb(), user.id, id);
  redirect("/today");
}

export async function cramAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  const proposal = proposeCram(getAppDb(), user.id, { courseId, title: String(formData.get("title") ?? "Exam"), examDate: String(formData.get("date") ?? ""), availableHours: Number(formData.get("hours") ?? 0), syllabus: String(formData.get("syllabus") ?? "") });
  if (formData.get("confirm") === "1") confirmCram(getAppDb(), user.id, proposal);
  redirect(`/cram?course=${courseId}&insufficient=${proposal.insufficientTime ? "1" : "0"}&minutes=${proposal.suggestedMinutes}`);
}

export async function autopilotAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  const proposal = proposeAutopilot(getAppDb(), user.id, courseId);
  if (formData.get("confirm") !== "1") redirect(`/autopilot?course=${courseId}&proposed=1&changes=${proposal.after.filter((row) => row.changed).length}`);
  const result = confirmAutopilot(getAppDb(), user.id, proposal);
  redirect(`/autopilot?course=${courseId}&applied=${result.applied ? "1" : "0"}`);
}

export async function circleAction(formData: FormData) {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "create") createCircle(getAppDb(), user.id, String(formData.get("name") ?? ""));
    if (intent === "invite") {
      inviteToCircle(getAppDb(), user.id, String(formData.get("circleId") ?? ""), String(formData.get("email") ?? ""));
    }
    if (intent === "accept") acceptInvite(getAppDb(), user.id, String(formData.get("circleId") ?? ""));
    if (intent === "revoke") revokeMember(getAppDb(), user.id, String(formData.get("circleId") ?? ""), String(formData.get("memberId") ?? ""));
    if (intent === "post") postToCircle(getAppDb(), user.id, String(formData.get("circleId") ?? ""), String(formData.get("body") ?? ""));
  } catch (error) {
    fail("/circle", error);
  }
  redirect("/circle");
}

export async function gameAction(formData: FormData) {
  const user = await requireUser();
  const scored = scoreBuiltInGame([String(formData.get("one") ?? ""), String(formData.get("two") ?? "")]);
  saveGame(getAppDb(), user.id, scored.score, scored.total);
  redirect(`/games?score=${scored.score}&total=${scored.total}`);
}

export async function radarAction(formData: FormData) {
  const user = await requireUser();
  correctMisconception(getAppDb(), user.id, String(formData.get("id") ?? ""));
  redirect("/radar");
}

export async function settingsAction(formData: FormData) {
  const user = await requireUser();
  const rev = Number(formData.get("rev") ?? 1);
  const result = saveProfile(getAppDb(), user.id, {
    display_name: String(formData.get("displayName") ?? ""),
    timezone: String(formData.get("timezone") ?? "UTC"),
    goals_text: String(formData.get("goals") ?? ""),
    explanation_depth: String(formData.get("depth") ?? "intermediate"),
    offline_consent: formData.get("offline") === "on" ? 1 : 0,
    onboarding_status: "completed",
  }, rev);
  redirect(`/settings?status=${result.status}`);
}

export async function privacyAction(formData: FormData) {
  const user = await requireUser();
  grantPrivacy(getAppDb(), user.id, String(formData.get("provider") ?? ""), "private_content");
  redirect("/settings");
}

export async function deleteAccountAction() {
  const user = await requireUser();
  deleteAccount(getAppDb(), user.id);
  await clearSession();
  redirect("/register?deleted=1");
}

export async function readNoticeAction(formData: FormData) {
  const user = await requireUser();
  markNotificationRead(getAppDb(), user.id, String(formData.get("id") ?? ""));
  redirect("/activity");
}

export async function chatMetaAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("chatId") ?? "");
  if (formData.get("delete") === "1") deleteChat(getAppDb(), user.id, id);
  else renameChat(getAppDb(), user.id, id, String(formData.get("title") ?? ""));
  redirect("/companion");
}

export async function routePreview() {
  return planRoute({
    task: "tutoring",
    required: ["text"],
    sensitivity: "ordinary",
    audience: "unknown",
    billingTier: "unknown",
    grants: [],
    retention: "strict",
    costMode: "unknown_cost_allowed",
    residency: "unspecified",
    independentCheck: false,
    online: true,
    configuredProviders: [],
  });
}

export async function ownedCourse(courseId: string, userId: string) {
  return get(getAppDb(), "SELECT id FROM courses WHERE id = ? AND user_id = ?", courseId, userId);
}
