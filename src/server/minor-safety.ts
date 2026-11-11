import { AppError } from "../security/crypto.js";
import type { AgeBand, EducationLevel, AccountCapabilities } from "./account-policy.js";

/** Learner session length. under_13 is 2 hours. Every other band stays at 14 days. */
export const DEFAULT_SESSION_SECONDS = 14 * 24 * 60 * 60;
export const UNDER_13_SESSION_SECONDS = 2 * 60 * 60;
export const CONSENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PENDING_CONSENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const TRACKING_KEYS = new Set(["analytics_id", "advertising_id", "ga_client_id", "ad_id", "idfa", "gaid"]);

export function sessionSecondsFor(ageBand: AgeBand | null | undefined): number {
  return ageBand === "under_13" ? UNDER_13_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
}

export function ageBandFromDateOfBirth(isoDate: string, now = new Date()): AgeBand {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new AppError("invalid_date_of_birth", "Date of birth was rejected.", 400);
  const [year, month, day] = isoDate.split("-").map(Number);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) {
    throw new AppError("invalid_date_of_birth", "Date of birth was rejected.", 400);
  }
  let age = now.getUTCFullYear() - year;
  const today = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  if (today < month * 100 + day) age -= 1;
  if (age < 0 || age > 120) throw new AppError("invalid_date_of_birth", "Date of birth was rejected.", 400);
  if (age < 13) return "under_13";
  if (age < 18) return "13_17";
  return "18_plus";
}

export function isUnder18(claims: { age_band: AgeBand | null; education_level: EducationLevel | null }): boolean {
  if (claims.age_band === "under_13" || claims.age_band === "13_17" || claims.age_band === null) return true;
  return claims.education_level === "junior_high" || claims.education_level === "senior_high";
}

export function isPublicProfileAllowed(claims: { age_band: AgeBand | null; education_level: EducationLevel | null }): boolean {
  return claims.age_band === "18_plus" && claims.education_level === "university";
}

export function safeSearchFor(claims: { age_band: AgeBand | null; education_level: EducationLevel | null }): "strict" | "moderate" {
  return isUnder18(claims) ? "strict" : "moderate";
}

export function providerClearedForAge(input: { ageBand?: AgeBand | null; educationLevel?: EducationLevel | null }): boolean {
  if (input.ageBand === undefined && input.educationLevel === undefined) return true;
  if (input.educationLevel === "junior_high" || input.educationLevel === "senior_high") return false;
  if (input.ageBand !== undefined && input.ageBand !== "18_plus") return false;
  return true;
}

export function rejectTrackingFields(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    const normalized = key.trim().toLowerCase();
    if (TRACKING_KEYS.has(normalized) || normalized.startsWith("analytics_") || normalized.startsWith("advertising_") || normalized.startsWith("ad_")) {
      throw new AppError("analytics_identifier_rejected", "Analytics and advertising identifiers are not accepted.", 403);
    }
  }
}

export function minorInviteBlocked(actor: AccountCapabilities, target: AccountCapabilities | null): "cross_level" | "email_discovery" | null {
  if (!target || !isUnder18(target)) return null;
  if (actor.age_band === "18_plus" && actor.education_level === "university") return "cross_level";
  return "email_discovery";
}
