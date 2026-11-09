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
| POST `/api/cram/preview` | `{ courseId, title, examDate, availableHours, syllabus, now? }` | Contract v2. Returns `previewId`, `fingerprint`, `dueSemantics: "calendar_day"`, and the exact day buckets. `dueAt` is `YYYY-MM-DDT00:00:00.000Z`, a day-bucket serialization, not a 09:00 appointment |
| POST `/api/cram/confirm` | `{ previewId }` | Writes that stored preview only. `409` `stale_preview` if topics or evidence changed. `400` `preview_required` if the token is missing. A body with only `courseId` is no longer enough |
| POST `/api/autopilot/preview` | `{ courseId, now? }` | Contract v2. Returns `previewId` and the exact `after` rows. Day buckets stay inside today through the next exam day that is still today or later. Tasks that cannot fit are `placed: false` and are not given a date after the exam |
| POST `/api/autopilot/confirm` | `{ previewId }` | Applies the stored rows only when the task/exam fingerprint still matches. A task added or edited after preview returns `409` and does not change dates |
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

## Contract version

Scheduling confirm is version 2. Version 1 confirm bodies that only sent `courseId` are rejected with `preview_required`. There is no automatic upgrade: the client must show the preview and send its `previewId`.

`dueSemantics: "calendar_day"` means the date is a day bucket. Do not compare `dueAt` to the clock time of `now`. A bucket for today remains valid in the afternoon. A bucket after the exam day is not created.

## Additional owned routes

`src/server/resources.ts` handles these for the signed-in user. Another account receives 404.

| Method and path | Role |
|---|---|
| POST `/api/decks`, POST `/api/decks/:id/cards`, GET `/api/cards`, POST `/api/cards/:id/reviews` | Decks, cards, and revealed self-ratings |
| POST `/api/labs/projectile`, GET `/api/labs` | Deterministic projectile run |
| POST `/api/games/built-in`, GET `/api/games` | Built-in game score labeled not mastery |
| POST `/api/chats`, POST/GET `/api/chats/:id/messages`, PATCH/DELETE `/api/chats/:id` | Stored questions. Provider execution stays `not_executed` unless a test injects a transport; this HTTP path does not |
| POST `/api/uploads`, GET `/api/uploads/:id` | Owner-only text or image bytes. No filesystem path in the JSON |
| GET `/api/graph`, POST `/api/graph/nodes`, POST `/api/graph/edges` | Learner or inferred edges. Inferred is not an academically verified prerequisite |
| POST `/api/lens` | Capability decision. `interpretation` stays null |
| GET/POST `/api/device/notes`, POST `/api/device/notes/:id/sync` | Device copy versus server ack or conflict |
| POST `/api/sessions`, POST `/api/sessions/:id/pause`, POST `/api/sessions/:id/complete` | Study session timing |

## Responses

Every JSON response sets `Cache-Control: private, no-store`. No `Access-Control-Allow-Origin` header is set. The browser is expected to call relative `/api` on the Next server (`npm run dev` or `npm start`, `127.0.0.1:3000`). `npm run serve` is the same handler on that same default port for API-only use. Do not point the Next app at a second origin.

Origin checks use the `Host` header only. `X-Forwarded-Host` is ignored, so a client cannot make a foreign origin match by sending that header.

Unknown thrown errors return `{ "error": "internal" }` with no message text.
