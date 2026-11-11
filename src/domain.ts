import { rmSync } from "node:fs";
import path from "node:path";
import { AppError, hashPassword, localDate, newId, newSessionToken, nowIso, recordedMinutes, sha256, shiftDate, studyStreak, verifyPassword } from "./security/crypto.js";
import { deviceRoot, uploadRoot } from "./server/paths.js";
import { accountCapabilities, parseAgeBand, parseEducationLevel, type AgeBand, type EducationLevel, type ProfileClaims } from "./server/account-policy.js";
import { isPublicProfileAllowed, isUnder18, minorInviteBlocked, rejectTrackingFields, sessionSecondsFor } from "./server/minor-safety.js";
import { all, get, run, transaction, type Db } from "./db.js";
import { planRoute, type RouteInput } from "./providers/registry.js";
import { reviewSm2, SCHEDULER_ID } from "./learning/scheduler.js";
import { cacheFresh } from "./youtube/api.js";

type Row = Record<string, unknown>;

function must<T>(row: T): NonNullable<T> {
  if (row === undefined || row === null) throw new AppError("not_found", "Not found", 404);
  return row as NonNullable<T>;
}

function activity(db: Db, userId: string, type: string, payload: unknown, at = nowIso()): string {
  const id = newId();
  run(db, "INSERT INTO activity_events (id, user_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, type, JSON.stringify(payload), at);
  return id;
}

function notify(db: Db, userId: string, kind: string, title: string, body: string, sourceEventId: string, at = nowIso()): void {
  run(
    db,
    "INSERT OR IGNORE INTO notifications (id, user_id, kind, title, body, source_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    userId,
    kind,
    title,
    body,
    sourceEventId,
    at,
  );
}

export function registerUser(db: Db, input: { email: string; password: string; dataClass?: "learner" | "test_fixture"; educationLevel?: string; ageBand?: string }): { id: string; email: string; education_level: EducationLevel | null; age_band: AgeBand | null } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("invalid_email", "Email was rejected.");
  if (input.password.length < 10) throw new AppError("weak_password", "Password was rejected.");
  if (get(db, "SELECT id FROM users WHERE email = ?", email)) throw new AppError("email_taken", "Email is already registered.");
  const education_level = input.educationLevel ? parseEducationLevel(input.educationLevel) : null;
  const age_band = input.ageBand ? parseAgeBand(input.ageBand) : null;
  const id = newId();
  const at = nowIso();
  transaction(db, () => {
    run(db, "INSERT INTO users (id, email, password_hash, data_class, created_at) VALUES (?, ?, ?, ?, ?)", id, email, hashPassword(input.password), input.dataClass ?? "learner", at);
    run(db, "INSERT INTO profiles (user_id, education_level, age_band, updated_at) VALUES (?, ?, ?, ?)", id, education_level, age_band, at);
    run(db, "INSERT INTO ai_settings (user_id, updated_at) VALUES (?, ?)", id, at);
  });
  return { id, email, education_level, age_band };
}

export function profileClaimsFor(db: Db, userId: string): { education_level: string | null; age_band: string | null } {
  return get<{ education_level: string | null; age_band: string | null }>(db, "SELECT education_level, age_band FROM profiles WHERE user_id = ?", userId) ?? { education_level: null, age_band: null };
}

export function completeProfile(db: Db, userId: string, input: { educationLevel: string; ageBand: string }): ProfileClaims {
  must(get(db, "SELECT id FROM users WHERE id = ?", userId));
  const education_level = parseEducationLevel(input.educationLevel);
  const age_band = parseAgeBand(input.ageBand);
  const current = profileClaimsFor(db, userId);
  if (current.age_band && current.age_band !== age_band) throw new AppError("age_band_frozen", "Age band is set by the server.", 409);
  if (current.education_level && current.education_level !== education_level) throw new AppError("education_level_frozen", "Education level cannot be changed here.", 409);
  run(db, "UPDATE profiles SET education_level = ?, age_band = ?, updated_at = ?, rev = rev + 1 WHERE user_id = ?", education_level, age_band, nowIso(), userId);
  return { education_level, age_band };
}

export function recordDevMailboxSimulation(db: Db, userId: string, at = nowIso()): void {
  must(get(db, "SELECT id FROM users WHERE id = ?", userId));
  run(db, "UPDATE profiles SET dev_mailbox_simulated_at = ? WHERE user_id = ?", at, userId);
}

const LOGIN_TIMING_HASH = hashPassword("unibud-login-timing");

