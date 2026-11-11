import { redact } from "../security/redact.js";
import { normalizeStatus, type ProviderTurnResult } from "./execute.js";

/**
 * Server-only request shapes for hosted providers.
 * Credentials travel only in the object handed to an injected transport.
 * Returned values name the env var and never include the secret.
 * This module does not call fetch.
 */

export const PROVIDER_CREDENTIAL_ENV = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
} as const;

/** Messages API version named by the current docs example. Not a live call. */
export const ANTHROPIC_VERSION = "2026-10-21";

/** Required Messages field. Docs example ceiling, not a measured model limit. */
export const ANTHROPIC_MAX_TOKENS = 1024;

export type ProviderWire = {
  method: "POST";
  url: string;
  credentialEnv: (typeof PROVIDER_CREDENTIAL_ENV)[keyof typeof PROVIDER_CREDENTIAL_ENV];
  body: Record<string, unknown>;
};

export type ProviderHttpTransport = (input: {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; body: unknown }>;

export function buildProviderWire(provider: string, model: string, prompt: string): ProviderWire | null {
  if (provider === "google") {
    return {
      method: "POST",
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      credentialEnv: PROVIDER_CREDENTIAL_ENV.google,
      body: { contents: [{ role: "user", parts: [{ text: prompt }] }] },
    };
  }
  if (provider === "openai" || provider === "xai") {
    const origin = provider === "openai" ? "https://api.openai.com" : "https://api.x.ai";
    return {
      method: "POST",
      url: `${origin}/v1/chat/completions`,
      credentialEnv: provider === "openai" ? PROVIDER_CREDENTIAL_ENV.openai : PROVIDER_CREDENTIAL_ENV.xai,
      body: { model, messages: [{ role: "user", content: prompt }] },
    };
  }
  if (provider === "anthropic") {
    return {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      credentialEnv: PROVIDER_CREDENTIAL_ENV.anthropic,
      body: { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages: [{ role: "user", content: prompt }] },
    };
  }
  return null;
}

export function providerCredentialHeader(provider: string, credential: string): Record<string, string> {
  if (provider === "google") return { "content-type": "application/json", "x-goog-api-key": credential };
  if (provider === "anthropic") {
    return { "content-type": "application/json", "x-api-key": credential, "anthropic-version": ANTHROPIC_VERSION };
  }
  return { "content-type": "application/json", authorization: `Bearer ${credential}` };
}

function scrub(value: unknown, secret: string): unknown {
  if (!secret || secret.length < 8) return value;
  const encoded = JSON.stringify(value).split(secret).join("[redacted]");
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return { redacted: true };
  }
}

function partText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

export function readProviderText(provider: string, body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (provider === "openai" || provider === "xai") {
    const choices = record.choices;
    const first = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined) : undefined;
    return partText(first?.message?.content);
  }
  if (provider === "anthropic") {
    const blocks = record.content;
    if (!Array.isArray(blocks)) return "";
    return blocks
      .filter((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text")
      .map((block) => partText((block as { text?: unknown }).text))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export async function executeProviderRequest(input: {
  provider: string;
  model: string;
  prompt: string;
  credential?: string;
  allowNetwork?: boolean;
  signal?: AbortSignal;
  transport?: ProviderHttpTransport;
}): Promise<ProviderTurnResult & { wire: ProviderWire | null }> {
  const wire = buildProviderWire(input.provider, input.model, input.prompt);
  const secret = input.credential ?? "";
  const visibleWire = wire ? (scrub(wire, secret) as ProviderWire) : null;
  if (input.signal?.aborted) {
    return { status: "cancelled", text: null, executed: false, fixture: false, billing: "not_sent", wire: visibleWire };
  }
  if (input.provider === "google") {
    return {
      status: "not_executed",
      text: null,
      executed: false,
      fixture: false,
      billing: "not_sent",
      normalized: { code: "policy", retryable: false },
      wire: visibleWire,
    };
  }
  if (!wire || input.allowNetwork !== true || !input.transport || !secret.trim()) {
    return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent", wire: visibleWire };
  }
  let response: { status: number; body: unknown };
  try {
    response = await input.transport({
      method: wire.method,
      url: wire.url,
      headers: providerCredentialHeader(input.provider, secret),
      body: JSON.stringify(wire.body),
      signal: input.signal,
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
    return {
      status: "ambiguous",
      text: null,
      executed: false,
      fixture: true,
      billing: "ambiguous",
      normalized: normalizeStatus(input.signal?.aborted ? 0 : status, Boolean(input.signal?.aborted)),
      wire: visibleWire,
    };
  }
  if (response.status !== 200) {
    return {
      status: "ambiguous",
      text: null,
      executed: false,
      fixture: true,
      billing: "ambiguous",
      normalized: normalizeStatus(response.status, Boolean(input.signal?.aborted)),
      wire: visibleWire,
    };
  }
  const text = redact(String(scrub(readProviderText(input.provider, response.body), secret)));
  return { status: "ok", text, executed: true, fixture: true, billing: "fixture_not_a_provider_charge", wire: visibleWire };
}
