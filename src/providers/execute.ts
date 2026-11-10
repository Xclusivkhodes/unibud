import { AppError } from "../security/crypto.js";

export type ProviderTurn = {
  provider: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  transport?: (input: { prompt: string; signal?: AbortSignal }) => Promise<{ text: string }>;
  allowNetwork?: boolean;
};

export type ProviderTurnResult = {
  status: "not_executed" | "ok" | "cancelled" | "ambiguous" | "unconfigured";
  text: string | null;
  executed: boolean;
  fixture: boolean;
  billing: "not_sent" | "fixture_not_a_provider_charge" | "ambiguous";
  normalized?: NormalizedProviderError;
};

/** Default path performs no network I/O. A test may pass a transport and allowNetwork. */
export async function executeProvider(input: ProviderTurn): Promise<ProviderTurnResult> {
  if (input.signal?.aborted) return { status: "cancelled", text: null, executed: false, fixture: false, billing: "not_sent" };
  if (input.provider === "google") {
    return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent", normalized: { code: "policy", retryable: false } };
  }
  if (input.allowNetwork !== true || !input.transport) {
    return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent" };
  }
  try {
    const result = await input.transport({ prompt: input.prompt, signal: input.signal });
    return { status: "ok", text: result.text, executed: true, fixture: true, billing: "fixture_not_a_provider_charge" };
  } catch (error) {
    if (input.signal?.aborted) return { status: "ambiguous", text: null, executed: false, fixture: true, billing: "ambiguous", normalized: normalizeStatus(0, true) };
    if (error instanceof AppError) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
    const normalized = normalizeStatus(status, false);
    // The injected transport was invoked, so this is not "not sent".
    return { status: "ambiguous", text: null, executed: false, fixture: true, billing: "ambiguous", normalized };
  }
}

export type NormalizedProviderError = {
  code: "cancelled" | "rate_limited" | "timeout_ambiguous" | "unauthorized" | "forbidden" | "not_found" | "schema" | "unavailable" | "policy";
  retryable: boolean;
};

export function normalizeStatus(status: number, aborted: boolean): NormalizedProviderError {
  if (aborted) return { code: "timeout_ambiguous", retryable: false };
  if (status === 401) return { code: "unauthorized", retryable: false };
  if (status === 403) return { code: "forbidden", retryable: false };
  if (status === 404) return { code: "not_found", retryable: false };
  if (status === 408) return { code: "timeout_ambiguous", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status >= 500) return { code: "unavailable", retryable: true };
  return { code: "schema", retryable: false };
}

export async function runMockEval(fixtures: Array<{ id: string; provider: string; model: string; prompt: string; status: number }>): Promise<Array<{ id: string; transportCalls: number; result: ProviderTurnResult; score: null }>> {
  const rows = [];
  for (const fixture of fixtures) {
    let transportCalls = 0;
    const result = await executeProvider({
      provider: fixture.provider,
      model: fixture.model,
      prompt: fixture.prompt,
      allowNetwork: true,
      transport: async () => {
        transportCalls += 1;
        if (fixture.status !== 200) throw Object.assign(new Error("fixture status"), { status: fixture.status });
        return { text: `fixture:${fixture.id}` };
      },
    });
    rows.push({ id: fixture.id, transportCalls, result, score: null });
  }
  return rows;
}
