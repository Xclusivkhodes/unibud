/** Shared HTTP shapes. This module imports no database or provider SDK. */

export const API_CONTRACT_VERSION = 2;

export type ApiError = { error: string };

export type PreviewErrorCode = "preview_required" | "preview_not_found" | "preview_consumed" | "stale_preview";

export type SessionUser = { id: string; email: string; dataClass: string };

export type EducationLevel = "university" | "senior_high" | "junior_high";
export type AgeBand = "under_13" | "13_17" | "18_plus";
export type AccountStatus = "active" | "pending_parental_consent";

/** Frozen /api/me shape. Null claims mean the profile is unfinished, not an assumed level or band. */
export type MeResponse = {
  id: string;
  email: string;
  dataClass: string;
  education_level: EducationLevel | null;
  age_band: AgeBand | null;
  account_status: AccountStatus;
  ai_available: boolean;
  needs_profile_completion: boolean;
};

export type CourseFit = { score: number; signals: string[] };

/** GET /api/courses and GET /api/courses/:id. Snake_case columns, not the full row. */
export type CourseSummary = {
  id: string;
  name: string;
  subject_name: string;
  goal_text: string;
};

/** POST /api/courses returns the full SQLite row. GET does not add user_id, created_at, or rev. */
export type CourseRecord = CourseSummary & {
  user_id: string;
  created_at: string;
  rev: number;
};

/** SQLite topic row from POST /api/courses/:id/topics. */
export type TopicRecord = {
  id: string;
  course_id: string;
  user_id: string;
  name: string;
  self_reported_level: string;
  created_at: string;
  rev: number;
};

export type CalendarPreview = {
  previewId: string;
  fingerprint: string;
  contractVersion: 2;
  dueSemantics: "calendar_day";
  impossible: boolean;
  windowStart: string | null;
  windowEnd: string | null;
};

export type CramPriority = {
  topicId: string;
  name: string;
  accuracy: number | null;
  reason: string;
  minutes: number;
  dueDay: string | null;
  dueAt: string | null;
  dueSemantics: "calendar_day";
};

/** POST /api/cram/preview. Confirm writes these stored priorities and does not recompute them. */
export type CramPreviewResponse = CalendarPreview & {
  priorities: CramPriority[];
  suggestedMinutes: number;
  neededMinutes: number;
  insufficientTime: boolean;
  predictsFutureQuestions: false;
  examDate: string;
  syllabus: string;
  title: string;
  courseId: string;
  availableHours: number;
};

export type AutopilotAfterRow = {
  id: string;
  title: string;
  dueDay: string | null;
  dueAt: string | null;
  dueSemantics: "calendar_day";
  rev: number;
  placed: boolean;
  outsideWindow: boolean;
  changed: boolean;
};

/** POST /api/autopilot/preview. `before` keeps SQLite `due_at`. Confirm writes `after`. */
export type AutopilotPreviewResponse = CalendarPreview & {
  before: Array<{ id: string; title: string; due_at: string | null; rev: number }>;
  after: AutopilotAfterRow[];
  conflicts: string[];
  applied: false;
  courseId: string;
};

export type UploadJson = { id: string; mime: string; byteLength: number; storage: "private" };

export type OwnedLabRun = { id: string; lab: string; assumptions: string; created_at: string };

export type OwnedGameResult = { id: string; game: string; score: number; total: number; learning_claim: string };

export type OwnedChatMessage = { id: string; role: string; content: string; status: string };

export type OwnedGraphNode = { id: string; label: string; topic_id: string | null };

export type OwnedSession = { id: string; status: string; kind: string; started_at: string };

export type Evidence = { correct: number; total: number } | null;

export type ProviderPublicStatus = {
  provider: string;
  model: string;
  configured: boolean;
  eligible: false | boolean;
  liveVerified: false;
  operational: false;
  blockReason: string | null;
};

export type YoutubePublicStatus = {
  configured: boolean;
  search: "unconfigured" | "not_executed";
  captionDownload: false;
  captionReason: string;
};
