/** Presentation helpers. No database, server, or provider imports. */

import type { PreviewErrorCode } from "../contract/types.js";

export const tokens = {
  base: "#081727",
  navy: "#14263D",
  ivory: "#F7F4ED",
  muted: "#BAC9D7",
  ink: "#14263D",
  teal: "#28736C",
  amber: "#E5B85C",
  readingBorder: "#4A6278",
} as const;

const messages: Record<string, string> = {
  invalid_login: "Email or password was not accepted.",
  email_taken: "That email is already registered.",
  invalid_email: "Enter an email address.",
  weak_password: "Use at least 10 characters.",
  question_out_of_scope: "That question belongs to a different course or topic.",
  invalid_selection: "Choose one of the stored answers.",
  invalid_answer_key: "The answer key must point at one of the choices.",
  invalid_choices: "Enter at least two non-empty choices.",
  reveal_required: "Show the answer before you rate the card.",
  invalid_quality: "Use a whole-number self-rating from 0 to 5.",
  not_found: "That record is not available to this account.",
  preview_required: "Confirmation needs the preview identifier from the proposal you are looking at.",
  stale_preview: "That proposal is out of date. Your courses changed, and nothing was saved.",
  preview_consumed: "That preview was already used. Request a new proposal. Nothing new was applied.",
  preview_not_found: "That preview is not on this account. Nothing was applied.",
  conflict: "A newer copy exists, so the dates were not changed.",
  csrf_required: "The safety header was missing, so nothing was saved.",
  csrf_origin: "The request origin was rejected, so nothing was saved.",
  unauthenticated: "Sign in to continue.",
  forbidden: "That action is not allowed for this account.",
  offline: "You appear to be offline. Nothing was sent.",
  internal: "The action could not be completed.",
  invalid_hours: "Enter a number of hours.",
  invalid_json: "The server rejected the request body.",
  invalid_lab_input: "Speed must be zero or greater, and the angle must be between 0 and 90 degrees.",
  empty_upload: "Choose a file that is not empty.",
  upload_too_large: "That file is larger than the server accepts.",
  compressed_not_accepted: "Compressed files are not accepted.",
  mime_rejected: "Use plain text, Markdown, or a JPEG, PNG, or WebP image.",
  attempt_closed: "That attempt is no longer open.",
  attempt_unscoped: "That attempt has no course or topic, so an answer was not stored.",
  not_executed: "No model reply was produced.",
  body_too_large: "That request was larger than the server accepts.",
};

export function messageFor(code?: string): string {
  if (!code) return "";
  return messages[code] ?? "The action could not be completed.";
}

export function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function listField(body: unknown, key: string): unknown[] {
  const row = record(body);
  const value = row?.[key];
  return Array.isArray(value) ? value : [];
}

export function codeFrom(body: unknown, status: number): string {
  const row = record(body);
  if (row && typeof row.error === "string" && row.error) return row.error;
  if (row && typeof row.status === "string" && status >= 400) return row.status;
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 0) return "offline";
  return "internal";
}

export type PreviewFault = PreviewErrorCode;

export function previewFault(code: string): PreviewFault | null {
  if (code === "preview_required" || code === "preview_not_found" || code === "preview_consumed" || code === "stale_preview") return code;
  return null;
}

