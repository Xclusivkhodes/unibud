import { get, type Db } from "../db.js";
import { login, registerUser, userFromSession } from "../domain.js";
import { AppError } from "../security/crypto.js";

export const SESSION_COOKIE = "unibud_session";

export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Secure unless local HTTP opts out with UNIBUD_COOKIE_INSECURE=1. */
export function cookieIsSecure(): boolean {
  return process.env.UNIBUD_COOKIE_INSECURE !== "1";
}

export function sessionCookie(token: string, maxAgeSeconds = 14 * 24 * 60 * 60): string {
  const secure = cookieIsSecure() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = cookieIsSecure() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function internalErrorHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    pragma: "no-cache",
  };
}

export function privateJson(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  return new Response(JSON.stringify(body), { status, headers });
}

export function actor(db: Db, request: Request): { id: string; email: string; data_class: string } | Response {
  const token = tokenFromRequest(request);
  if (!token) return privateJson({ error: "unauthenticated" }, 401);
  const user = userFromSession(db, token);
  if (!user) return privateJson({ error: "unauthenticated" }, 401);
  return user;
}

export function postRegister(db: Db, body: { email?: string; password?: string }): Response {
  try {
    const user = registerUser(db, { email: body.email ?? "", password: body.password ?? "" });
    const session = login(db, user.email, body.password ?? "");
    return privateJson({ userId: user.id }, 201, { "set-cookie": sessionCookie(session.token, session.maxAgeSeconds) });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "internal";
    const status = error instanceof AppError ? error.status : 500;
    return privateJson({ error: code }, status);
  }
}

export function readCourse(db: Db, request: Request, courseId: string): Response {
  const user = actor(db, request);
  if (user instanceof Response) return user;
  const course = get(db, "SELECT id, name, goal_text, subject_name FROM courses WHERE id = ? AND user_id = ?", courseId, user.id);
  if (!course) return privateJson({ error: "not_found" }, 404);
  return privateJson({ course });
}
