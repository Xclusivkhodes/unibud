import { codeFrom } from "./present.js";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: unknown;

  constructor(code: string, status: number, body: unknown) {
    super(code);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export async function api(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" && method !== "HEAD" ? { "x-unibud-request": "1" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiClientError("offline", 0, null);
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) throw new ApiClientError(codeFrom(parsed, response.status), response.status, parsed);
  return parsed;
}

export function errorCode(caught: unknown): string {
  return caught instanceof ApiClientError ? caught.code : "internal";
}

export function clientToken(): string {
  return crypto.randomUUID();
}

export function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
