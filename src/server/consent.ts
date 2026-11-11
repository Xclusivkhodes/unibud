import { AppError, hashPassword, newId, newSessionToken, nowIso, sha256, verifyPassword } from "../security/crypto.js";
import { all, get, run, type Db } from "../db.js";
import { deleteAccount, exportAccount } from "../domain.js";
import { accountCapabilities, type AgeBand } from "./account-policy.js";
import { CONSENT_TOKEN_TTL_MS, PENDING_CONSENT_TTL_MS } from "./minor-safety.js";
import { writeDevOutbox } from "./mail.js";

export function consentVerified(db: Db, userId: string): boolean {
  const row = get<{ parent_contact_verified: number }>(db, "SELECT parent_contact_verified FROM profiles WHERE user_id = ?", userId);
  return row?.parent_contact_verified === 1;
}

export function requestConsent(db: Db, childUserId: string, input: { parentEmail: string; firstName: string; policyVersion: string; now?: Date; outboxDir: string; log?: (line: string) => void }): { status: "pending"; delivery: "dev_outbox" } {
  const claims = get<{ age_band: string | null; education_level: string | null }>(db, "SELECT age_band, education_level FROM profiles WHERE user_id = ?", childUserId);
  const capabilities = accountCapabilities(claims);
  if (capabilities.age_band !== "under_13") throw new AppError("consent_not_required", "Consent request is only for under_13 accounts.", 403);
  const parentEmail = input.parentEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) throw new AppError("invalid_email", "Email was rejected.", 400);
  if (!input.firstName.trim()) throw new AppError("invalid_first_name", "First name was rejected.", 400);
  if (!input.policyVersion.trim()) throw new AppError("invalid_policy_version", "Policy version was rejected.", 400);
  const now = input.now ?? new Date();
  const token = newSessionToken();
  const at = now.toISOString();
  run(db, "UPDATE profiles SET first_name = ? WHERE user_id = ?", input.firstName.trim(), childUserId);
  run(
    db,
    "INSERT INTO consent_tokens (id, child_user_id, token_hash, parent_email, policy_version, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    newId(),
    childUserId,
    sha256(token),
    parentEmail,
    input.policyVersion.trim(),
    new Date(now.getTime() + CONSENT_TOKEN_TTL_MS).toISOString(),
    at,
  );
  writeDevOutbox({ dir: input.outboxDir, to: parentEmail, token, log: input.log });
  return { status: "pending", delivery: "dev_outbox" };
}

export function completeConsent(db: Db, input: { token: string; parentPassword: string; method: string; now?: Date }): { parentId: string; childUserId: string } {
  if (input.parentPassword.length < 10) throw new AppError("weak_password", "Password was rejected.", 400);
  if (!input.method.trim()) throw new AppError("invalid_consent_method", "Consent method was rejected.", 400);
  const now = input.now ?? new Date();
  const row = get<{ id: string; child_user_id: string; parent_email: string; policy_version: string; expires_at: string; used_at: string | null }>(
    db,
    "SELECT id, child_user_id, parent_email, policy_version, expires_at, used_at FROM consent_tokens WHERE token_hash = ?",
    sha256(input.token),
  );
  if (!row) throw new AppError("consent_token_invalid", "Consent token was rejected.", 400);
  if (row.used_at) throw new AppError("consent_token_used", "Consent token was already used.", 409);
  if (row.expires_at <= now.toISOString()) throw new AppError("consent_token_expired", "Consent token expired.", 400);
  const at = now.toISOString();
  let parent = get<{ id: string }>(db, "SELECT id FROM parent_guardians WHERE email = ?", row.parent_email);
  if (!parent) {
    const parentId = newId();
    run(db, "INSERT INTO parent_guardians (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)", parentId, row.parent_email, hashPassword(input.parentPassword), at);
    parent = { id: parentId };
  }
  run(db, "UPDATE consent_tokens SET used_at = ? WHERE id = ?", at, row.id);
  run(db, "INSERT OR IGNORE INTO parent_links (parent_id, child_user_id, created_at) VALUES (?, ?, ?)", parent.id, row.child_user_id, at);
  run(db, "UPDATE profiles SET parent_contact_verified = 1 WHERE user_id = ?", row.child_user_id);
  run(db, "INSERT INTO consent_log (id, child_user_id, at, method, policy_version, event) VALUES (?, ?, ?, ?, ?, 'completed')", newId(), row.child_user_id, at, input.method.trim(), row.policy_version);
  return { parentId: parent.id, childUserId: row.child_user_id };
}

