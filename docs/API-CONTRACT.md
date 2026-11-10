# HTTP API contract

Implemented by `src/server/api.ts` and covered by `tests/api.test.ts` plus the loopback smoke of `npm run serve`. Paths not listed here are not HTTP endpoints, even if a domain function exists.

Base URL for local serve: `http://127.0.0.1:3000`. JSON in and out. Errors are exactly `{ "error": "<code>" }` with no extra fields.

Contract version remains 2. Course and topic JSON uses the SQLite column names (`subject_name`, `goal_text`, `course_id`, `self_reported_level`), not camelCase. `src/contract/types.ts` matches those wire names. The earlier camelCase `CourseRecord` and `TopicRecord` fields were never what the server sent.

GET `/api/courses` and GET `/api/courses/:id` return `CourseSummary`: `id`, `name`, `subject_name`, `goal_text`. POST `/api/courses` returns the full `CourseRecord`, which also has `user_id`, `created_at`, and `rev`. POST `/api/courses/:id/topics` returns the full topic row (`TopicRecord`).

Schedule preview failures, frozen by HTTP tests:

| Case | Status | Body |
|---|---|---|
| Confirm without `previewId` | 400 | `{ "error": "preview_required" }` |
| Unknown preview, or another account's preview | 404 | `{ "error": "preview_not_found" }` |
| Preview already consumed | 409 | `{ "error": "preview_consumed" }` |
| Records changed since that preview | 409 | `{ "error": "stale_preview" }` |

Previews do not expire on a timer. There is no freshness window. They become unusable only when consumed or when the fingerprint no longer matches.

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
| POST `/api/cram/confirm` | `{ previewId }` | Writes the stored preview payload only. It does not run the scheduler again. Same failure table as above, for both cram and autopilot. A body with only `courseId` is not enough |
| POST `/api/autopilot/preview` | `{ courseId, now? }` | Contract v2. Returns `previewId` and the exact `after` rows. Day buckets stay inside today through the next exam day that is still today or later. Tasks that cannot fit are `placed: false` and are not given a date after the exam |
| POST `/api/autopilot/confirm` | `{ previewId }` | Writes `due_at` from the stored `after` rows only. A task added or edited after preview, or a revision that no longer matches the stored row, returns `409` `{ "error": "stale_preview" }` and does not change dates |
| GET `/api/misconceptions` | | hypotheses and single errors. Not a diagnosis |
| POST `/api/misconceptions/:id/correct` | | `{ ok: true }`. Closes that evidence episode |
| POST `/api/circles` | `{ name }` | `201 { id }` |
| POST `/api/circles/:id/invites` | `{ email }` | `{ "status": "pending" }` for a known or unknown email. No invitee id. An unknown email does not create a membership |
| POST `/api/circles/:id/accept` | | `{ ok: true }` |
| POST `/api/circles/:id/members/:userId/revoke` | | `{ ok: true }` |
| GET `/api/circles/:id/posts` | | `{ posts }` or 404 when the caller is not an active member |
| POST `/api/circles/:id/posts` | `{ body }` | `201` post with `ack: true` and the active audience |
| GET `/api/export` | | the caller's rows from the export table list. No password hash |
| DELETE `/api/account` | | `{ deleted: true }` and a cleared cookie. Also removes that user's upload directory, device JSON, idempotency rows, saved YouTube ids and notes, and bookmarks. Shared YouTube metadata cache rows are not deleted |

## Attempt scope

A topic-scoped attempt accepts an answer only when the question has the same course and topic. Otherwise the status is 400 and `error` is `question_out_of_scope`. `selectedIndex` must be an integer inside the stored choices (`invalid_selection`). The answer key must point at a choice (`invalid_answer_key`).

## Unconfigured external state

GET `/api/providers` returns registry rows with `liveVerified: false`, `operational: false`, and `eligible: false`. Google rows include `google_live_blocked_pending_age_and_product_policy`. The response does not contain API keys.

GET `/api/youtube/status` returns `configured`, `search` of `unconfigured` or `not_executed`, and `captionDownload: false`. `search` is `unconfigured` when `YOUTUBE_API_KEY` is unset. This route does not call YouTube.

`GEMINI_API_KEY` is the Google AI Studio key for the Gemini API, including Gemma on that API. It is read only from the server environment. When it is unset, Google rows in `GET /api/providers` use `configured: false` and `blockReason: "unconfigured"`. The value is never returned or logged. Live Google use stays ineligible (`GOOGLE_LIVE_USE` remains blocked) until Stephen decides live use, free-tier limits, and under-18 eligibility.

