/** Shared HTTP shapes. This module imports no database or provider SDK. */

export type ApiError = { error: string };

export type SessionUser = { id: string; email: string; dataClass: string };

export type CourseRecord = { id: string; name: string; subjectName: string; goal: string };

export type TopicRecord = { id: string; courseId: string; name: string; selfReportedLevel: string };

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
