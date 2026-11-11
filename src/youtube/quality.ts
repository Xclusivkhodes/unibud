export type FirstPartySignals = {
  syllabusTopicMatch: number;
  studentFeedback: number;
  savedRate: number;
  completedRate: number;
};

type YoutubeStatisticsKeys = "viewCount" | "likeCount" | "commentCount" | "favoriteCount" | "statistics";

export type QualityScoreInput = FirstPartySignals & { [K in YoutubeStatisticsKeys]?: never };

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function firstPartyQualityScore(input: QualityScoreInput): number {
  const parts = [input.syllabusTopicMatch, input.studentFeedback, input.savedRate, input.completedRate].map(clampUnit);
  const mean = parts.reduce((sum, value) => sum + value, 0) / parts.length;
  return Math.round(mean * 1000) / 1000;
}

export const COURSE_FIT_SIGNALS = ["syllabus_topic_match", "student_feedback", "saved_rate", "completed_rate"] as const;

export type CourseFit = { score: number; signals: string[] };

export function courseFit(input: QualityScoreInput): CourseFit {
  const score = Math.min(100, Math.max(0, Math.round(firstPartyQualityScore(input) * 100)));
  return { score, signals: [...COURSE_FIT_SIGNALS] };
}
