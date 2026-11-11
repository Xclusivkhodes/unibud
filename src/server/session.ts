import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get } from "../db.js";
import { userFromSession } from "../domain.js";
import { getAppDb } from "./appdb.js";
import { cookieIsSecure, SESSION_COOKIE } from "./http.js";

export async function setSession(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieIsSecure(),
    maxAge: 14 * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userFromSession(getAppDb(), token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function profileOf(userId: string) {
  return get<{ display_name: string; timezone: string; rev: number; onboarding_status: string; explanation_depth: string; goals_text: string; offline_consent: number }>(
    getAppDb(),
    "SELECT display_name, timezone, rev, onboarding_status, explanation_depth, goals_text, offline_consent FROM profiles WHERE user_id = ?",
    userId,
  );
}
