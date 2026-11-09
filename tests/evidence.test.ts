import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { get, openDatabase, type Db } from "../src/db.js";
import {
  addQuestion,
  answerAttempt,
  confirmAutopilot,
  confirmCram,
  correctMisconception,
  createCourse,
  createTask,
  createTopic,
  listMisconceptions,
  proposeAutopilot,
  proposeCram,
  refreshMisconceptions,
  registerUser,
  startAttempt,
  submitAttempt,
  twin,
} from "../src/domain.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function db(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "unibud-evidence-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "unibud.sqlite"));
}

function wrongTwice(database: Db, userId: string, courseId: string, topicId: string, questionId: string, prefix: string) {
  for (const token of [`${prefix}-1`, `${prefix}-2`]) {
    const attempt = startAttempt(database, userId, { courseId, topicId, kind: "practice", timingMode: "untimed", clientToken: token });
    answerAttempt(database, userId, attempt.id, questionId, 1);
    submitAttempt(database, userId, attempt.id);
  }
}

test("a topic attempt rejects another topic's question and does not change accuracy", () => {
  const database = db();
  const user = registerUser(database, { email: "scope@example.edu", password: "password123", dataClass: "test_fixture" });
  const courseA = createCourse(database, user.id, { name: "Course A" }) as { id: string };
  const courseB = createCourse(database, user.id, { name: "Course B" }) as { id: string };
  const topicA = createTopic(database, user.id, courseA.id, "Topic A") as { id: string };
  const topicB = createTopic(database, user.id, courseB.id, "Topic B") as { id: string };
  const questionA = addQuestion(database, user.id, { courseId: courseA.id, topicId: topicA.id, prompt: "A?", choices: ["yes", "no"], correctIndex: 0, label: "sourced" });
  const questionB = addQuestion(database, user.id, { courseId: courseB.id, topicId: topicB.id, prompt: "B?", choices: ["yes", "no"], correctIndex: 0, label: "sourced" });
  const attemptA = startAttempt(database, user.id, { courseId: courseA.id, topicId: topicA.id, kind: "practice", timingMode: "untimed", clientToken: "scope-a" });
  expect(() => answerAttempt(database, user.id, attemptA.id, questionB, 1)).toThrow(/outside this attempt/i);
  answerAttempt(database, user.id, attemptA.id, questionA, 0);
  submitAttempt(database, user.id, attemptA.id);
  expect(twin(database, user.id, topicA.id).evidence).toEqual({ correct: 1, total: 1 });
  expect(twin(database, user.id, topicB.id).evidence).toBeNull();
  expect(() => addQuestion(database, user.id, { courseId: courseA.id, topicId: topicA.id, prompt: "Bad key", choices: ["yes", "no"], correctIndex: 3, label: "sourced" })).toThrow(/answer key/i);
  const open = startAttempt(database, user.id, { courseId: courseA.id, topicId: topicA.id, kind: "practice", timingMode: "untimed", clientToken: "bounds" });
  expect(() => answerAttempt(database, user.id, open.id, questionA, 4)).toThrow(/stored choices/i);
});

test("corrected radar stays closed until two new wrongs, and those are the only evidence", () => {
  const database = db();
  const user = registerUser(database, { email: "radar@example.edu", password: "password123", dataClass: "test_fixture" });
  const course = createCourse(database, user.id, { name: "Course" }) as { id: string };
  const topic = createTopic(database, user.id, course.id, "Topic") as { id: string };
  const question = addQuestion(database, user.id, { courseId: course.id, topicId: topic.id, prompt: "Q?", choices: ["right", "wrong"], correctIndex: 0, label: "sourced" });
  wrongTwice(database, user.id, course.id, topic.id, question, "old");
  const first = listMisconceptions(database, user.id).hypotheses as Array<{ id: string; evidence_json: string }>;
  expect(first).toHaveLength(1);
  const oldIds = (JSON.parse(first[0].evidence_json) as { attemptIds: string[] }).attemptIds;
  expect(oldIds).toHaveLength(2);
  correctMisconception(database, user.id, first[0].id);
  refreshMisconceptions(database, user.id);
  expect(listMisconceptions(database, user.id).hypotheses).toHaveLength(0);
  wrongTwice(database, user.id, course.id, topic.id, question, "new");
  const reopened = listMisconceptions(database, user.id).hypotheses as Array<{ evidence_json: string; status: string }>;
  expect(reopened).toHaveLength(1);
  const episode = (JSON.parse(reopened[0].evidence_json) as { attemptIds: string[] }).attemptIds;
  expect(episode).toHaveLength(2);
  expect(episode.some((id) => oldIds.includes(id))).toBe(false);
});

test("cram dates the available minutes and autopilot applies the proposed dues", () => {
  const database = db();
  const user = registerUser(database, { email: "plan@example.edu", password: "password123", dataClass: "test_fixture" });
  const course = createCourse(database, user.id, { name: "Plan" }) as { id: string };
  createTopic(database, user.id, course.id, "One");
  createTopic(database, user.id, course.id, "Two");
  const short = proposeCram(database, user.id, { courseId: course.id, title: "Quiz", examDate: "2026-11-12", availableHours: 0.25, syllabus: "both", now: "2026-11-09T12:00:00.000Z" });
  expect(short.insufficientTime).toBe(true);
  expect(short.suggestedMinutes).toBe(15);
  expect(short.neededMinutes).toBe(60);
  const saved = confirmCram(database, user.id, short);
  expect(saved.taskIds.length).toBeGreaterThan(0);
  const task = get<{ due_at: string }>(database, "SELECT due_at FROM tasks WHERE id = ? AND user_id = ?", saved.taskIds[0], user.id);
  expect(task?.due_at).toMatch(/^2026-11-09T|^2026-11-1/);
  const undated = createTask(database, user.id, { title: "Undated", courseId: course.id, origin: "learner", confirmed: true }) as { id: string };
  const proposal = proposeAutopilot(database, user.id, course.id, "2026-11-09T12:00:00.000Z");
  expect(proposal.applied).toBe(false);
  expect(proposal.after.find((row) => row.id === undated.id)?.changed).toBe(true);
  const applied = confirmAutopilot(database, user.id, proposal);
  expect(applied.applied).toBe(true);
  const after = get<{ due_at: string }>(database, "SELECT due_at FROM tasks WHERE id = ?", undated.id);
  expect(after?.due_at).toBeTruthy();
  expect(confirmAutopilot(database, user.id, proposal).applied).toBe(false);
});