export function stateKind(code: string): "offline" | "denied" | "unconfigured" | "error" {
  if (code === "offline") return "offline";
  if (code === "unauthenticated" || code === "forbidden" || code === "csrf_required" || code === "csrf_origin") return "denied";
  if (code === "unconfigured") return "unconfigured";
  return "error";
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function linear(channelValue: number): number {
  const value = channelValue / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function composite(foreground: string, background: string, alpha: number): string {
  const mixed = [0, 1, 2].map((index) => Math.round(channel(foreground, index) * alpha + channel(background, index) * (1 - alpha)));
  return `#${mixed.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** A built-in score is shown only when both contract fields are present and form a real fraction. */
export function markedScoreLine(score: unknown, total: unknown): string | null {
  if (score === undefined || total === undefined || score === null || total === null || score === "" || total === "") return null;
  const scored = typeof score === "number" ? score : Number(score);
  const outOf = typeof total === "number" ? total : Number(total);
  if (!Number.isInteger(scored) || !Number.isInteger(outOf) || outOf < 1 || scored < 0 || scored > outOf) return null;
  return `Score ${scored} / ${outOf}. Not mastery.`;
}

export type GameScoreView = { score: number; total: number; claim: string; line: string };

export function readGameScore(value: unknown): GameScoreView | null {
  const row = record(value);
  if (!row) return null;
  const line = markedScoreLine(row.score, row.total);
  if (!line) return null;
  const scored = typeof row.score === "number" ? row.score : Number(row.score);
  const outOf = typeof row.total === "number" ? row.total : Number(row.total);
  const claim = typeof row.learningClaim === "string" ? row.learningClaim : typeof row.learning_claim === "string" ? row.learning_claim : "";
  return { score: scored, total: outOf, claim, line };
}

export type CourseView = { id: string; name: string; subject: string; goal: string };

export function readCourse(value: unknown): CourseView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || row.name.trim() === "") return null;
  if (typeof row.subject_name !== "string" || typeof row.goal_text !== "string") return null;
  return { id: row.id, name: row.name, subject: row.subject_name, goal: row.goal_text };
}

export type TaskView = { id: string; title: string; dueAt: string | null; status: string; confirmed: boolean; courseId: string; topicId: string };

export function readTask(value: unknown): TaskView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    title: row.title,
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    status: text(row.status) || "open",
    confirmed: row.confirmed === true || row.confirmed === 1,
    courseId: typeof row.course_id === "string" ? row.course_id : "",
    topicId: typeof row.topic_id === "string" ? row.topic_id : "",
  };
}

export type TopicView = { id: string; courseId: string; name: string; selfReportedLevel: string };

export function readTopic(value: unknown): TopicView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  if (typeof row.course_id !== "string" || typeof row.self_reported_level !== "string") return null;
  return { id: row.id, courseId: row.course_id, name: row.name, selfReportedLevel: row.self_reported_level };
}

export type SourceView = { id: string; courseId: string; topicId: string; title: string };

export function readSource(value: unknown): SourceView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    courseId: typeof row.course_id === "string" ? row.course_id : "",
    topicId: typeof row.topic_id === "string" ? row.topic_id : "",
    title: row.title,
  };
}

export type CramPriority = {
  topicId: string;
  name: string;
  accuracy: number | null;
  reason: string;
  minutes: number;
  dueDay: string | null;
  dueAt: string | null;
};

export type CramPreview = {
  previewId: string;
  fingerprint: string;
  dueSemantics: string;
  priorities: CramPriority[];
  suggestedMinutes: number | null;
  neededMinutes: number | null;
  insufficientTime: boolean;
  impossible: boolean;
  predictsFutureQuestions: boolean | null;
  title: string;
  examDate: string;
  windowStart: string | null;
  windowEnd: string | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readCramPreview(value: unknown): CramPreview | null {
  const row = record(value);
  if (!row || !text(row.previewId) || !text(row.fingerprint)) return null;
  const priorities = Array.isArray(row.priorities)
    ? row.priorities.flatMap((item) => {
        const priority = record(item);
        if (!priority) return [];
        return [{
          topicId: text(priority.topicId),
          name: text(priority.name) || "Untitled topic",
          accuracy: numberOrNull(priority.accuracy),
          reason: text(priority.reason),
          minutes: numberOrNull(priority.minutes) ?? 0,
          dueDay: text(priority.dueDay) || null,
          dueAt: text(priority.dueAt) || null,
        }];
      })
    : [];
  return {
    previewId: text(row.previewId),
    fingerprint: text(row.fingerprint),
    dueSemantics: text(row.dueSemantics),
    priorities,
    suggestedMinutes: numberOrNull(row.suggestedMinutes),
    neededMinutes: numberOrNull(row.neededMinutes),
    insufficientTime: row.insufficientTime === true,
    impossible: row.impossible === true,
    predictsFutureQuestions: typeof row.predictsFutureQuestions === "boolean" ? row.predictsFutureQuestions : null,
    title: text(row.title),
    examDate: text(row.examDate),
    windowStart: text(row.windowStart) || null,
    windowEnd: text(row.windowEnd) || null,
  };
}

export type AutopilotRow = {
  id: string;
  title: string;
  dueAt: string | null;
  dueDay: string | null;
  placed: boolean | null;
  changed: boolean | null;
  outsideWindow: boolean | null;
  rev: number | null;
};

export type AutopilotPreview = {
  previewId: string;
  fingerprint: string;
  dueSemantics: string;
  before: AutopilotRow[];
  after: AutopilotRow[];
  conflicts: string[];
  applied: boolean;
  impossible: boolean;
  windowStart: string | null;
  windowEnd: string | null;
};

function readAutopilotRow(value: unknown): AutopilotRow | null {
  const row = record(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    title: text(row.title),
    dueAt: text(row.dueAt) || text(row.due_at) || null,
    dueDay: text(row.dueDay) || null,
    placed: typeof row.placed === "boolean" ? row.placed : null,
    changed: typeof row.changed === "boolean" ? row.changed : null,
    outsideWindow: typeof row.outsideWindow === "boolean" ? row.outsideWindow : null,
    rev: typeof row.rev === "number" ? row.rev : null,
  };
}

export function readAutopilotPreview(value: unknown): AutopilotPreview | null {
  const row = record(value);
  if (!row || !text(row.previewId) || !text(row.fingerprint)) return null;
  return {
    previewId: text(row.previewId),
    fingerprint: text(row.fingerprint),
    dueSemantics: text(row.dueSemantics),
    before: Array.isArray(row.before) ? row.before.flatMap((item) => { const parsed = readAutopilotRow(item); return parsed ? [parsed] : []; }) : [],
    after: Array.isArray(row.after) ? row.after.flatMap((item) => { const parsed = readAutopilotRow(item); return parsed ? [parsed] : []; }) : [],
    conflicts: Array.isArray(row.conflicts) ? row.conflicts.map((item) => text(item)).filter(Boolean) : [],
    applied: row.applied === true,
    impossible: row.impossible === true,
    windowStart: text(row.windowStart) || null,
    windowEnd: text(row.windowEnd) || null,
  };
}

export function confirmPayload(previewId: string): { previewId: string } {
  return { previewId };
}

export type ReviewPhase = "idle" | "pending" | "review" | "stale" | "empty" | "error" | "offline" | "applied" | "conflict";

export function reviewPhase(input: { phase: "idle" | "pending" | "ready" | "error" | "offline" | "applied" | "conflict"; formKey: string; reviewedKey: string | null; empty: boolean }): ReviewPhase {
  if (input.phase === "pending") return "pending";
  if (input.phase === "error") return "error";
  if (input.phase === "offline") return "offline";
  if (input.phase === "applied") return "applied";
  if (input.phase === "conflict") return "conflict";
  if (!input.reviewedKey) return "idle";
  if (input.formKey !== input.reviewedKey) return "stale";
  if (input.empty) return "empty";
  return "review";
}

export function calendarDayDecision(day: string, todayUtc: string): "empty" | "invalid" | "past" | "ok" {
  if (!day) return "empty";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "invalid";
  if (day < todayUtc) return "past";
  return "ok";
}

export function calendarBucketLabel(dueAt: string | null): string {
  if (!dueAt) return "No day bucket";
  const day = dueAt.slice(0, 10);
  if (dueAt.endsWith("T00:00:00.000Z")) return `${day}, a whole day rather than a clock time`;
  return dueAt;
}

const practiceHrefs = new Set(["/practice", "/cards", "/memory", "/stress", "/games"]);
const planHrefs = new Set(["/planner", "/twin", "/radar", "/autopilot"]);

export function mobileDestination(pathname: string): "/today" | "/courses" | "/practice" | "/planner" | "/tools" {
  if (pathname === "/today") return "/today";
  if (pathname === "/courses" || pathname.startsWith("/courses/")) return "/courses";
  if (practiceHrefs.has(pathname)) return "/practice";
  if (planHrefs.has(pathname)) return "/planner";
  return "/tools";
}

export type RememberedQuestion = { id: string; courseId: string; topicId: string; prompt: string; choices: string[] };

export type BrowserMemory = {
  topics: TopicView[];
  questions: RememberedQuestion[];
  chats: Array<{ id: string; title: string }>;
  circles: Array<{ id: string; name: string }>;
  decks: Array<{ id: string; title: string }>;
  missed: Array<{ questionId: string; prompt: string; courseId: string; topicId: string }>;
  sessionId: string;
};

export const emptyMemory = (): BrowserMemory => ({ topics: [], questions: [], chats: [], circles: [], decks: [], missed: [], sessionId: "" });

export function parseMemory(raw: string | null): BrowserMemory {
  if (!raw) return emptyMemory();
  try {
    const row = record(JSON.parse(raw) as unknown);
    if (!row) return emptyMemory();
    const base = emptyMemory();
    if (Array.isArray(row.topics)) base.topics = row.topics.flatMap((item) => { const topic = readTopic(item); return topic ? [topic] : []; });
    if (Array.isArray(row.questions)) {
      base.questions = row.questions.flatMap((item) => {
        const question = record(item);
        if (!question || typeof question.id !== "string" || typeof question.prompt !== "string" || !Array.isArray(question.choices)) return [];
        return [{ id: question.id, courseId: text(question.courseId), topicId: text(question.topicId), prompt: question.prompt, choices: question.choices.map((choice) => text(choice)) }];
      });
    }
    if (Array.isArray(row.chats)) base.chats = row.chats.flatMap((item) => { const chat = record(item); return chat && typeof chat.id === "string" ? [{ id: chat.id, title: text(chat.title) }] : []; });
    if (Array.isArray(row.circles)) base.circles = row.circles.flatMap((item) => { const circle = record(item); return circle && typeof circle.id === "string" ? [{ id: circle.id, name: text(circle.name) }] : []; });
    if (Array.isArray(row.decks)) base.decks = row.decks.flatMap((item) => { const deck = record(item); return deck && typeof deck.id === "string" ? [{ id: deck.id, title: text(deck.title) }] : []; });
    if (Array.isArray(row.missed)) {
      base.missed = row.missed.flatMap((item) => {
        const missed = record(item);
        if (!missed || typeof missed.questionId !== "string" || typeof missed.prompt !== "string") return [];
        return [{ questionId: missed.questionId, prompt: missed.prompt, courseId: text(missed.courseId), topicId: text(missed.topicId) }];
      });
    }
    base.sessionId = text(row.sessionId);
    return base;
  } catch {
    return emptyMemory();
  }
}

export const BUILT_IN_PROMPTS = ["Range formula name", "Negative log10 of strong-acid concentration"] as const;

const paidProviders = new Set(["openai", "anthropic", "xai"]);

/** Student label from the API `configured` flag. Paid providers stay "Not set up". */
export function providerStudentStatus(provider: string, configured: boolean): "Not set up" | "Not available yet: this model isn't set up" {
  if (paidProviders.has(provider) || !configured) return "Not set up";
  return "Not available yet: this model isn't set up";
}

export const gaps = {
  explanations: "Saving an explanation isn't available yet.",
  packs: "Study packs aren't available yet.",
  notifications: "You don't have any notifications yet.",
  profile: "Your email is shown here. Name, timezone, and AI choices can't be changed yet.",
  exams: "Your upcoming exams will appear here.",
  attempts: "Your marked answers show up after you submit a question.",
  questions: "Questions you write during this visit stay here, in the words you typed.",
  topics: "Topics you add during this visit stay on this page.",
  chats: "Conversations you open during this visit stay here. You can reload their messages.",
  circles: "Circles you create during this visit stay here.",
  taskComplete: "Marking a task done isn't available yet.",
  bookmarks: "Saved videos aren't available yet.",
  otherLabs: "This page runs projectile motion. The other labs aren't available yet.",
  streak: "A streak isn't shown. Minutes appear after you finish a session on this page.",
  sourceBody: "Notes are listed by title.",
  videoCreation: "Video creation isn't set up. UniBud doesn't make paid video. A video here would be a YouTube embed, slides you can read, or speech in your browser.",
} as const;
