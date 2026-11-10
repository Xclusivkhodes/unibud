/** Presentation helpers. No database, server, or provider imports. */

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
  stale_preview: "That preview is stale. Refresh the proposal and review it again. Nothing was applied.",
  preview_consumed: "That preview was already used. Request a new proposal. Nothing new was applied.",
  preview_not_found: "That preview is not on this account. Nothing was applied.",
  conflict: "The server reported a conflict and did not overwrite the newer copy.",
  csrf_required: "The safety header was missing, so nothing was saved.",
  csrf_origin: "The request origin was rejected, so nothing was saved.",
  unauthenticated: "Sign in to continue.",
  offline: "You appear to be offline. Nothing was sent.",
  internal: "The action could not be completed.",
  invalid_hours: "Enter a number of hours.",
  invalid_json: "The server rejected the request body.",
  empty_upload: "Choose a file that is not empty.",
  upload_too_large: "That file is larger than the server accepts.",
  compressed_not_accepted: "Compressed files are not accepted.",
  mime_rejected: "Use plain text, Markdown, or a JPEG, PNG, or WebP image.",
  attempt_closed: "That attempt is no longer open.",
  forbidden: "That action is not allowed.",
  not_executed: "No model reply was produced.",
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

export function codeFrom(body: unknown, status: number): string {
  const row = record(body);
  if (row && typeof row.error === "string" && row.error) return row.error;
  if (row && typeof row.status === "string" && status >= 400) return row.status;
  if (status === 401) return "unauthenticated";
  if (status === 404) return "not_found";
  if (status === 0) return "offline";
  return "internal";
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

export function markedScoreLine(score: unknown, total: unknown): string | null {
  if (score === undefined || total === undefined || score === null || total === null || score === "" || total === "") return null;
  const scored = typeof score === "number" ? score : Number(score);
  const outOf = typeof total === "number" ? total : Number(total);
  if (!Number.isInteger(scored) || !Number.isInteger(outOf) || outOf < 1 || scored < 0 || scored > outOf) return null;
  return `Score ${scored} / ${outOf}. Not mastery.`;
}

export type CourseView = { id: string; name: string; subject: string; goal: string };

export function readCourse(value: unknown): CourseView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || row.name.trim() === "") return null;
  return { id: row.id, name: row.name, subject: text(row.subject_name) || text(row.subjectName), goal: text(row.goal_text) || text(row.goal) };
}

export type TaskView = { id: string; title: string; dueAt: string | null; status: string; confirmed: boolean; courseId: string; topicId: string };

export function readTask(value: unknown): TaskView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string") return null;
  const confirmed = row.confirmed === true || row.confirmed === 1;
  return {
    id: row.id,
    title: row.title,
    dueAt: typeof row.due_at === "string" ? row.due_at : typeof row.dueAt === "string" ? row.dueAt : null,
    status: text(row.status) || "open",
    confirmed,
    courseId: text(row.course_id) || text(row.courseId),
    topicId: text(row.topic_id) || text(row.topicId),
  };
}

export type TopicView = { id: string; courseId: string; name: string; selfReportedLevel: string };

export function readTopic(value: unknown): TopicView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    courseId: text(row.course_id) || text(row.courseId),
    name: row.name,
    selfReportedLevel: text(row.self_reported_level) || text(row.selfReportedLevel),
  };
}

export type SourceView = { id: string; courseId: string; topicId: string; title: string; body: string };

export function readSource(value: unknown): SourceView | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    courseId: text(row.course_id) || text(row.courseId),
    topicId: text(row.topic_id) || text(row.topicId),
    title: row.title,
    body: text(row.body),
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
  if (dueAt.endsWith("T00:00:00.000Z")) return `${day} calendar day, not an appointment`;
  return dueAt;
}

export function mobileDestination(pathname: string): "/today" | "/courses" | "/practice" | "/planner" | "/tools" {
  if (pathname === "/today") return "/today";
  if (pathname === "/courses" || pathname.startsWith("/courses/")) return "/courses";
  if (pathname === "/practice") return "/practice";
  if (pathname === "/planner") return "/planner";
  return "/tools";
}

export type BrowserMemory = {
  topics: Array<{ id: string; courseId: string; name: string; selfReportedLevel: string }>;
  questions: Array<{ id: string; courseId: string; topicId: string; prompt: string; choices: string[] }>;
  chats: Array<{ id: string; title: string }>;
  circles: Array<{ id: string; name: string }>;
  decks: Array<{ id: string; title: string }>;
  sessionId: string;
};

export const emptyMemory = (): BrowserMemory => ({ topics: [], questions: [], chats: [], circles: [], decks: [], sessionId: "" });

export function parseMemory(raw: string | null): BrowserMemory {
  if (!raw) return emptyMemory();
  try {
    const value = JSON.parse(raw) as unknown;
    const row = record(value);
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
    base.sessionId = text(row.sessionId);
    return base;
  } catch {
    return emptyMemory();
  }
}

export const BUILT_IN_PROMPTS = ["Range formula name", "Negative log10 of strong-acid concentration"] as const;

export const gaps = {
  explanations: "Saving an explanation needs an artifact route. None is in the current API, so this page does not store one.",
  packs: "Study packs need a compiler route. None is in the current API, so nothing is composed.",
  notifications: "Notifications are not listed. There is no activity endpoint, so unread counts are not shown.",
  profile: "GET /api/me returns id, email, and data class. Preferred name, timezone, and AI preferences are not returned, and there is no profile update route.",
  exams: "Exam rows are not listed. A cram confirmation can create tasks you can read; the exam title itself is not returned by a list.",
  attempts: "Submitted attempts are not listed. A result appears only for the attempt you just submitted.",
  questions: "Saved questions are not listed. The prompt below is the text you typed next to the id the server returned.",
  topics: "Topics are not listed after reload. A topic stays visible here only from the response returned when you added it.",
  chats: "Chats are not listed. A conversation stays visible here only from the id returned when you opened it.",
  circles: "Circle membership is not listed. A circle stays visible here only from the id returned when you created it.",
  renameChat: "Renaming a chat needs PATCH. The Next /api route exports GET, POST, and DELETE, so rename is not sent.",
  taskComplete: "Marking a task done is not an HTTP route, so completion is unavailable.",
  bookmarks: "Saving a video reference is not an HTTP route. YouTube search is not executed.",
  otherLabs: "Only projectile motion has a route. Strong-acid pH, Punnett, bubble sort, and sine are not run from this page.",
  streak: "Streak and lifetime study minutes are not listed. Minutes appear only for a session you complete in this view.",
} as const;
