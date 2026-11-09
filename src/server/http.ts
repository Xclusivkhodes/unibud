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

export function sessionCookie(token: string): string {
  const secure = process.env.UNIBUD_COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60}${secure}`;
}

export function actor(db: Db, request: Request): { id: string; email: string; data_class: string } | Response {
  const token = tokenFromRequest(request);
  if (!token) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const user = userFromSession(db, token);
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return user;
}

export function postRegister(db: Db, body: { email?: string; password?: string }): Response {
  try {
    const user = registerUser(db, { email: body.email ?? "", password: body.password ?? "" });
    const session = login(db, user.email, body.password ?? "");
    return Response.json({ userId: user.id }, { status: 201, headers: { "set-cookie": sessionCookie(session.token) } });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "internal";
    const status = error instanceof AppError ? error.status : 500;
    return Response.json({ error: code }, { status });
  }
}

export function readCourse(db: Db, request: Request, courseId: string): Response {
  const user = actor(db, request);
  if (user instanceof Response) return user;
  const course = get(db, "SELECT id, name, goal_text, subject_name FROM courses WHERE id = ? AND user_id = ?", courseId, user.id);
  if (!course) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ course });
}
