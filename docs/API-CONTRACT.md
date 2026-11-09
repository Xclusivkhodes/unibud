# HTTP API contract

Implemented by `src/server/api.ts` and covered by `tests/api.test.ts` plus the loopback smoke of `npm run serve`. Paths not listed here are not HTTP endpoints, even if a domain function exists.

Base URL for local serve: `http://127.0.0.1:3000`. JSON in and out. Errors are `{ "error": "<code>" }`.

## Session

See `docs/FRONTEND-HANDOFF.md` for the cookie and CSRF header.

| Method and path | Input | Output | Errors |
|---|---|---|---|
| POST `/api/auth/register` | `{ email, password, displayName? }` | `201 { userId }` and `Set-Cookie` | `invalid_email`, `weak_password`, `email_taken`, `csrf_required`, `csrf_origin` |
| POST `/api/auth/login` | `{ email, password }` | `200 { userId }` and `Set-Cookie` | `invalid_login` |
| POST `/api/auth/logout` | none | `200 { ok: true }` and a cleared cookie | csrf errors |
| GET `/api/me` | cookie | `{ id, email, dataClass }` | `unauthenticated` |

## Records

All ids are UUID strings created by the server. Queries are limited to the signed-in user. Another account's course returns `404 { error: "not_found" }`.

| Method and path | Input | Output |
|---|---|---|
| GET `/api/courses` | | `{ courses }` |
| POST `/api/courses` | `{ name, subjectName?, goal? }` | `201 { course }` |
| GET `/api/courses/:id` | | `{ course }` or 404 |
| POST `/api/courses/:id/topics` | `{ name, selfReportedLevel? }` | `201 { topic }` |
| GET `/api/sources?courseId=` | | `{ sources }` titles and ids, not a cross-account read |
| POST `/api/sources` | `{ courseId, topicId?, title, body }` | `201 { source }` |
| POST `/api/questions` | `{ courseId, topicId?, prompt, choices, correctIndex, label? }` | `201 { id }` or `invalid_choices`, `invalid_answer_key` |
| POST `/api/attempts` | `{ courseId, topicId?, kind?, timingMode?, clientToken }` | `{ id, duplicate }` |
| POST `/api/attempts/:id/answers` | `{ questionId, selectedIndex }` | `{ correct, scoringMethod }` |
| POST `/api/attempts/:id/submit` | | `{ attempt }` |
| POST `/api/attempts/:id/interrupt` | | `{ attempt }` with no score |
| GET `/api/topics/:id/evidence` | | Twin object. `evidence` is `{ correct, total }` or `null`. Counts answers whose question topic is this topic |
| GET `/api/tasks` | | `{ tasks }` including `due_at` |
| POST `/api/tasks` | `{ title, courseId?, topicId?, dueAt?, confirmed?, reason? }` | `201 { task }` |
| POST `/api/cram/preview` | `{ courseId, title, examDate, availableHours, syllabus, now? }` | priorities with `minutes` and `dueAt`, plus `insufficientTime` |
| POST `/api/cram/confirm` | same as preview | creates the exam and only the dated tasks with minutes |
| POST `/api/autopilot/preview` | `{ courseId, now? }` | `{ before, after, conflicts, applied: false }` |
| POST `/api/autopilot/confirm` | `{ courseId, now? }` | recomputes the proposal on the server and writes due dates. `applied` is false when a task revision changed |
| GET `/api/misconceptions` | | hypotheses and single errors. Not a diagnosis |
| POST `/api/misconceptions/:id/correct` | | `{ ok: true }`. Closes that evidence episode |
| POST `/api/circles` | `{ name }` | `201 { id }` |
| POST `/api/circles/:id/invites` | `{ email }` | `{ status, invited }` |
| POST `/api/circles/:id/accept` | | `{ ok: true }` |
| POST `/api/circles/:id/members/:userId/revoke` | | `{ ok: true }` |
| GET `/api/circles/:id/posts` | | `{ posts }` or 404 when the caller is not an active member |
| POST `/api/circles/:id/posts` | `{ body }` | `201` post with `ack: true` and the active audience |
| GET `/api/export` | | the caller's rows from the export table list. No password hash |
| DELETE `/api/account` | | `{ deleted: true }` and a cleared cookie |

## Attempt scope

A topic-scoped attempt accepts an answer only when the question has the same course and topic. Otherwise the status is 400 and `error` is `question_out_of_scope`. `selectedIndex` must be an integer inside the stored choices (`invalid_selection`). The answer key must point at a choice (`invalid_answer_key`).

## Unconfigured external state

GET `/api/providers` returns registry rows with `liveVerified: false`, `operational: false`, and `eligible: false`. Google rows include `google_live_blocked_pending_age_and_product_policy`. The response does not contain API keys.

GET `/api/youtube/status` returns `configured`, `search` of `unconfigured` or `not_executed`, and `captionDownload: false`. This route does not call YouTube.

## Domain behavior without an HTTP route

Cards, labs, games, chats, uploads, graph edits, lens decisions, device-file sync, and study-session timing exist as functions under `src/domain.ts` and related modules. They are not endpoints in this contract until a route is added to `src/server/api.ts` and a test calls it.