Documented Gemma 4 ids, from the Gemini API Gemma page and not from a live call in this run, are `gemma-4-26b-a4b-it` and `gemma-4-31b-it`. Both use `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the key in `x-goog-api-key`, not the URL. `gemini-2.5-flash` is not a registry default. A teammate reported that `gemma-4-26b-a4b-it` answered a synthetic prompt, that `gemma-4-31b-it` is listed, and that `gemini-2.5-flash` is refused for new users in favor of `gemini-3.8-flash`. Those reports were not tested here and are not configured defaults. Extra model ids, if Stephen sets them, come from `UNIBUD_GEMINI_MODELS`. `gemini-*` request shapes use the same generateContent URL. Capabilities stay limited to what that Gemma page documents: text, image understanding, tools, and thinking. Nothing here is `operational` or `liveVerified`.

Server-only request builders live in `src/providers/request.ts` and `src/youtube/api.ts`. They are not HTTP routes. A test may inject a transport. Nothing in this process calls `fetch` for a provider or for YouTube. Google dispatch stays blocked even when a transport is injected. OpenAI and xAI use `POST /v1/chat/completions` with `Authorization: Bearer` from `OPENAI_API_KEY` or `XAI_API_KEY`. Anthropic uses `POST /v1/messages` with `x-api-key` from `ANTHROPIC_API_KEY` and `anthropic-version: 2026-10-21`. YouTube Data API requests put `key` on the query string, which is that API's documented credential. Returned audit URLs, cards, and display metadata redact that value. Credentials are not written to client JSON or logs.

Chat `POST /api/chats/:id/messages` stores the question and runs it through the provider router. With no server provider key, `providerTurn.status` is `unconfigured` and `text` is null. A key does not by itself make a provider eligible. No assistant message is fabricated. Tests may inject a transport. Production does not.

Saved YouTube items store only a video or playlist id and the user's note. Title, channel, and thumbnail snapshots live in the shared metadata table with `fetched_at`. Rows older than 30 days are excluded and purged, and display re-fetches only through an injected server transport. Stale metadata is not served. Account deletion removes the saved id and note, not the shared cache. This storage rule follows YouTube API Services Developer Policies III.E.4 (30-day non-authorized API data) and III.E.4.g (delete stored user data when the account is deleted). A final policy-text check is still pending before launch.

Login and register in-flight limits are keyed by account email plus source address, not one shared anonymous bucket. Request bodies are counted while they are read. A body over 100,000 bytes is `413` `{ "error": "body_too_large" }` even when `Content-Length` is smaller or absent. Models whose training policy is `unpaid_may_train` or `unknown` are not eligible, and fallback selection checks that again.

## Contract version

Scheduling confirm is version 2. Version 1 confirm bodies that only sent `courseId` are rejected with `preview_required`. There is no automatic upgrade: the client must show the preview and send its `previewId`.

`dueSemantics: "calendar_day"` means the date is a day bucket. Do not compare `dueAt` to the clock time of `now`. A bucket for today remains valid in the afternoon. A bucket after the exam day is not created.

## Additional owned routes

`src/server/resources.ts` handles these for the signed-in user. An item route for another account returns `404` `{ "error": "not_found" }`. A collection route returns `200` and only the caller's rows, so the other account sees an empty list rather than `404`. POST bodies may include `idempotencyKey`. The same user and key replay the stored JSON status and body and do not insert a second row.

| Method and path | Role |
|---|---|
| POST `/api/decks`, POST `/api/decks/:id/cards`, GET `/api/cards`, POST `/api/cards/:id/reviews` | Decks, cards, and revealed self-ratings. Another account's deck or card is `404` |
| POST `/api/labs/projectile`, GET `/api/labs`, GET `/api/labs/:id` | Deterministic projectile run. Item read is owner-only |
| POST `/api/games/built-in`, GET `/api/games`, GET `/api/games/:id` | Built-in game score labeled not mastery. Item read is owner-only |
| POST `/api/chats`, POST/GET `/api/chats/:id/messages`, PATCH/DELETE `/api/chats/:id` | Stored questions. No key is `providerTurn.status` `unconfigured`. An injected test transport is the only execution path |
| POST `/api/uploads`, GET `/api/uploads/:id` | Owner-only text or image bytes. JSON has `id`, `mime`, `byteLength`, and `storage: "private"`. No filesystem path |
| GET `/api/graph`, POST `/api/graph/nodes`, GET `/api/graph/nodes/:id`, POST `/api/graph/edges` | Learner or inferred edges. Inferred is not an academically verified prerequisite. Node item reads are owner-only. An edge write is stored for the caller and does not return the other account's node |
| POST `/api/lens` | Capability decision. `interpretation` stays null. This is not a stored cross-account record |
| GET/POST `/api/device/notes`, GET `/api/device/notes/:id`, POST `/api/device/notes/:id/sync` | Device copy versus server ack. A revision conflict is `409` `{ "error": "sync_conflict" }` and does not change the stored artifact |
| POST `/api/sessions`, GET `/api/sessions/:id`, POST `/api/sessions/:id/pause`, POST `/api/sessions/:id/complete` | Study session timing. Item and command routes are owner-only |

## Responses

Every JSON response sets `Cache-Control: private, no-store`, including actor and auth failures, resource errors, and the `npm run serve` fallback `{ "error": "internal" }`. No `Access-Control-Allow-Origin` header is set. The browser is expected to call relative `/api` on the Next server (`npm run dev` or `npm start`, `127.0.0.1:3000`). `npm run serve` is the same handler on that same default port for API-only use. Do not point the Next app at a second origin.

Origin checks use the `Host` header only. `X-Forwarded-Host` is ignored, so a client cannot make a foreign origin match by sending that header.

Unknown thrown errors return `{ "error": "internal" }` with no message text.
