import type { ProviderTurnResult } from "./execute.js";
import { executeProviderRequest, type ProviderHttpTransport } from "./request.js";
import { planRoute, REGISTRY, type ProviderId, type RegistryEntry, type RouteInput } from "./registry.js";

const CREDENTIAL_ENV = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
} as const;

let injected: ProviderHttpTransport | null = null;

/** Test-only. Production leaves this unset and does not call fetch. */
export function setChatTransportForTests(transport: ProviderHttpTransport | null): void {
  injected = transport;
}

export function configuredProviderIds(): ProviderId[] {
  return (Object.keys(CREDENTIAL_ENV) as Array<keyof typeof CREDENTIAL_ENV>).filter((id) => Boolean(process.env[CREDENTIAL_ENV[id]]?.trim()));
}

export function unconfiguredTurn(): ProviderTurnResult {
  return { status: "unconfigured", text: null, executed: false, fixture: false, billing: "not_sent" };
}

export async function runChatProvider(input: {
  prompt: string;
  signal?: AbortSignal;
  catalog?: RegistryEntry[];
  transport?: ProviderHttpTransport | null;
  grants?: string[];
  route?: Partial<RouteInput>;
}): Promise<ProviderTurnResult> {
  const configured = configuredProviderIds();
  if (configured.length === 0) return unconfiguredTurn();
  const route: RouteInput = {
    task: "tutoring",
    required: ["text"],
    sensitivity: "unknown",
    audience: "unknown",
    billingTier: "unknown",
    grants: input.grants ?? [],
    retention: "strict",
    costMode: "unknown_cost_allowed",
    residency: "unspecified",
    independentCheck: false,
    online: true,
    configuredProviders: configured,
    ...input.route,
  };
  const plan = planRoute(route, input.catalog ?? REGISTRY);
  const transport = input.transport === undefined ? injected : input.transport;
  if (plan.status !== "selected" || !plan.primary) {
    return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent" };
  }
  const envName = CREDENTIAL_ENV[plan.primary.provider as keyof typeof CREDENTIAL_ENV];
  const credential = envName ? process.env[envName]?.trim() ?? "" : "";
  if (!credential) return unconfiguredTurn();
  if (!transport) return { status: "not_executed", text: null, executed: false, fixture: false, billing: "not_sent" };
  const result = await executeProviderRequest({
    provider: plan.primary.provider,
    model: plan.primary.model,
    prompt: input.prompt,
    credential,
    allowNetwork: true,
    signal: input.signal,
    transport,
  });
  const { wire: _ignored, ...turn } = result;
  return turn;
}