export function parentFromSession(db: Db, token: string, at = nowIso()): { id: string; email: string } | null {
  const row = get<{ id: string; email: string; expires_at: string }>(
    db,
    "SELECT p.id, p.email, s.expires_at FROM parent_sessions s JOIN parent_guardians p ON p.id = s.parent_id WHERE s.token_hash = ?",
    sha256(token),
  );
  if (!row || row.expires_at <= at) return null;
  return { id: row.id, email: row.email };
}

export function loginParent(db: Db, email: string, password: string, at = nowIso()): { token: string; parentId: string } {
  const parent = get<{ id: string; password_hash: string }>(db, "SELECT id, password_hash FROM parent_guardians WHERE email = ?", email.trim().toLowerCase());
  if (!parent || !verifyPassword(password, parent.password_hash)) throw new AppError("invalid_login", "Login was rejected.", 401);
  const token = newSessionToken();
  const expires = new Date(new Date(at).getTime() + 2 * 60 * 60 * 1000).toISOString();
  run(db, "INSERT INTO parent_sessions (token_hash, parent_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), parent.id, at, expires);
  return { token, parentId: parent.id };
}

function linkedChild(db: Db, parentId: string, childUserId: string): void {
  if (!get(db, "SELECT 1 FROM parent_links WHERE parent_id = ? AND child_user_id = ?", parentId, childUserId)) {
    throw new AppError("not_found", "Not found", 404);
  }
}

export function viewChild(db: Db, parentId: string, childUserId: string) {
  linkedChild(db, parentId, childUserId);
  const profile = get<{ first_name: string; age_band: string | null; education_level: string | null; parent_contact_verified: number }>(
    db,
    "SELECT first_name, age_band, education_level, parent_contact_verified FROM profiles WHERE user_id = ?",
    childUserId,
  );
  const log = all(db, "SELECT at, method, policy_version, event FROM consent_log WHERE child_user_id = ? ORDER BY at", childUserId);
  return { childUserId, first_name: profile?.first_name ?? "", age_band: profile?.age_band ?? null, consent_verified: profile?.parent_contact_verified === 1, consent_log: log };
}

export function exportChild(db: Db, parentId: string, childUserId: string) {
  linkedChild(db, parentId, childUserId);
  return { ...exportAccount(db, childUserId), consent_log: all(db, "SELECT at, method, policy_version, event FROM consent_log WHERE child_user_id = ?", childUserId) };
}

export function revokeChild(db: Db, parentId: string, childUserId: string): { deleted: true } {
  linkedChild(db, parentId, childUserId);
  deleteAccount(db, childUserId);
  return { deleted: true };
}

export function purgePendingConsent(db: Db, now: Date): { deleted: string[] } {
  const cutoff = new Date(now.getTime() - PENDING_CONSENT_TTL_MS).toISOString();
  const rows = all<{ id: string }>(
    db,
    `SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE p.age_band = 'under_13' AND p.parent_contact_verified = 0 AND u.created_at <= ?`,
    cutoff,
  );
  const deleted: string[] = [];
  for (const row of rows) {
    deleteAccount(db, row.id);
    deleted.push(row.id);
  }
  return { deleted };
}

export function assertUploadAllowed(db: Db, userId: string, ageBand: AgeBand | null): void {
  if (ageBand === "under_13" && !consentVerified(db, userId)) throw new AppError("consent_required", "Uploads wait for parental consent.", 403);
}

export function assertAiAllowed(db: Db, userId: string, ageBand: AgeBand | null): void {
  if (ageBand === "under_13" && !consentVerified(db, userId)) throw new AppError("consent_required", "AI waits for parental consent.", 403);
}
