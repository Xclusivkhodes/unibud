import { expect, test } from "vitest";
import { calendarDayDecision, composite, confirmPayload, contrastRatio, markedScoreLine, previewFault, readCourse, readCramPreview, readGameScore, readTopic, reviewPhase, tokens } from "../src/components/present.js";
import { allDestinations, mobileNav, searchDestinations } from "../src/nav.js";

test("a game score is omitted unless both score and total are present", () => {
  expect(markedScoreLine(1, undefined)).toBeNull();
  expect(markedScoreLine(1, null)).toBeNull();
  expect(readGameScore({ score: 1, learningClaim: "not_mastery" })).toBeNull();
  expect(readGameScore({ id: "g", score: 1, total: 2, learningClaim: "not_mastery", bank: "built_in_practice_set" })).toMatchObject({ score: 1, total: 2, claim: "not_mastery" });
  expect(readGameScore({ score: 1, total: 2, learning_claim: "not_mastery" })?.line).toBe("Score 1 / 2. Not mastery.");
});

test("course and topic views use the snake_case wire fields", () => {
  expect(readCourse({ id: "c", name: "Biology", subjectName: "Life", goal: "Pass" })).toBeNull();
  expect(readCourse({ id: "c", name: "Biology", subject_name: "Life", goal_text: "Pass" })).toEqual({ id: "c", name: "Biology", subject: "Life", goal: "Pass" });
  expect(readTopic({ id: "t", name: "Cells", courseId: "c", selfReportedLevel: "new" })).toBeNull();
  expect(readTopic({ id: "t", name: "Cells", course_id: "c", self_reported_level: "new" })).toEqual({ id: "t", courseId: "c", name: "Cells", selfReportedLevel: "new" });
});

test("schedule confirmation sends only the preview id and names each preview fault", () => {
  expect(confirmPayload("preview-1")).toEqual({ previewId: "preview-1" });
  expect(Object.keys(confirmPayload("preview-1"))).toEqual(["previewId"]);
  expect(previewFault("preview_required")).toBe("preview_required");
  expect(previewFault("preview_not_found")).toBe("preview_not_found");
  expect(previewFault("preview_consumed")).toBe("preview_consumed");
  expect(previewFault("stale_preview")).toBe("stale_preview");
  expect(previewFault("conflict")).toBeNull();
  expect(reviewPhase({ phase: "ready", formKey: "a", reviewedKey: "b", empty: false })).toBe("stale");
  expect(reviewPhase({ phase: "conflict", formKey: "a", reviewedKey: "a", empty: false })).toBe("conflict");
  expect(readCramPreview({ priorities: [], fingerprint: "abc" })).toBeNull();
  const preview = readCramPreview({ previewId: "p", fingerprint: "f", dueSemantics: "calendar_day", priorities: [], impossible: true, insufficientTime: true });
  expect(preview?.dueSemantics).toBe("calendar_day");
  expect(preview?.impossible).toBe(true);
});

test("today remains a valid calendar bucket in the afternoon", () => {
  expect(calendarDayDecision("2026-11-09", "2026-11-09")).toBe("ok");
  expect(calendarDayDecision("2026-11-08", "2026-11-09")).toBe("past");
});

test("glass text meets the reading contrast floor", () => {
  const glass = composite(tokens.navy, tokens.base, 0.9);
  expect(contrastRatio(tokens.ivory, glass)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tokens.muted, glass)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tokens.ink, tokens.ivory)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tokens.ink, tokens.amber)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tokens.teal, tokens.ivory)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(tokens.amber, tokens.navy)).toBeGreaterThanOrEqual(3);
});

test("navigation keeps Study Companion and the five mobile labels", () => {
  expect(allDestinations().map((item) => item.label)).toContain("Study Companion");
  expect(allDestinations().some((item) => item.label === "Gemma Study Companion")).toBe(false);
  expect(searchDestinations("gemma")[0]?.label).toBe("Study Companion");
  expect(mobileNav.map((item) => item.label)).toEqual(["Today", "Courses", "Practice", "Plan", "Tools"]);
  expect(allDestinations()).toHaveLength(23);
});
