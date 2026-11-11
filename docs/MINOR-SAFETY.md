# Minor-safety controls

This note is an implementation record for review. It is not a COPPA or Ghana Data Protection Act compliance claim. Both regimes are pending CyberBrain legal review. Nothing here authorizes production child accounts, live email, or a live model call.

## Locked contract conflicts

`POST /api/auth/register` and `GET /api/me` stay on the frozen shape from the previous branch.

- Register still requires an email and password, and it still opens a learner session. A minimal under-13 intake of only first name, age band, and parent email would drop those fields, so it is not the register body. `parent_email` on register is rejected with `parent_email_not_on_register`. First name is stored later by `POST /api/consent/request`.
- `date_of_birth` is optional and is not stored. When it is present, the server derives `age_band` and rejects a conflicting client band with `age_band_conflict`. When it is absent, the locked contract still accepts the band the client sends. That is a self-reported claim, not a verified age. A later `PATCH /api/profile` that includes `age_band` is `409` `age_band_frozen` and does not write it. Completion cannot change a band that is already stored.
- `GET /api/me` keeps `account_status: pending_parental_consent` for every `under_13` account, including after a recorded consent. The locked derivation treats `under_13` as pending. Consent is `profiles.parent_contact_verified` plus a `consent_log` row. Callers must not treat the wire status as "consent has not been recorded."
- `ai_available` stays false. No provider is cleared for any age band in this build. Google stays blocked for the whole app.

## Controls

1. Age band is read from the database on each login, chat, upload, circle, and YouTube request. The session cookie carries a token and a lifetime, not an age band.
2. Under-13 accounts start pending. Until `parent_contact_verified` is set, uploads, Study Circle, AI, and YouTube watch history are refused. The consent token is 32 random bytes, stored as SHA-256, single-use, and expires after 24 hours. The log stores timestamp, method, and policy version. A parent session, not the child session and not the mailbox token, can view, export, delete, and revoke. Delete and revoke both call `deleteAccount`. Pending under-13 accounts are removed by `purgePendingConsent` after 14 days.
3. Under-18 accounts, including junior high or senior high with an `18_plus` band, have no public profile and no email search hit. Analytics and advertising fields are rejected and not stored.
4. Study Circle already exists. Under-13 join is `POST /api/circles/join` with an invite code for a circle whose `creator_kind` is `parent` or `teacher`. Teacher verification is `users.verified_teacher`, set only by `POST /api/admin/teachers` when `UNIBUD_ADMIN_TOKEN` is set. Email invites do not add a minor. A university `18_plus` account cannot add a minor. Direct messages require two active members of the same circle. `POST /api/circles/:id/reports` revokes the target immediately.
5. The provider router returns `age_band_provider_not_cleared` for `under_13`, `13_17`, a missing band, and junior high or senior high, including on `fallbackAfter`. `18_plus` university still cannot use Google, and paid providers stay off unless a test sets `allowPaidProviders`.
6. YouTube search uses `safeSearch=strict` for every under-18 account. `watch_history` is not written for `under_13`.
7. Under-13 sessions last **2 hours** (`UNDER_13_SESSION_SECONDS` = 7200). Other bands stay at 14 days. The database expiry and the cookie `Max-Age` use that value.

## Email

No paid email provider is used. Consent links are written under `UNIBUD_OUTBOX_DIR` or `.data/outbox`. Logs say `consent link REDACTED` and do not include the token. `smtpConfigFromEnv` throws `smtp_unconfigured` when any SMTP variable is missing. `sendSmtpMessage` throws `smtp_transport_unavailable` unless a caller injects a socket, and the consent path never injects one.
