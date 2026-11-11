import { AppError } from "../security/crypto.js";
import { MAX_BODY_CHARS } from "./limits.js";

export async function readLimitedBytes(body: ReadableStream<Uint8Array> | null, max = MAX_BODY_CHARS): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > max) {
        cancelled = true;
        await reader.cancel();
        throw new AppError("body_too_large", "Body was rejected.", 413);
      }
      chunks.push(value);
    }
  } finally {
    if (!cancelled) reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Counts bytes while reading. Content-Length is not consulted. JSON.parse runs only after the cap holds. */
export async function readLimitedJson(request: Request, max = MAX_BODY_CHARS): Promise<Record<string, unknown>> {
  const bytes = await readLimitedBytes(request.body, max);
  if (bytes.byteLength === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AppError("invalid_json", "JSON body was rejected.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid_json", "JSON body was rejected.", 400);
  return value as Record<string, unknown>;
}

type NodeBodyStream = AsyncIterable<Uint8Array | string> & { destroy?: (error?: Error) => void };

export async function readLimitedNodeBody(incoming: NodeBodyStream, max = MAX_BODY_CHARS): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of incoming) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    total += buf.length;
    if (total > max) {
      incoming.destroy?.();
      throw new AppError("body_too_large", "Body was rejected.", 413);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
