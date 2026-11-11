import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError, newId } from "../security/crypto.js";

export type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };

/** Reads SMTP settings from the environment. Missing any value fails closed and does not open a socket. */
export function smtpConfigFromEnv(env: Record<string, string | undefined> = process.env): SmtpConfig {
  const host = env.UNIBUD_SMTP_HOST?.trim() ?? "";
  const port = Number(env.UNIBUD_SMTP_PORT ?? "");
  const user = env.UNIBUD_SMTP_USER?.trim() ?? "";
  const password = env.UNIBUD_SMTP_PASSWORD ?? "";
  const from = env.UNIBUD_SMTP_FROM?.trim() ?? "";
  if (!host || !Number.isInteger(port) || port <= 0 || !user || !password || !from) {
    throw new AppError("smtp_unconfigured", "SMTP is not configured.", 503);
  }
  return { host, port, user, password, from };
}

export type SmtpSocket = { write(line: string): void; end(): void };

/**
 * Live SMTP is not activated. A caller must pass a socket factory, and this build's consent path never does.
 * Unset configuration throws before any factory runs.
 */
export function sendSmtpMessage(env: Record<string, string | undefined>, message: { to: string; body: string }, connect?: (host: string, port: number) => SmtpSocket): void {
  const config = smtpConfigFromEnv(env);
  if (!connect) throw new AppError("smtp_transport_unavailable", "SMTP send is not activated.", 503);
  const socket = connect(config.host, config.port);
  socket.write(`To: ${message.to}\r\n\r\n${message.body}`);
  socket.end();
}

export function writeDevOutbox(input: { dir: string; to: string; token: string; log?: (line: string) => void }): { file: string } {
  mkdirSync(input.dir, { recursive: true });
  const file = path.join(input.dir, `${newId()}.json`);
  writeFileSync(file, JSON.stringify({ to: input.to, token: input.token }));
  (input.log ?? console.info)("consent link REDACTED");
  return { file };
}
