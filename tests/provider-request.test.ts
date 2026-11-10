import { expect, test } from "vitest";
import { executeProvider, normalizeStatus } from "../src/providers/execute.js";
import {
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_VERSION,
  buildProviderWire,
  executeProviderRequest,
  type ProviderHttpTransport,
} from "../src/providers/request.js";

const SECRET = "dummy-test-key";

test("hosted request contracts stay on injected transports and keep credentials out of results", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("live network is not used");
  };
  try {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const transport: ProviderHttpTransport = async (input) => {
      seen.push({ url: input.url, headers: input.headers, body: input.body });
      if (input.url.includes("api.anthropic.com")) {
        return { status: 200, body: { content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: `ok ${SECRET}` }] } };
      }
      if (input.headers.authorization?.includes(SECRET) && input.url.includes("status-401")) {
        return { status: 401, body: { error: SECRET } };
      }
      return { status: 200, body: { choices: [{ message: { content: `answer ${SECRET}` } }] } };
    };

    const google = await executeProviderRequest({
      provider: "google",
      model: "gemma-4-26b-a4b-it",
      prompt: "explain",
      credential: SECRET,
      allowNetwork: true,
      transport,
    });
    expect(google.status).toBe("not_executed");
    expect(google.normalized).toEqual({ code: "policy", retryable: false });
    expect(google.wire?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent");
    expect(google.wire?.credentialEnv).toBe("GEMINI_API_KEY");
    expect(JSON.stringify(google)).not.toContain(SECRET);
    expect(seen).toHaveLength(0);

    const openai = await executeProviderRequest({
      provider: "openai",
      model: "gpt-6-astra",
      prompt: "explain acids",
      credential: SECRET,
      allowNetwork: true,
      transport,
    });
    expect(openai.status).toBe("ok");
    expect(openai.text).toBe("answer [redacted]");
    expect(openai.wire?.credentialEnv).toBe("OPENAI_API_KEY");
    expect(seen[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ model: "gpt-6-astra", messages: [{ role: "user", content: "explain acids" }] });
    expect(JSON.stringify(openai)).not.toContain(SECRET);

    const anthropic = await executeProviderRequest({
      provider: "anthropic",
      model: "claude-opus-5-5",
      prompt: "explain acids",
      credential: SECRET,
      allowNetwork: true,
      transport,
    });
    expect(anthropic.wire?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[1]?.headers["x-api-key"]).toBe(SECRET);
    expect(seen[1]?.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(JSON.parse(seen[1]?.body ?? "{}").max_tokens).toBe(ANTHROPIC_MAX_TOKENS);
    expect(anthropic.text).toBe("ok [redacted]");
    expect(JSON.stringify(anthropic)).not.toContain(SECRET);

    const xai = await executeProviderRequest({
      provider: "xai",
      model: "grok-4.7",
      prompt: "explain acids",
      credential: SECRET,
      allowNetwork: true,
      transport,
    });
    expect(xai.wire?.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(xai.wire?.credentialEnv).toBe("XAI_API_KEY");
    expect(seen[2]?.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.stringify(xai)).not.toContain(SECRET);

    const denied = await executeProviderRequest({
      provider: "openai",
      model: "gpt-6-astra",
      prompt: "status-401",
      credential: SECRET,
      allowNetwork: true,
      transport: async () => ({ status: 401, body: { message: SECRET } }),
    });
    expect(denied.status).toBe("ambiguous");
    expect(denied.text).toBeNull();
    expect(denied.normalized).toEqual({ code: "unauthorized", retryable: false });
    expect(JSON.stringify(denied)).not.toContain(SECRET);

    const blocked = await executeProviderRequest({ provider: "openai", model: "gpt-6-astra", prompt: "x", credential: SECRET, transport });
    expect(blocked.status).toBe("not_executed");
    expect(seen).toHaveLength(3);

    const thrown = await executeProviderRequest({
      provider: "openai",
      model: "gpt-6-astra",
      prompt: "x",
      credential: SECRET,
      allowNetwork: true,
      transport: async () => {
        throw new Error(`socket ${SECRET}`);
      },
    });
    expect(thrown.status).toBe("ambiguous");
    expect(thrown.text).toBeNull();
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
    expect(buildProviderWire("loopback", "local", "x")).toBeNull();
    expect(normalizeStatus(408, false)).toEqual({ code: "timeout_ambiguous", retryable: false });
    expect(normalizeStatus(500, false)).toEqual({ code: "unavailable", retryable: true });
    expect(normalizeStatus(403, false)).toEqual({ code: "forbidden", retryable: false });
    const failed = await executeProvider({
      provider: "openai",
      model: "synthetic",
      prompt: "x",
      allowNetwork: true,
      transport: async () => {
        throw Object.assign(new Error("fixture status"), { status: 429 });
      },
    });
    expect(failed.status).toBe("ambiguous");
    expect(failed.billing).toBe("ambiguous");
    expect(failed.normalized).toEqual({ code: "rate_limited", retryable: true });
    expect(JSON.stringify(failed)).not.toContain(SECRET);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
