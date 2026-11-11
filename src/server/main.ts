import { createServer } from "node:http";
import { getAppDb } from "./appdb.js";
import { handleNodeRequest } from "./node-http.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 3000);

const server = createServer((incoming, outgoing) => {
  void handleNodeRequest(incoming, outgoing, getAppDb);
});

server.listen(port, host, () => {
  process.stdout.write(`UniBud API listening on http://${host}:${port}\n`);
});
