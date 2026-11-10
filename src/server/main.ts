import { createServer } from "node:http";
import { getAppDb } from "./appdb.js";
import { handleApi } from "./api.js";
import { internalErrorHeaders } from "./http.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 3000);

const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const method = incoming.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
    const response = await handleApi(new Request(`http://${host}:${port}${incoming.url ?? "/"}`, { method, headers, body }), getAppDb());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, internalErrorHeaders());
    outgoing.end(JSON.stringify({ error: "internal" }));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`UniBud API listening on http://${host}:${port}\n`);
});