export function login(db: Db, email: string, password: string, at = nowIso()): { token: string; userId: string; maxAgeSeconds: number } {
  const user = get<{ id: string; password_hash: string }>(db, "SELECT id, password_hash FROM users WHERE email = ?", email.trim().toLowerCase());
  const passwordMatches = verifyPassword(password, user?.password_hash ?? LOGIN_TIMING_HASH);
  if (!user || !passwordMatches) throw new AppError("invalid_login", "Login was rejected.", 401);
  const age = get<{ age_band: AgeBand | null }>(db, "SELECT age_band FROM profiles WHERE user_id = ?", user.id);
  const maxAgeSeconds = sessionSecondsFor(age?.age_band ?? null);
  const token = newSessionToken();
  const expires = new Date(new Date(at).getTime() + maxAgeSeconds * 1000).toISOString();
  run(db, "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), user.id, at, expires);
  return { token, userId: user.id, maxAgeSeconds };
}

export function userFromSession(db: Db, token: string, at = nowIso()): { id: string; email: string; data_class: string } | null {
  const row = get<{ id: string; email: string; data_class: string; expires_at: string }>(
    db,
    `SELECT u.id, u.email, u.data_class, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row || row.expires_at <= at) return null;
  return { id: row.id, email: row.email, data_class: row.data_class };
}

export function logout(db: Db, token: string): void {
  run(db, "DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export function saveProfile(db: Db, userId: string, patch: Record<string, string | number | null>, rev: number) {
  if ("age_band" in patch) throw new AppError("age_band_frozen", "Age band is set by the server.", 409);
  rejectTrackingFields(patch);
  const allowed = ["legal_name", "display_name", "first_name", "institution", "explanation_depth", "formats_json", "accessibility_json", "language", "offline_consent", "available_hours_per_week", "self_reported_confidence", "goals_text", "exam_syllabus_text", "timezone", "onboarding_status"] as const;
  const keys = Object.keys(patch).filter((key) => (allowed as readonly string[]).includes(key));
  if (keys.length === 0) throw new AppError("empty_patch", "Nothing to update.");
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  const result = run(db, `UPDATE profiles SET ${assignments}, updated_at = ?, rev = rev + 1 WHERE user_id = ? AND rev = ?`, ...keys.map((key) => patch[key]), nowIso(), userId, rev);
  if (result.changes !== 1) return { status: "conflict" as const, server: must(get(db, "SELECT * FROM profiles WHERE user_id = ?", userId)) };
  return { status: "acked" as const, rev: rev + 1 };
}

export function createCourse(db: Db, userId: string, input: { name: string; subjectName?: string; goal?: string }) {
  const id = newId();
  const at = nowIso();
  run(db, "INSERT INTO courses (id, user_id, name, subject_name, goal_text, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, input.name.trim(), input.subjectName ?? "", input.goal ?? "", at);
  activity(db, userId, "course_created", { courseId: id }, at);
  return must(get(db, "SELECT * FROM courses WHERE id = ? AND user_id = ?", id, userId));
}

export function createTopic(db: Db, userId: string, courseId: string, name: string, selfReportedLevel = "") {
  must(get(db, "SELECT id FROM courses WHERE id = ? AND user_id = ?", courseId, userId));
  const id = newId();
  run(db, "INSERT INTO topics (id, course_id, user_id, name, self_reported_level, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, courseId, userId, name.trim(), selfReportedLevel, nowIso());
  return must(get(db, "SELECT * FROM topics WHERE id = ? AND user_id = ?", id, userId));
}

export function addSource(db: Db, userId: string, input: { courseId: string; topicId?: string; title: string; body: string; kind?: string }) {
  must(get(db, "SELECT id FROM courses WHERE id = ? AND user_id = ?", input.courseId, userId));
  const id = newId();
  const at = nowIso();
  run(
    db,
    "INSERT INTO sources (id, user_id, course_id, topic_id, kind, title, body, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    userId,
    input.courseId,
    input.topicId ?? null,
    input.kind ?? "note",
    input.title,
    input.body,
    JSON.stringify({ origin: "learner", untrusted: true }),
    at,
  );
  activity(db, userId, "source_added", { sourceId: id, courseId: input.courseId }, at);
  return must(get<Row>(db, "SELECT * FROM sources WHERE id = ? AND user_id = ?", id, userId));
}

export function saveArtifact(db: Db, userId: string, input: { courseId: string; topicId?: string; sourceId?: string; kind: string; title: string; body: string; label: string; depth?: string; status?: string }) {
  if (input.sourceId) must(get(db, "SELECT id FROM sources WHERE id = ? AND user_id = ?", input.sourceId, userId));
  const id = newId();
  const at = nowIso();
  run(
    db,
    `INSERT INTO artifacts (id, user_id, course_id, topic_id, source_id, kind, title, body, label, depth, status, provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    input.courseId,
    input.topicId ?? null,
    input.sourceId ?? null,
    input.kind,
    input.title,
    input.body,
    input.label,
    input.depth ?? null,
    input.status ?? "saved",
    JSON.stringify({ sourceId: input.sourceId ?? null, label: input.label }),
    at,
    at,
  );
  return must(get<Row>(db, "SELECT * FROM artifacts WHERE id = ? AND user_id = ?", id, userId));
}

export function composeOutline(sourceBody: string, sourceId: string): Array<{ sourceId: string; text: string; label: "sourced" }> {
  return sourceBody
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((text) => ({ sourceId, text, label: "sourced" as const }));
}

export function composePack(db: Db, userId: string, sourceIds: string[], courseId: string, topicId?: string) {
  const blocks = sourceIds.map((sourceId) => {
    const source = must(get<{ id: string; title: string; body: string }>(db, "SELECT id, title, body FROM sources WHERE id = ? AND user_id = ?", sourceId, userId));
    return { sourceId: source.id, title: source.title, text: source.body, label: "sourced" as const };
  });
  const body = blocks.map((block) => `[${block.sourceId}] ${block.text}`).join("\n\n");
  return saveArtifact(db, userId, { courseId, topicId, sourceId: sourceIds[0], kind: "study_pack", title: "Study pack", body, label: "sourced" });
}

export function createDeck(db: Db, userId: string, input: { title: string; courseId?: string; topicId?: string; sourceId?: string }) {
  const id = newId();
  run(db, "INSERT INTO decks (id, user_id, course_id, topic_id, source_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, input.courseId ?? null, input.topicId ?? null, input.sourceId ?? null, input.title, nowIso());
  return must(get<Row>(db, "SELECT * FROM decks WHERE id = ? AND user_id = ?", id, userId));
}

export function addCard(db: Db, userId: string, input: { deckId: string; front: string; back: string; sourceId?: string; label: string }) {
  must(get(db, "SELECT id FROM decks WHERE id = ? AND user_id = ?", input.deckId, userId));
  const id = newId();
  const at = nowIso();
  run(
    db,
    "INSERT INTO cards (id, deck_id, user_id, source_id, front, back, label, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    input.deckId,
    userId,
    input.sourceId ?? null,
    input.front,
    input.back,
    input.label,
    at,
    at,
  );
  return must(get<Row>(db, "SELECT * FROM cards WHERE id = ? AND user_id = ?", id, userId));
}

export function reviewCard(db: Db, userId: string, cardId: string, quality: number, revealed: boolean, scoringMethod: "self_rated" | "objective", at = nowIso()) {
  const card = must(get<{ ease: number; interval_days: number; repetitions: number }>(db, "SELECT ease, interval_days, repetitions FROM cards WHERE id = ? AND user_id = ?", cardId, userId));
  let next;
  try {
    next = reviewSm2({ ease: card.ease, intervalDays: card.interval_days, repetitions: card.repetitions, dueAt: null }, quality, at, revealed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "reveal_required") throw new AppError("reveal_required", "Reveal the answer first.", 400);
    if (message === "invalid_quality") throw new AppError("invalid_quality", "Rating was rejected.", 400);
    throw error;
  }
  transaction(db, () => {
    run(db, "UPDATE cards SET ease = ?, interval_days = ?, repetitions = ?, due_at = ?, rev = rev + 1 WHERE id = ? AND user_id = ?", next.ease, next.intervalDays, next.repetitions, next.dueAt, cardId, userId);
    run(
      db,
      "INSERT INTO card_reviews (id, card_id, user_id, quality, scoring_method, revealed, reviewed_at, interval_days, ease, scheduler) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      newId(),
      cardId,
      userId,
      quality,
      scoringMethod,
      revealed ? 1 : 0,
      at,
      next.intervalDays,
      next.ease,
      SCHEDULER_ID,
    );
  });
  return { ...next, scheduler: SCHEDULER_ID, scoringMethod, mastery: null };
}

export function addQuestion(db: Db, userId: string, input: { courseId: string; topicId?: string; sourceId?: string; prompt: string; choices: string[]; correctIndex: number; explanation?: string; label: string }) {
  must(get(db, "SELECT id FROM courses WHERE id = ? AND user_id = ?", input.courseId, userId));
  if (input.topicId) {
    must(get(db, "SELECT id FROM topics WHERE id = ? AND user_id = ? AND course_id = ?", input.topicId, userId, input.courseId));
  }
  if (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.some((choice) => choice.trim() === "")) {
    throw new AppError("invalid_choices", "A question needs at least two non-empty choices.");
  }
  if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex >= input.choices.length) {
    throw new AppError("invalid_answer_key", "The answer key is outside the stored choices.");
  }
  const id = newId();
  run(
    db,
    "INSERT INTO questions (id, user_id, course_id, topic_id, source_id, prompt, choices_json, correct_index, explanation, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    userId,
    input.courseId,
    input.topicId ?? null,
    input.sourceId ?? null,
    input.prompt,
    JSON.stringify(input.choices),
    input.correctIndex,
    input.explanation ?? "",
    input.label,
    nowIso(),
  );
  return id;
}

export function startAttempt(db: Db, userId: string, input: { courseId?: string; topicId?: string; kind: string; timingMode: string; clientToken: string }) {
  const existing = get<{ id: string }>(db, "SELECT id FROM attempts WHERE user_id = ? AND client_token = ?", userId, input.clientToken);
  if (existing) return { id: existing.id, duplicate: true };
  const id = newId();
  run(
    db,
    "INSERT INTO attempts (id, user_id, course_id, topic_id, kind, timing_mode, started_at, status, scoring_method, client_token) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', 'objective_key', ?)",
    id,
    userId,
    input.courseId ?? null,
    input.topicId ?? null,
    input.kind,
    input.timingMode,
    nowIso(),
    input.clientToken,
  );
  return { id, duplicate: false };
}

export function answerAttempt(db: Db, userId: string, attemptId: string, questionId: string, selectedIndex: number) {
  const attempt = must(get<{ status: string; course_id: string | null; topic_id: string | null }>(db, "SELECT status, course_id, topic_id FROM attempts WHERE id = ? AND user_id = ?", attemptId, userId));
  if (attempt.status !== "in_progress") throw new AppError("attempt_closed", "Attempt is not open.");
  if (!attempt.course_id && !attempt.topic_id) throw new AppError("attempt_unscoped", "Attempt has no course or topic scope.");
  const question = get<{ correct_index: number; course_id: string; topic_id: string | null; choices_json: string }>(db, "SELECT correct_index, course_id, topic_id, choices_json FROM questions WHERE id = ? AND user_id = ?", questionId, userId);
  if (!question) throw new AppError("not_found", "Not found", 404);
  const choices = JSON.parse(question.choices_json) as unknown[];
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= choices.length) {
    throw new AppError("invalid_selection", "Answer is outside the stored choices.");
  }
  if (attempt.course_id && question.course_id !== attempt.course_id) throw new AppError("question_out_of_scope", "Question is outside this attempt.");
  if (attempt.topic_id && question.topic_id !== attempt.topic_id) throw new AppError("question_out_of_scope", "Question is outside this attempt.");
  const correct = selectedIndex === question.correct_index ? 1 : 0;
  run(db, "DELETE FROM attempt_answers WHERE attempt_id = ? AND question_id = ? AND user_id = ?", attemptId, questionId, userId);
  run(db, "INSERT INTO attempt_answers (id, attempt_id, question_id, user_id, selected_index, correct, feedback) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), attemptId, questionId, userId, selectedIndex, correct, correct ? "matched the stored key" : "did not match the stored key");
  return { correct: Boolean(correct), scoringMethod: "objective_key" };
}

export function submitAttempt(db: Db, userId: string, attemptId: string) {
  const attempt = must(get<Row>(db, "SELECT * FROM attempts WHERE id = ? AND user_id = ?", attemptId, userId));
  if (attempt.status !== "in_progress") return attempt;
  const scores = get<{ correct: number; total: number }>(db, "SELECT COALESCE(SUM(correct), 0) AS correct, COUNT(*) AS total FROM attempt_answers WHERE attempt_id = ? AND user_id = ?", attemptId, userId);
  const at = nowIso();
  const correct = Number(scores?.correct ?? 0);
  const total = Number(scores?.total ?? 0);
  run(db, "UPDATE attempts SET status = 'submitted', submitted_at = ?, score_correct = ?, score_total = ? WHERE id = ? AND user_id = ?", at, correct, total, attemptId, userId);
  activity(db, userId, "attempt_submitted", { attemptId, correct, total }, at);
  refreshMisconceptions(db, userId);
  return must(get(db, "SELECT * FROM attempts WHERE id = ? AND user_id = ?", attemptId, userId));
}

export function interruptAttempt(db: Db, userId: string, attemptId: string) {
  const result = run(db, "UPDATE attempts SET status = 'interrupted', interrupted = 1, submitted_at = NULL, score_correct = NULL, score_total = NULL WHERE id = ? AND user_id = ? AND status = 'in_progress'", attemptId, userId);
  if (result.changes !== 1) throw new AppError("attempt_closed", "Attempt is not open.");
  return must(get(db, "SELECT * FROM attempts WHERE id = ? AND user_id = ?", attemptId, userId));
}

export function refreshMisconceptions(db: Db, userId: string): void {
  const wrong = all<{ question_id: string; attempt_id: string; topic_id: string | null; submitted_at: string }>(
    db,
    `SELECT aa.question_id, aa.attempt_id, q.topic_id, a.submitted_at FROM attempt_answers aa
     JOIN attempts a ON a.id = aa.attempt_id
     JOIN questions q ON q.id = aa.question_id AND q.user_id = aa.user_id
     WHERE aa.user_id = ? AND aa.correct = 0 AND a.status = 'submitted'`,
    userId,
  );
  const groups = new Map<string, { attempts: Array<{ id: string; submittedAt: string }>; topicId: string | null }>();
  for (const row of wrong) {
    const group = groups.get(row.question_id) ?? { attempts: [], topicId: row.topic_id };
    if (!group.attempts.some((item) => item.id === row.attempt_id)) group.attempts.push({ id: row.attempt_id, submittedAt: row.submitted_at });
    groups.set(row.question_id, group);
  }
  for (const [questionId, group] of groups) {
    const existing = get<{ id: string; status: string; evidence_json: string }>(db, "SELECT id, status, evidence_json FROM misconception_records WHERE user_id = ? AND question_id = ?", userId, questionId);
    const prior = existing ? (JSON.parse(existing.evidence_json) as { closedAttemptIds?: string[] }) : {};
    const closed = new Set(prior.closedAttemptIds ?? []);
    const episode = group.attempts.filter((item) => !closed.has(item.id));
    if (episode.length < 2) continue;
    const evidence = JSON.stringify({ questionId, attemptIds: episode.map((item) => item.id), closedAttemptIds: [...closed], hypothesis: true, diagnosis: false });
    const at = nowIso();
    if (existing) {
      run(db, "UPDATE misconception_records SET evidence_json = ?, updated_at = ?, status = 'hypothesis', topic_id = ? WHERE id = ?", evidence, at, group.topicId, existing.id);
    } else {
      run(db, "INSERT INTO misconception_records (id, user_id, topic_id, question_id, status, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'hypothesis', ?, ?, ?)", newId(), userId, group.topicId, questionId, evidence, at, at);
    }
  }
}

export function listMisconceptions(db: Db, userId: string) {
  const hypotheses = all(db, "SELECT * FROM misconception_records WHERE user_id = ? AND status = 'hypothesis'", userId);
  const singles = all<{ question_id: string; n: number }>(
    db,
    `SELECT aa.question_id, COUNT(*) AS n FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
     WHERE aa.user_id = ? AND aa.correct = 0 AND a.status = 'submitted' GROUP BY aa.question_id HAVING n = 1`,
    userId,
  );
  return { hypotheses, singleErrorsAreNotHypotheses: singles, diagnosis: false };
}

export function correctMisconception(db: Db, userId: string, id: string) {
  const row = must(get<{ evidence_json: string }>(db, "SELECT evidence_json FROM misconception_records WHERE id = ? AND user_id = ?", id, userId));
  const parsed = JSON.parse(row.evidence_json) as { attemptIds?: string[]; closedAttemptIds?: string[] };
  const closedAttemptIds = [...new Set([...(parsed.closedAttemptIds ?? []), ...(parsed.attemptIds ?? [])])];
  const evidence = JSON.stringify({ ...parsed, attemptIds: [], closedAttemptIds, hypothesis: false, diagnosis: false });
  const result = run(db, "UPDATE misconception_records SET status = 'corrected', evidence_json = ?, updated_at = ? WHERE id = ? AND user_id = ?", evidence, nowIso(), id, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function twin(db: Db, userId: string, topicId: string) {
  const topic = must(get<{ self_reported_level: string }>(db, "SELECT self_reported_level FROM topics WHERE id = ? AND user_id = ?", topicId, userId));
  const scores = get<{ correct: number; total: number }>(
    db,
    `SELECT COALESCE(SUM(aa.correct), 0) AS correct, COUNT(*) AS total
     FROM attempt_answers aa
     JOIN questions q ON q.id = aa.question_id AND q.user_id = aa.user_id
     JOIN attempts a ON a.id = aa.attempt_id AND a.user_id = aa.user_id
     WHERE aa.user_id = ? AND q.topic_id = ? AND a.status = 'submitted'`,
    userId,
    topicId,
  );
  const games = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM game_results WHERE user_id = ?", userId);
  return {
    selfReportedLevel: topic.self_reported_level,
    selfReportIsNotMeasuredAbility: true,
    evidence: Number(scores?.total ?? 0) === 0 ? null : { correct: Number(scores?.correct ?? 0), total: Number(scores?.total ?? 0) },
    mastery: null,
    usesDemographics: false,
    gameResultsIgnored: Number(games?.n ?? 0),
  };
}

export function createTask(db: Db, userId: string, input: { title: string; courseId?: string; topicId?: string; dueAt?: string; origin: string; confirmed: boolean; reason?: string }) {
  const id = newId();
  const at = nowIso();
  run(db, "INSERT INTO tasks (id, user_id, course_id, topic_id, title, due_at, status, origin, confirmed, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)", id, userId, input.courseId ?? null, input.topicId ?? null, input.title, input.dueAt ?? null, input.origin, input.confirmed ? 1 : 0, input.reason ?? "", at);
  if (input.confirmed && input.dueAt) notify(db, userId, "task_due", input.title, input.reason ?? "", `task:${id}`, at);
  return must(get<Row>(db, "SELECT * FROM tasks WHERE id = ? AND user_id = ?", id, userId));
}

export function confirmTask(db: Db, userId: string, taskId: string) {
  const result = run(db, "UPDATE tasks SET confirmed = 1, rev = rev + 1 WHERE id = ? AND user_id = ?", taskId, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function completeTask(db: Db, userId: string, taskId: string) {
  const result = run(db, "UPDATE tasks SET status = 'done', rev = rev + 1 WHERE id = ? AND user_id = ? AND confirmed = 1", taskId, userId);
  if (result.changes !== 1) throw new AppError("not_confirmed", "Only a confirmed task can be completed.");
  activity(db, userId, "task_completed", { taskId });
}

export function startSession(db: Db, userId: string, input: { courseId?: string; topicId?: string; kind: string }, at = nowIso()) {
  const id = newId();
  run(db, "INSERT INTO study_sessions (id, user_id, course_id, topic_id, started_at, status, kind) VALUES (?, ?, ?, ?, ?, 'active', ?)", id, userId, input.courseId ?? null, input.topicId ?? null, at, input.kind);
  return id;
}

export function pauseSession(db: Db, userId: string, sessionId: string, additionalPausedMs: number) {
  const result = run(db, "UPDATE study_sessions SET paused_ms = paused_ms + ?, status = 'paused' WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')", additionalPausedMs, sessionId, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function completeSession(db: Db, userId: string, sessionId: string, at = nowIso()) {
  const session = must(get<{ started_at: string; paused_ms: number; status: string }>(db, "SELECT started_at, paused_ms, status FROM study_sessions WHERE id = ? AND user_id = ?", sessionId, userId));
  if (session.status === "completed") return session;
  run(db, "UPDATE study_sessions SET status = 'completed', ended_at = ? WHERE id = ? AND user_id = ?", at, sessionId, userId);
  return { minutes: recordedMinutes(session.started_at, at, session.paused_ms), mastery: null };
}

export function mission(db: Db, userId: string, todayIso: string) {
  const profile = must(get<{ timezone: string }>(db, "SELECT timezone FROM profiles WHERE user_id = ?", userId));
  const active = get<Row>(db, "SELECT * FROM study_sessions WHERE user_id = ? AND status IN ('active', 'paused') ORDER BY started_at DESC LIMIT 1", userId);
  const task = get<Row>(db, "SELECT * FROM tasks WHERE user_id = ? AND status = 'open' AND confirmed = 1 ORDER BY due_at IS NULL, due_at LIMIT 1", userId);
  const attempts = get<{ correct: number; total: number }>(db, "SELECT COALESCE(SUM(score_correct), 0) AS correct, COALESCE(SUM(score_total), 0) AS total FROM attempts WHERE user_id = ? AND status = 'submitted'", userId);
  const tasks = get<{ done: number; total: number }>(db, "SELECT SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total FROM tasks WHERE user_id = ? AND confirmed = 1", userId);
  const minutesRow = all<{ started_at: string; ended_at: string; paused_ms: number }>(db, "SELECT started_at, ended_at, paused_ms FROM study_sessions WHERE user_id = ? AND status = 'completed'", userId);
  const minutes = minutesRow.reduce((sum, row) => sum + recordedMinutes(row.started_at, row.ended_at, row.paused_ms), 0);
  const dates = minutesRow.map((row) => localDate(row.ended_at, profile.timezone));
  const exams = all(db, "SELECT id, title, exam_date FROM exams WHERE user_id = ? ORDER BY exam_date", userId);
  return {
    resumable: active ? { kind: "session", reason: "A study session is still open.", record: active } : task ? { kind: "task", reason: "The earliest confirmed open task.", record: task } : null,
    attempts: Number(attempts?.total ?? 0) === 0 ? null : { correct: Number(attempts?.correct ?? 0), total: Number(attempts?.total ?? 0) },
    plan: Number(tasks?.total ?? 0) === 0 ? null : { done: Number(tasks?.done ?? 0), total: Number(tasks?.total ?? 0) },
    recordedMinutes: minutes,
    streak: studyStreak(dates, todayIso),
    exams,
    seeded: false,
  };
}

export function productAttemptCount(db: Db): number {
  return Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM attempts a JOIN users u ON u.id = a.user_id WHERE u.data_class = 'learner' AND a.status = 'submitted'")?.n ?? 0);
}

function topicEvidence(db: Db, userId: string, topicId: string): { correct: number; total: number } {
  const scores = get<{ correct: number; total: number }>(
    db,
    `SELECT COALESCE(SUM(aa.correct), 0) AS correct, COUNT(*) AS total
     FROM attempt_answers aa
     JOIN questions q ON q.id = aa.question_id AND q.user_id = aa.user_id
     JOIN attempts a ON a.id = aa.attempt_id AND a.user_id = aa.user_id
     WHERE aa.user_id = ? AND q.topic_id = ? AND a.status = 'submitted'`,
    userId,
    topicId,
  );
  return { correct: Number(scores?.correct ?? 0), total: Number(scores?.total ?? 0) };
}

export const DUE_SEMANTICS = "calendar_day" as const;

function dayStamp(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function daysInWindow(startDay: string, endDay: string): string[] {
  if (endDay < startDay) return [];
  const days: string[] = [];
  let cursor = startDay;
  while (cursor <= endDay && days.length < 366) {
    days.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return days;
}

export function proposeCram(db: Db, userId: string, input: { courseId: string; title: string; examDate: string; availableHours: number; syllabus: string; now?: string }) {
  const topics = all<{ id: string; name: string }>(db, "SELECT id, name FROM topics WHERE user_id = ? AND course_id = ?", userId, input.courseId);
  const priorities = topics.map((topic) => {
    const scores = topicEvidence(db, userId, topic.id);
    const total = scores.total;
    const accuracy = total === 0 ? null : scores.correct / total;
    return { topicId: topic.id, name: topic.name, accuracy, reason: total === 0 ? "no question attempts for this topic yet" : "share of the time budget follows recorded misses" };
  });
  priorities.sort((a, b) => (a.accuracy ?? -1) - (b.accuracy ?? -1));
  const now = input.now ?? nowIso();
  const today = now.slice(0, 10);
  const examDay = input.examDate.slice(0, 10);
  const days = daysInWindow(today, examDay);
  const totalMinutes = Math.max(0, Math.round(input.availableHours * 60));
  const neededMinutes = priorities.length * 30;
  const insufficientTime = days.length === 0 || totalMinutes < neededMinutes;
  const weights = priorities.map((item) => (item.accuracy === null ? 2 : 1 + (1 - item.accuracy)));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const scheduled = priorities.map((item, index) => {
    const minutes = weightSum === 0 || totalMinutes === 0 ? 0 : Math.floor((totalMinutes * weights[index]) / weightSum);
    const dueDay = days.length === 0 || minutes === 0 ? null : days[index % days.length];
    return { ...item, minutes, dueDay, dueAt: dueDay ? dayStamp(dueDay) : null, dueSemantics: DUE_SEMANTICS };
  });
  let remainder = totalMinutes - scheduled.reduce((sum, item) => sum + item.minutes, 0);
  for (let index = 0; index < scheduled.length && remainder > 0; index += 1) {
    scheduled[index].minutes += 1;
    remainder -= 1;
    if (!scheduled[index].dueDay && days.length > 0) {
      const dueDay = days[index % days.length];
      scheduled[index].dueDay = dueDay;
      scheduled[index].dueAt = dayStamp(dueDay);
    }
  }
  return {
    priorities: scheduled,
    suggestedMinutes: totalMinutes,
    neededMinutes,
    insufficientTime,
    impossible: days.length === 0,
    windowStart: days[0] ?? null,
    windowEnd: days[days.length - 1] ?? null,
    dueSemantics: DUE_SEMANTICS,
    predictsFutureQuestions: false,
    examDate: input.examDate,
    syllabus: input.syllabus,
    title: input.title,
    courseId: input.courseId,
    availableHours: input.availableHours,
  };
}

export function confirmCram(db: Db, userId: string, proposal: ReturnType<typeof proposeCram>) {
  const examId = newId();
  run(db, "INSERT INTO exams (id, user_id, course_id, title, exam_date, available_hours, syllabus_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", examId, userId, proposal.courseId, proposal.title, proposal.examDate, proposal.availableHours, proposal.syllabus, nowIso());
  const taskIds = proposal.priorities
    .filter((item) => item.minutes > 0 && item.dueAt)
    .map((item) => (createTask(db, userId, { title: `Revise ${item.name}`, courseId: proposal.courseId, topicId: item.topicId, dueAt: item.dueAt ?? undefined, origin: "suggestion", confirmed: true, reason: `${item.reason}. ${item.minutes} minutes from the stated budget.` }) as { id: string }).id);
  return { examId, taskIds, insufficientTime: proposal.insufficientTime };
}

export function proposeAutopilot(db: Db, userId: string, courseId: string, now = nowIso()) {
  const open = all<{ id: string; title: string; due_at: string | null; rev: number }>(db, "SELECT id, title, due_at, rev FROM tasks WHERE user_id = ? AND course_id = ? AND status = 'open' ORDER BY created_at", userId, courseId);
  const exams = all<{ exam_date: string }>(db, "SELECT exam_date FROM exams WHERE user_id = ? AND course_id = ? ORDER BY exam_date", userId, courseId);
  const today = now.slice(0, 10);
  const futureExam = exams.map((exam) => exam.exam_date.slice(0, 10)).find((day) => day >= today) ?? null;
  const days = futureExam ? daysInWindow(today, futureExam) : [today];
  let undated = 0;
  const after = open.map((task) => {
    const currentDay = task.due_at?.slice(0, 10) ?? null;
    const inWindow = currentDay !== null && days.includes(currentDay);
    let dueDay = inWindow ? currentDay : null;
    let placed = inWindow;
    if (!currentDay && days.length > 0) {
      dueDay = days[Math.min(undated, days.length - 1)];
      undated += 1;
      placed = true;
    } else if (currentDay && !inWindow && days.length > 0) {
      dueDay = currentDay < today ? days[0] : days[days.length - 1];
      placed = true;
    }
    const dueAt = placed && dueDay ? dayStamp(dueDay) : null;
    return {
      id: task.id,
      title: task.title,
      dueDay,
      dueAt,
      dueSemantics: DUE_SEMANTICS,
      rev: task.rev,
      placed,
      outsideWindow: currentDay !== null && !inWindow,
      changed: placed && task.due_at !== dueAt,
    };
  });
  const impossible = after.some((row) => !row.placed);
  return { before: open, after, conflicts: after.filter((row) => row.outsideWindow).map((row) => row.id), applied: false, courseId, dueSemantics: DUE_SEMANTICS, windowStart: days[0] ?? null, windowEnd: days[days.length - 1] ?? null, impossible };
}

export function confirmAutopilot(db: Db, userId: string, proposal: ReturnType<typeof proposeAutopilot>) {
  const mismatches: string[] = [];
  for (const row of proposal.after) {
    const current = get<{ rev: number; user_id: string }>(db, "SELECT rev, user_id FROM tasks WHERE id = ? AND user_id = ?", row.id, userId);
    if (!current || current.rev !== row.rev) mismatches.push(row.id);
  }
  if (mismatches.length > 0) return { id: null, status: "conflict" as const, applied: false, mismatches };
  let updated = 0;
  for (const row of proposal.after) {
    if (!row.changed || !row.dueAt) continue;
    const result = run(db, "UPDATE tasks SET due_at = ?, rev = rev + 1 WHERE id = ? AND user_id = ? AND rev = ?", row.dueAt, row.id, userId, row.rev);
    updated += result.changes;
  }
  const id = newId();
  run(db, "INSERT INTO autopilot_proposals (id, user_id, diff_json, conflicts_json, status, created_at) VALUES (?, ?, ?, ?, 'confirmed', ?)", id, userId, JSON.stringify({ before: proposal.before, after: proposal.after }), JSON.stringify(proposal.conflicts), nowIso());
  return { id, status: "confirmed" as const, applied: true, mismatches, updated };
}

function cramFingerprint(db: Db, userId: string, input: { courseId: string; title: string; examDate: string; availableHours: number; syllabus: string; now?: string }): string {
  const topics = all<{ id: string; name: string }>(db, "SELECT id, name FROM topics WHERE user_id = ? AND course_id = ? ORDER BY id", userId, input.courseId);
  const snapshot = topics.map((topic) => ({ id: topic.id, name: topic.name, ...topicEvidence(db, userId, topic.id) }));
  return sha256(JSON.stringify({ kind: "cram", courseId: input.courseId, title: input.title, examDate: input.examDate.slice(0, 10), availableHours: input.availableHours, syllabus: input.syllabus, nowDay: (input.now ?? nowIso()).slice(0, 10), topics: snapshot }));
}

export function autopilotFingerprint(db: Db, userId: string, courseId: string, now: string): string {
  const tasks = all<{ id: string; rev: number; due_at: string | null }>(db, "SELECT id, rev, due_at FROM tasks WHERE user_id = ? AND course_id = ? AND status = 'open' ORDER BY id", userId, courseId);
  const exams = all<{ id: string; exam_date: string }>(db, "SELECT id, exam_date FROM exams WHERE user_id = ? AND course_id = ? ORDER BY id", userId, courseId);
  return sha256(JSON.stringify({ kind: "autopilot", courseId, nowDay: now.slice(0, 10), tasks, exams }));
}

function insertPreview(db: Db, userId: string, kind: string, fingerprint: string, payload: unknown): string {
  const id = newId();
  run(db, "INSERT INTO schedule_previews (id, user_id, kind, fingerprint, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, kind, fingerprint, JSON.stringify(payload), nowIso());
  return id;
}

export function issueCramPreview(db: Db, userId: string, input: { courseId: string; title: string; examDate: string; availableHours: number; syllabus: string; now?: string }) {
  const proposal = proposeCram(db, userId, input);
  const fingerprint = cramFingerprint(db, userId, input);
  const previewId = insertPreview(db, userId, "cram", fingerprint, { input, proposal });
  return { previewId, fingerprint, contractVersion: 2, ...proposal };
}

export function confirmCramPreview(db: Db, userId: string, previewId: string) {
  const row = get<{ fingerprint: string; payload_json: string; consumed_at: string | null }>(db, "SELECT fingerprint, payload_json, consumed_at FROM schedule_previews WHERE id = ? AND user_id = ? AND kind = 'cram'", previewId, userId);
  if (!row) throw new AppError("preview_not_found", "Preview was not found.", 404);
  if (row.consumed_at) throw new AppError("preview_consumed", "Preview was already used.", 409);
  const payload = JSON.parse(row.payload_json) as { input: { courseId: string; title: string; examDate: string; availableHours: number; syllabus: string; now?: string }; proposal: ReturnType<typeof proposeCram> };
  if (cramFingerprint(db, userId, payload.input) !== row.fingerprint) throw new AppError("stale_preview", "Preview no longer matches stored records.", 409);
  const saved = confirmCram(db, userId, payload.proposal);
  run(db, "UPDATE schedule_previews SET consumed_at = ? WHERE id = ? AND user_id = ?", nowIso(), previewId, userId);
  return { status: "confirmed" as const, applied: true, dueSemantics: DUE_SEMANTICS, ...saved };
}

export function issueAutopilotPreview(db: Db, userId: string, courseId: string, now = nowIso()) {
  const proposal = proposeAutopilot(db, userId, courseId, now);
  const fingerprint = autopilotFingerprint(db, userId, courseId, now);
  const previewId = insertPreview(db, userId, "autopilot", fingerprint, { courseId, now, proposal });
  return { previewId, fingerprint, contractVersion: 2, ...proposal };
}

export function confirmAutopilotPreview(db: Db, userId: string, previewId: string) {
  const row = get<{ fingerprint: string; payload_json: string; consumed_at: string | null }>(db, "SELECT fingerprint, payload_json, consumed_at FROM schedule_previews WHERE id = ? AND user_id = ? AND kind = 'autopilot'", previewId, userId);
  if (!row) throw new AppError("preview_not_found", "Preview was not found.", 404);
  if (row.consumed_at) throw new AppError("preview_consumed", "Preview was already used.", 409);
  const payload = JSON.parse(row.payload_json) as { courseId: string; now: string; proposal: ReturnType<typeof proposeAutopilot> };
  if (autopilotFingerprint(db, userId, payload.courseId, payload.now) !== row.fingerprint) throw new AppError("stale_preview", "Preview no longer matches stored records.", 409);
  const saved = confirmAutopilot(db, userId, payload.proposal);
  if (!saved.applied) throw new AppError("stale_preview", "Preview no longer matches stored records.", 409);
  run(db, "UPDATE schedule_previews SET consumed_at = ? WHERE id = ? AND user_id = ?", nowIso(), previewId, userId);
  return { ...saved, dueSemantics: DUE_SEMANTICS };
}

export function createCircle(db: Db, ownerId: string, name: string, options?: { creatorKind?: "learner" | "parent" | "teacher" }) {
  const id = newId();
  const at = nowIso();
  const teacher = get<{ verified_teacher: number }>(db, "SELECT verified_teacher FROM users WHERE id = ?", ownerId);
  const creatorKind = options?.creatorKind ?? (teacher?.verified_teacher === 1 ? "teacher" : "learner");
  const inviteCode = newId().replace(/-/g, "").slice(0, 12);
  transaction(db, () => {
    run(db, "INSERT INTO circles (id, owner_id, name, invite_code, creator_kind, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, ownerId, name, inviteCode, creatorKind, at);
    run(db, "INSERT INTO circle_members (circle_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)", id, ownerId, at);
  });
  return id;
}

export function createParentCircle(db: Db, parentId: string, name: string): { id: string; inviteCode: string } {
  must(get(db, "SELECT id FROM parent_guardians WHERE id = ?", parentId));
  const email = `guardian.${parentId}@unibud.invalid`;
  let owner = get<{ id: string }>(db, "SELECT id FROM users WHERE email = ?", email);
  if (!owner) owner = registerUser(db, { email, password: `${newSessionToken()}Aa`, dataClass: "test_fixture", educationLevel: "university", ageBand: "18_plus" });
  const id = createCircle(db, owner.id, name, { creatorKind: "parent" });
  const row = must(get<{ invite_code: string }>(db, "SELECT invite_code FROM circles WHERE id = ?", id));
  return { id, inviteCode: row.invite_code };
}

export function setVerifiedTeacher(db: Db, userId: string): void {
  const result = run(db, "UPDATE users SET verified_teacher = 1 WHERE id = ?", userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function inviteToCircle(db: Db, ownerId: string, circleId: string, email: string) {
  const circle = must(get<{ id: string }>(db, "SELECT id FROM circles WHERE id = ? AND owner_id = ?", circleId, ownerId));
  hashPassword("invite-timing");
  const user = get<{ id: string }>(db, "SELECT id FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!user) return { status: "pending" as const };
  const block = minorInviteBlocked(accountCapabilities(profileClaimsFor(db, ownerId)), accountCapabilities(profileClaimsFor(db, user.id)));
  if (block) return { status: "pending" as const };
  run(db, "INSERT OR REPLACE INTO circle_members (circle_id, user_id, role, status, revoked_at, created_at) VALUES (?, ?, 'member', 'pending', NULL, ?)", circle.id, user.id, nowIso());
  notify(db, user.id, "circle_invite", "Study circle invite", "Accept the invite on the server before any shared read.", `invite:${circleId}:${user.id}`);
  return { status: "pending" as const };
}

function activeMember(db: Db, circleId: string, userId: string): boolean {
  if (get(db, "SELECT 1 FROM circle_blocks WHERE circle_id = ? AND user_id = ?", circleId, userId)) return false;
  return Boolean(get(db, "SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ? AND status = 'active'", circleId, userId));
}

export function joinCircleByCode(db: Db, userId: string, code: string) {
  const claims = accountCapabilities(profileClaimsFor(db, userId));
  const verified = get<{ parent_contact_verified: number }>(db, "SELECT parent_contact_verified FROM profiles WHERE user_id = ?", userId);
  if (claims.age_band === "under_13" && verified?.parent_contact_verified !== 1) throw new AppError("consent_required", "Study Circle waits for parental consent.", 403);
  const circle = get<{ id: string; creator_kind: string }>(db, "SELECT id, creator_kind FROM circles WHERE invite_code = ?", code.trim());
  if (!circle) throw new AppError("not_found", "Not found", 404);
  if (isUnder18(claims) && circle.creator_kind !== "parent" && circle.creator_kind !== "teacher") throw new AppError("circle_cross_level_invite", "This invite is not available for this account.", 403);
  if (get(db, "SELECT 1 FROM circle_blocks WHERE circle_id = ? AND user_id = ?", circle.id, userId)) throw new AppError("circle_blocked", "Membership was revoked.", 403);
  run(db, "INSERT OR REPLACE INTO circle_members (circle_id, user_id, role, status, revoked_at, created_at) VALUES (?, ?, 'member', 'active', NULL, ?)", circle.id, userId, nowIso());
  return { circleId: circle.id, status: "active" as const };
}

export function reportMember(db: Db, reporterId: string, circleId: string, targetUserId: string): void {
  if (!activeMember(db, circleId, reporterId) && !get(db, "SELECT 1 FROM circles WHERE id = ? AND owner_id = ?", circleId, reporterId)) {
    throw new AppError("not_found", "Not found", 404);
  }
  const at = nowIso();
  run(db, "INSERT INTO circle_reports (id, circle_id, reporter_id, target_user_id, created_at) VALUES (?, ?, ?, ?, ?)", newId(), circleId, reporterId, targetUserId, at);
  run(db, "UPDATE circle_members SET status = 'revoked', revoked_at = ? WHERE circle_id = ? AND user_id = ?", at, circleId, targetUserId);
  run(db, "INSERT OR REPLACE INTO circle_blocks (circle_id, user_id, blocked_at) VALUES (?, ?, ?)", circleId, targetUserId, at);
}

export function sendCircleDm(db: Db, fromUserId: string, circleId: string, toUserId: string, body: string): { id: string } {
  if (!activeMember(db, circleId, fromUserId) || !activeMember(db, circleId, toUserId)) throw new AppError("circle_dm_stranger", "Direct messages require a shared circle.", 403);
  const id = newId();
  run(db, "INSERT INTO circle_dms (id, circle_id, from_user_id, to_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, circleId, fromUserId, toUserId, body, nowIso());
  return { id };
}

export function recordYouTubeWatch(db: Db, userId: string, videoId: string): { stored: boolean } {
  const age = profileClaimsFor(db, userId).age_band;
  if (age === "under_13" || age === null) return { stored: false };
  if (!videoId.trim()) throw new AppError("invalid_video", "Video id was rejected.", 400);
  run(db, "INSERT INTO watch_history (id, user_id, video_id, watched_at) VALUES (?, ?, ?, ?)", newId(), userId, videoId.trim(), nowIso());
  return { stored: true };
}

export function publicProfile(db: Db, userId: string): { id: string; display_name: string } {
  const claims = accountCapabilities(profileClaimsFor(db, userId));
  if (!isPublicProfileAllowed(claims)) throw new AppError("not_found", "Not found", 404);
  const row = get<{ display_name: string }>(db, "SELECT display_name FROM profiles WHERE user_id = ?", userId);
  return { id: userId, display_name: row?.display_name ?? "" };
}

export function searchPublicProfiles(db: Db, email: string): Array<{ id: string; display_name: string }> {
  const user = get<{ id: string }>(db, "SELECT id FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!user) return [];
  const claims = accountCapabilities(profileClaimsFor(db, user.id));
  if (!isPublicProfileAllowed(claims)) return [];
  const row = get<{ display_name: string }>(db, "SELECT display_name FROM profiles WHERE user_id = ?", user.id);
  return [{ id: user.id, display_name: row?.display_name ?? "" }];
}

export function acceptInvite(db: Db, userId: string, circleId: string) {
  const result = run(db, "UPDATE circle_members SET status = 'active' WHERE circle_id = ? AND user_id = ? AND status = 'pending'", circleId, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function revokeMember(db: Db, ownerId: string, circleId: string, memberId: string) {
  must(get(db, "SELECT id FROM circles WHERE id = ? AND owner_id = ?", circleId, ownerId));
  if (memberId === ownerId) throw new AppError("forbidden", "Owner membership stays with the circle.", 403);
  const result = run(db, "UPDATE circle_members SET status = 'revoked', revoked_at = ? WHERE circle_id = ? AND user_id = ?", nowIso(), circleId, memberId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function audience(db: Db, circleId: string, actorId: string) {
  if (!activeMember(db, circleId, actorId)) throw new AppError("not_found", "Not found", 404);
  return all<{ user_id: string; role: string }>(db, "SELECT user_id, role FROM circle_members WHERE circle_id = ? AND status = 'active'", circleId);
}

export function postToCircle(db: Db, userId: string, circleId: string, body: string) {
  const who = audience(db, circleId, userId);
  const id = newId();
  run(db, "INSERT INTO circle_posts (id, circle_id, user_id, body, audience_json, ack_status, created_at) VALUES (?, ?, ?, ?, ?, 'acked', ?)", id, circleId, userId, body, JSON.stringify(who), nowIso());
  return { id, ack: true as const, audience: who };
}

export function readPosts(db: Db, userId: string, circleId: string) {
  if (!activeMember(db, circleId, userId)) throw new AppError("not_found", "Not found", 404);
  return all(db, "SELECT id, user_id, body, audience_json, ack_status, created_at FROM circle_posts WHERE circle_id = ?", circleId);
}

export function stageLocalPost(): { ack: false; status: "saved_on_device" } {
  return { ack: false, status: "saved_on_device" };
}

export function putYouTubeCache(db: Db, videoId: string, payload: unknown, fetchedAt: string) {
  run(db, "INSERT INTO youtube_cache (video_id, payload_json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at", videoId, JSON.stringify(payload), fetchedAt);
}

export function readYouTubeCache(db: Db, videoId: string, now: string): unknown | null {
  const row = get<{ payload_json: string; fetched_at: string }>(db, "SELECT payload_json, fetched_at FROM youtube_cache WHERE video_id = ?", videoId);
  if (!row || !cacheFresh(row.fetched_at, now)) return null;
  return JSON.parse(row.payload_json);
}

export function purgeExpiredYouTubeCache(db: Db, now: string): number {
  const rows = all<{ video_id: string; fetched_at: string }>(db, "SELECT video_id, fetched_at FROM youtube_cache");
  let removed = 0;
  for (const row of rows) {
    if (!cacheFresh(row.fetched_at, now)) {
      run(db, "DELETE FROM youtube_cache WHERE video_id = ?", row.video_id);
      removed += 1;
    }
  }
  return removed;
}

export function bookmarkVideo(db: Db, userId: string, input: { videoId: string; courseId?: string; topicId?: string; note?: string }) {
  const id = newId();
  run(db, "INSERT INTO video_bookmarks (id, user_id, video_id, course_id, topic_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, input.videoId, input.courseId ?? null, input.topicId ?? null, input.note ?? "", nowIso());
  return id;
}

export function attachTranscript(db: Db, userId: string, bookmarkId: string, body: string, rightsConfirmed: boolean) {
  if (!rightsConfirmed) throw new AppError("rights_required", "A learner-supplied transcript needs an explicit rights confirmation.");
  must(get(db, "SELECT id FROM video_bookmarks WHERE id = ? AND user_id = ?", bookmarkId, userId));
  const id = newId();
  run(db, "INSERT INTO transcripts (id, user_id, bookmark_id, body, provenance, rights_confirmed, created_at) VALUES (?, ?, ?, ?, 'learner_authorized', 1, ?)", id, userId, bookmarkId, body, nowIso());
  return id;
}

export function canPracticeFromBookmark(db: Db, userId: string, bookmarkId: string): { allowed: boolean; reason: string } {
  const transcript = get(db, "SELECT id FROM transcripts WHERE bookmark_id = ? AND user_id = ? AND rights_confirmed = 1", bookmarkId, userId);
  if (!transcript) return { allowed: false, reason: "transcript_not_legitimately_available" };
  return { allowed: true, reason: "learner_authorized_transcript" };
}

export function addGraphNode(db: Db, userId: string, label: string, topicId?: string) {
  const id = newId();
  run(db, "INSERT INTO graph_nodes (id, user_id, topic_id, label, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, topicId ?? null, label, nowIso());
  return id;
}

export function addGraphEdge(db: Db, userId: string, fromId: string, toId: string, origin: "learner" | "inferred") {
  const id = newId();
  run(db, "INSERT INTO graph_edges (id, user_id, from_id, to_id, origin, academic_verification, created_at) VALUES (?, ?, ?, ?, ?, 'not_verified', ?)", id, userId, fromId, toId, origin, nowIso());
  return id;
}

export function lensDecision(input: { mode: "text" | "image"; consent: boolean; route: RouteInput }): { status: string; imageAnalysis: false; interpretation: null; reason: string } {
  if (input.mode === "text") return { status: "text_only", imageAnalysis: false, interpretation: null, reason: "text_is_not_image_analysis" };
  if (!input.consent) return { status: "denied", imageAnalysis: false, interpretation: null, reason: "consent_required" };
  const plan = planRoute({ ...input.route, required: ["image"] });
  return { status: "denied", imageAnalysis: false, interpretation: null, reason: plan.status === "unavailable" ? plan.reason : "image_route_not_executed" };
}

export function createChat(db: Db, userId: string, title: string, courseId?: string, topicId?: string) {
  const id = newId();
  const at = nowIso();
  run(db, "INSERT INTO chats (id, user_id, course_id, topic_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, courseId ?? null, topicId ?? null, title, at, at);
  return id;
}

export function askTutor(db: Db, userId: string, chatId: string, question: string, route: RouteInput) {
  must(get(db, "SELECT id FROM chats WHERE id = ? AND user_id = ?", chatId, userId));
  const plan = planRoute(route);
  const at = nowIso();
  run(db, "INSERT INTO messages (id, chat_id, user_id, role, content, status, routing_json, created_at) VALUES (?, ?, ?, 'user', ?, 'stored', ?, ?)", newId(), chatId, userId, question, JSON.stringify({ answer: false }), at);
  run(db, "INSERT INTO provider_attempts (id, user_id, provider, model, state, billing_note, task, created_at) VALUES (?, ?, ?, ?, 'not_sent', 'no charge attempted', ?, ?)", newId(), userId, plan.primary?.provider ?? null, plan.primary?.model ?? null, route.task, at);
  run(db, "INSERT INTO messages (id, chat_id, user_id, role, content, provider, model, status, routing_json, created_at) VALUES (?, ?, ?, 'status', ?, ?, ?, 'unavailable', ?, ?)", newId(), chatId, userId, plan.reason, plan.primary?.provider ?? null, plan.primary?.model ?? null, JSON.stringify(plan), at);
  const assistantAnswers = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant'", chatId);
  return { plan, fabricatedAnswer: false, assistantMessages: assistantAnswers?.n ?? 0 };
}

export function saveLab(db: Db, userId: string, input: { lab: string; params: unknown; result: unknown; assumptions: string; courseId?: string; topicId?: string }) {
  const id = newId();
  run(db, "INSERT INTO lab_runs (id, user_id, course_id, topic_id, lab, params_json, result_json, assumptions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, userId, input.courseId ?? null, input.topicId ?? null, input.lab, JSON.stringify(input.params), JSON.stringify(input.result), input.assumptions, nowIso());
  return id;
}

export function saveGame(db: Db, userId: string, score: number, total: number) {
  const id = newId();
  run(db, "INSERT INTO game_results (id, user_id, game, score, total, learning_claim, created_at) VALUES (?, ?, 'built_in_practice', ?, ?, 'not_mastery', ?)", id, userId, score, total, nowIso());
  return id;
}

export function applyArtifactUpdate(db: Db, userId: string, artifactId: string, baseRev: number, body: string, idempotencyKey: string) {
  const prior = get<{ response_json: string }>(db, "SELECT response_json FROM sync_log WHERE user_id = ? AND idempotency_key = ?", userId, idempotencyKey);
  if (prior) return JSON.parse(prior.response_json) as { status: string; rev?: number; server?: unknown; clientBody?: string };
  const current = must(get<{ rev: number; body: string }>(db, "SELECT rev, body FROM artifacts WHERE id = ? AND user_id = ?", artifactId, userId));
  if (current.rev !== baseRev) {
    const response = { status: "conflict", server: current, clientBody: body };
    run(db, "INSERT INTO sync_log (id, user_id, idempotency_key, entity, entity_id, base_rev, result, response_json, created_at) VALUES (?, ?, ?, 'artifact', ?, ?, 'conflict', ?, ?)", newId(), userId, idempotencyKey, artifactId, baseRev, JSON.stringify(response), nowIso());
    return response;
  }
  run(db, "UPDATE artifacts SET body = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND user_id = ? AND rev = ?", body, nowIso(), artifactId, userId, baseRev);
  const response = { status: "acked", rev: baseRev + 1, body };
  run(db, "INSERT INTO sync_log (id, user_id, idempotency_key, entity, entity_id, base_rev, result, response_json, created_at) VALUES (?, ?, ?, 'artifact', ?, ?, 'acked', ?, ?)", newId(), userId, idempotencyKey, artifactId, baseRev, JSON.stringify(response), nowIso());
  return response;
}

export function exportAccount(db: Db, userId: string) {
  must(get(db, "SELECT id FROM users WHERE id = ?", userId));
  const tables = ["profiles", "courses", "topics", "sources", "artifacts", "decks", "cards", "card_reviews", "questions", "attempts", "attempt_answers", "tasks", "study_sessions", "video_bookmarks", "transcripts", "graph_nodes", "graph_edges", "misconception_records", "messages", "exams", "lab_runs", "game_results", "notifications"];
  const data: Record<string, unknown[]> = {};
  for (const table of tables) data[table] = all(db, `SELECT * FROM ${table} WHERE user_id = ?`, userId);
  return { userId, dataClass: get<{ data_class: string }>(db, "SELECT data_class FROM users WHERE id = ?", userId)?.data_class, data };
}

export function deleteAccount(db: Db, userId: string): void {
  must(get(db, "SELECT id FROM users WHERE id = ?", userId));
  if (!/^[A-Za-z0-9-]+$/.test(userId)) throw new AppError("invalid_storage_id", "Storage id was rejected.");
  run(db, "DELETE FROM idempotency WHERE user_id = ?", userId);
  run(db, "DELETE FROM youtube_saved WHERE user_id = ?", userId);
  run(db, "DELETE FROM video_bookmarks WHERE user_id = ?", userId);
  rmSync(path.join(uploadRoot(), userId), { recursive: true, force: true });
  rmSync(path.join(deviceRoot(), `${userId}.json`), { force: true });
  run(db, "DELETE FROM users WHERE id = ?", userId);
}

export function renameChat(db: Db, userId: string, chatId: string, title: string) {
  const result = run(db, "UPDATE chats SET title = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND user_id = ?", title, nowIso(), chatId, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function deleteChat(db: Db, userId: string, chatId: string) {
  const result = run(db, "DELETE FROM chats WHERE id = ? AND user_id = ?", chatId, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}

export function grantPrivacy(db: Db, userId: string, provider: string, purpose: string) {
  run(db, "INSERT OR REPLACE INTO privacy_grants (user_id, provider, purpose, granted_at) VALUES (?, ?, ?, ?)", userId, provider, purpose, nowIso());
}

export function listNotifications(db: Db, userId: string) {
  return all(db, "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at", userId);
}

export function markNotificationRead(db: Db, userId: string, id: string) {
  const result = run(db, "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?", nowIso(), id, userId);
  if (result.changes !== 1) throw new AppError("not_found", "Not found", 404);
}
