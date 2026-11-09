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
  status: "not_executed" | "ok" | "cancelled" | "ambiguous";
  text: string | null;
  executed: boolean;
  fixture: boolean;
  billing: "not_sent" | "fixture_not_a_provider_charge" | "ambiguous";
};

/** Default path performs no network I/O. A test may pass a transport and allowNetwork. */
export async function executeProvider(input: ProviderTurn): Promise<ProviderTurnResult> {
  if (input.signal?.aborted) return { status: "cancelled", text: null, executed: false, fixture: false, billing: "not_sent" };
  if (input.provider === "google" || input.allowNetwork !== true || !input.transport) {
    return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent" };
  }
  try {
    const result = await input.transport({ prompt: input.prompt, signal: input.signal });
    return { status: "ok", text: result.text, executed: true, fixture: true, billing: "fixture_not_a_provider_charge" };
  } catch (error) {
    if (input.signal?.aborted) return { status: "ambiguous", text: null, executed: false, fixture: true, billing: "ambiguous" };
    if (error instanceof AppError) throw error;
    return { status: "ambiguous", text: null, executed: false, fixture: true, billing: "ambiguous" };
  }
}
