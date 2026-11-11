import { AppError } from "../security/crypto.js";

export const EDUCATION_LEVELS = ["university", "senior_high", "junior_high"] as const;
export const AGE_BANDS = ["under_13", "13_17", "18_plus"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type AccountStatus = "active" | "pending_parental_consent";
export type SharingMode = "disabled" | "restricted" | "standard";

export type ProfileClaims = {
  education_level: EducationLevel | null;
  age_band: AgeBand | null;
};

export type AccountCapabilities = ProfileClaims & {
  account_status: AccountStatus;
  ai_available: false;
  needs_profile_completion: boolean;
  sharing: SharingMode;
};

const EDUCATION = new Set<string>(EDUCATION_LEVELS);
const AGE = new Set<string>(AGE_BANDS);

export function parseEducationLevel(value: string): EducationLevel {
  if (!EDUCATION.has(value)) throw new AppError("invalid_education_level", "Education level was rejected.", 400);
  return value as EducationLevel;
}

export function parseAgeBand(value: string): AgeBand {
  if (!AGE.has(value)) throw new AppError("invalid_age_band", "Age band was rejected.", 400);
  return value as AgeBand;
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function readProfileClaims(row: { education_level?: string | null; age_band?: string | null } | null | undefined): ProfileClaims {
  const education = blank(row?.education_level);
  const age = blank(row?.age_band);
  return {
    education_level: education && EDUCATION.has(education) ? (education as EducationLevel) : null,
    age_band: age && AGE.has(age) ? (age as AgeBand) : null,
  };
}

/**
 * Missing age is not stored as a band. Capabilities treat it as the most restrictive case.
 * under_13 is applied before school level. JHS/SHS add under-18 limits and do not loosen under_13.
 * ai_available is false: Gemini is blocked for this whole API client and no other provider is cleared.
 */
export function accountCapabilities(row: { education_level?: string | null; age_band?: string | null } | null | undefined): AccountCapabilities {
  const claims = readProfileClaims(row);
  const age = claims.age_band;
  const education = claims.education_level;
  const under13 = age === "under_13" || age === null;
  let sharing: SharingMode = "standard";
  if (under13 || education === "junior_high") sharing = "disabled";
  else if (age === "13_17" || education === "senior_high") sharing = "restricted";
  return {
    ...claims,
    account_status: under13 ? "pending_parental_consent" : "active",
    ai_available: false,
    needs_profile_completion: age === null || education === null,
    sharing,
  };
}

export function assertCircleAllowed(capabilities: AccountCapabilities, action: "invite" | "participate"): void {
  if (capabilities.sharing === "disabled") throw new AppError("circle_sharing_disabled", "Study Circle is not available for this account.", 403);
  if (capabilities.sharing === "restricted" && action === "invite") throw new AppError("circle_sharing_restricted", "External Study Circle invites are not available for this account.", 403);
}
