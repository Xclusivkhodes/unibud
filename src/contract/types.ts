/** Shared HTTP shapes. This module imports no database or provider SDK. */

export const API_CONTRACT_VERSION = 2;

export type ApiError = { error: string };

export type PreviewErrorCode = "preview_required" | "preview_not_found" | "preview_consumed" | "stale_preview";

export type SessionUser = { id: string; email: string; dataClass: string };

/** SQLite course row. These names are what GET and POST /api/courses send. */
export type CourseRecord = {
  id: string;
  user_id: string;
  name: string;
  subject_name: string;
  goal_text: string;
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
};

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
