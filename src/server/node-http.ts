import type { IncomingMessage, ServerResponse } from "node:http";
import { getAppDb } from "./appdb.js";
import { handleApi } from "./api.js";
import { readLimitedNodeBody } from "./body.js";
import { internalErrorHeaders } from "./http.js";
import { AppError } from "../security/crypto.js";

export async function handleNodeRequest(incoming: IncomingMessage, outgoing: ServerResponse, openDb: () => ReturnType<typeof getAppDb> = getAppDb): Promise<void> {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    }
    const method = incoming.method ?? "GET";
    const buffered = method === "GET" || method === "HEAD" ? undefined : await readLimitedNodeBody(incoming);
    const body = buffered ? new TextDecoder().decode(buffered) : undefined;
    const host = headers.get("host") ?? "127.0.0.1:3000";
    const response = await handleApi(new Request(`http://${host}${incoming.url ?? "/"}`, { method, headers, body }), openDb(), {
      source: incoming.socket?.remoteAddress || "local",
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof AppError && error.code === "body_too_large") {
      outgoing.writeHead(413, internalErrorHeaders());
      outgoing.end(JSON.stringify({ error: "body_too_large" }));
      return;
    }
    outgoing.writeHead(500, internalErrorHeaders());
    outgoing.end(JSON.stringify({ error: "internal" }));
  }
}
