import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { all, get, run, type Db } from "../db.js";
import {
  addCard,
  addGraphEdge,
  addGraphNode,
  addSource,
  applyArtifactUpdate,
  askTutor,
  completeSession,
  createChat,
  createDeck,
  deleteChat,
  lensDecision,
  pauseSession,
  renameChat,
  reviewCard,
  saveGame,
  saveLab,
  startSession,
} from "../domain.js";
import { projectile, scoreBuiltInGame } from "../learning/labs.js";
import { executeProvider } from "../providers/execute.js";
import { AppError, newId, nowIso } from "../security/crypto.js";
import { inspectUpload, storagePath } from "../security/uploads.js";
import { DeviceStore } from "../device/store.js";
import { actor } from "./http.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function once(db: Db, userId: string, key: string, make: () => Promise<Response> | Response): Promise<Response> {
  if (!key) return make();
  const prior = get<{ response_json: string }>(db, "SELECT response_json FROM idempotency WHERE user_id = ? AND key = ?", userId, key);
  if (prior) {
    const saved = JSON.parse(prior.response_json) as { status: number; body: unknown };
    return json(saved.body, saved.status);
  }
  const response = await make();
  if (response.status < 500) {
    const body = await response.clone().json();
    run(db, "INSERT INTO idempotency (user_id, key, response_json, created_at) VALUES (?, ?, ?, ?)", userId, key, JSON.stringify({ status: response.status, body }), nowIso());
  }
  return response;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid_json", "JSON body was rejected.", 400);
  return value as Record<string, unknown>;
}

const OWNED = /^\/api\/(decks|cards|labs|games|chats|uploads|graph|lens|device|sessions)(\/|$)/;

export async function handleOwnedResources(request: Request, db: Db, pathname: string, method: string): Promise<Response | null> {
  if (!OWNED.test(pathname)) return null;
  const found = actor(db, request);
  if (found instanceof Response) return found;
  const userId = found.id;
  if (pathname === "/api/decks" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => json({ deck: createDeck(db, userId, { title: str(body.title), courseId: str(body.courseId) || undefined }) }, 201));
  }
  const deckCards = pathname.match(/^\/api\/decks\/([^/]+)\/cards$/);
  if (deckCards && method === "POST") {
    const body = await readJson(request);
    const deckId = decodeURIComponent(deckCards[1]);
    return once(db, userId, str(body.idempotencyKey), () => json({ card: addCard(db, userId, { deckId, front: str(body.front), back: str(body.back), label: str(body.label) || "learner_authored" }) }, 201));
  }
  if (pathname === "/api/cards" && method === "GET") {
    return json({ cards: all(db, "SELECT id, deck_id, front, back, due_at FROM cards WHERE user_id = ?", userId) });
  }
  const review = pathname.match(/^\/api\/cards\/([^/]+)\/reviews$/);
  if (review && method === "POST") {
    const body = await readJson(request);
    const cardId = decodeURIComponent(review[1]);
    return once(db, userId, str(body.idempotencyKey), () => json(reviewCard(db, userId, cardId, Number(body.quality), body.revealed === true, body.scoringMethod === "objective" ? "objective" : "self_rated"), 201));
  }
  if (pathname === "/api/labs/projectile" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => {
      let result;
      try {
        result = projectile(Number(body.speed), Number(body.degrees));
      } catch (error) {
        if (error instanceof Error && error.message === "invalid_projectile_input") throw new AppError("invalid_lab_input", "Lab input was rejected.", 400);
        throw error;
      }
      const id = saveLab(db, userId, { lab: result.lab, params: { speed: body.speed, degrees: body.degrees }, result: result.result, assumptions: result.assumptions, courseId: str(body.courseId) || undefined });
      return json({ id, ...result, timedAppointment: false }, 201);
    });
  }
  if (pathname === "/api/labs" && method === "GET") {
    return json({ runs: all(db, "SELECT id, lab, assumptions, created_at FROM lab_runs WHERE user_id = ?", userId) });
  }
  if (pathname === "/api/games/built-in" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => {
      const answers = Array.isArray(body.answers) ? body.answers.map((item) => String(item)) : [];
      const scored = scoreBuiltInGame(answers);
      const id = saveGame(db, userId, scored.score, scored.total);
      return json({ id, ...scored }, 201);
    });
  }
  if (pathname === "/api/games" && method === "GET") {
    return json({ results: all(db, "SELECT id, game, score, total, learning_claim FROM game_results WHERE user_id = ?", userId) });
  }
  if (pathname === "/api/chats" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => json({ id: createChat(db, userId, str(body.title) || "Study question", str(body.courseId) || undefined) }, 201));
  }
  const messages = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (messages && method === "POST") {
    const body = await readJson(request);
    const chatId = decodeURIComponent(messages[1]);
    return once(db, userId, str(body.idempotencyKey), async () => {
    const stored = askTutor(db, userId, chatId, str(body.question), {
      task: "tutoring",
      required: ["text"],
      sensitivity: "unknown",
      audience: "unknown",
      billingTier: "unknown",
      grants: [],
      retention: "strict",
      costMode: "unknown_cost_allowed",
      residency: "unspecified",
      independentCheck: false,
      online: true,
      configuredProviders: [],
    });
    const executed = await executeProvider({ provider: stored.plan.primary?.provider ?? "none", model: stored.plan.primary?.model ?? "none", prompt: str(body.question), signal: request.signal });
    return json({ ...stored, providerTurn: executed });
    });
  }
  if (messages && method === "GET") {
    const chatId = decodeURIComponent(messages[1]);
    const chat = get(db, "SELECT id FROM chats WHERE id = ? AND user_id = ?", chatId, userId);
    if (!chat) return json({ error: "not_found" }, 404);
    return json({ messages: all(db, "SELECT id, role, content, status FROM messages WHERE chat_id = ? AND user_id = ?", chatId, userId) });
  }
  const chatOne = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (chatOne && method === "DELETE") {
    deleteChat(db, userId, decodeURIComponent(chatOne[1]));
    return json({ ok: true });
  }
  if (chatOne && method === "PATCH") {
    const body = await readJson(request);
    renameChat(db, userId, decodeURIComponent(chatOne[1]), str(body.title));
    return json({ ok: true });
  }
  if (pathname === "/api/uploads" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => {
    const bytes = Buffer.from(str(body.dataBase64), "base64");
    const decision = inspectUpload(bytes, str(body.declaredMime) || "text/plain");
    if (!decision.ok) throw new AppError(decision.code, "Upload was rejected.", 400);
    storagePath(userId, decision.id);
    const dir = path.join(process.env.UNIBUD_UPLOAD_DIR || path.join(".data", "uploads"), userId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, decision.id), bytes);
    run(db, "INSERT INTO uploads (id, user_id, course_id, mime, byte_length, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", decision.id, userId, str(body.courseId) || null, decision.mime, decision.byteLength, decision.sha256, nowIso());
    if (decision.mime.startsWith("text/") && str(body.courseId)) addSource(db, userId, { courseId: str(body.courseId), title: str(body.filename) || decision.id, body: new TextDecoder().decode(bytes), kind: "upload" });
    return json({ id: decision.id, mime: decision.mime, byteLength: decision.byteLength, storage: "private" }, 201);
    });
  }
  const upload = pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (upload && method === "GET") {
    const id = decodeURIComponent(upload[1]);
    const row = get<{ mime: string }>(db, "SELECT mime FROM uploads WHERE id = ? AND user_id = ?", id, userId);
    if (!row) return json({ error: "not_found" }, 404);
    const file = path.join(process.env.UNIBUD_UPLOAD_DIR || path.join(".data", "uploads"), userId, id);
    const bytes = readFileSync(file);
    return new Response(bytes, { status: 200, headers: { "content-type": row.mime, "cache-control": "private, no-store" } });
  }
  if (pathname === "/api/graph" && method === "GET") {
    return json({ nodes: all(db, "SELECT id, label, topic_id FROM graph_nodes WHERE user_id = ?", userId), edges: all(db, "SELECT id, from_id, to_id, origin, academic_verification FROM graph_edges WHERE user_id = ?", userId) });
  }
  if (pathname === "/api/graph/nodes" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => json({ id: addGraphNode(db, userId, str(body.label), str(body.topicId) || undefined) }, 201));
  }
  if (pathname === "/api/graph/edges" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => json({ id: addGraphEdge(db, userId, str(body.fromId), str(body.toId), body.origin === "inferred" ? "inferred" : "learner") }, 201));
  }
  if (pathname === "/api/lens" && method === "POST") {
    const body = await readJson(request);
    const decision = lensDecision({
      mode: body.mode === "image" ? "image" : "text",
      consent: body.consent === true,
      route: { task: "images", required: ["image"], sensitivity: "unknown", audience: "unknown", billingTier: "unknown", grants: [], retention: "strict", costMode: "known_cost_only", residency: "unspecified", independentCheck: false, online: true, configuredProviders: [] },
    });
    return json(decision);
  }
  if (pathname === "/api/device/notes" && method === "GET") {
    return json({ records: new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device").read(userId), syncClaim: "saved_on_device_until_acked" });
  }
  if (pathname === "/api/device/notes" && method === "POST") {
    const body = await readJson(request);
    const store = new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device");
    store.save(userId, { entity: "note", id: str(body.artifactId), body: body.body, baseRev: Number(body.rev ?? 0), syncState: "saved_on_device" });
    return json({ syncState: "saved_on_device" }, 201);
  }
  const sync = pathname.match(/^\/api\/device\/notes\/([^/]+)\/sync$/);
  if (sync && method === "POST") {
    const body = await readJson(request);
    const result = applyArtifactUpdate(db, userId, decodeURIComponent(sync[1]), Number(body.rev), str(body.body), str(body.idempotencyKey) || newId());
    const store = new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device");
    if (result.status === "acked" && "rev" in result) {
      store.applyAck(userId, decodeURIComponent(sync[1]), { status: "acked", rev: result.rev ?? Number(body.rev) + 1, body: str(body.body) });
      return json({ status: "acked", rev: result.rev, syncState: "synced" });
    }
    if ("server" in result) {
      store.applyConflict(userId, decodeURIComponent(sync[1]), result.server, str(body.body));
      return json({ status: "conflict", server: result.server, clientBody: str(body.body), syncState: "conflict" }, 409);
    }
    return json({ status: result.status }, 409);
  }
  if (pathname === "/api/sessions" && method === "POST") {
    const body = await readJson(request);
    return once(db, userId, str(body.idempotencyKey), () => json({ id: startSession(db, userId, { courseId: str(body.courseId) || undefined, kind: str(body.kind) || "study" }) }, 201));
  }
  const pause = pathname.match(/^\/api\/sessions\/([^/]+)\/pause$/);
  if (pause && method === "POST") {
    const body = await readJson(request);
    pauseSession(db, userId, decodeURIComponent(pause[1]), Number(body.pausedMs ?? 0));
    return json({ ok: true });
  }
  const complete = pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (complete && method === "POST") {
    return json(completeSession(db, userId, decodeURIComponent(complete[1])));
  }
  const labOne = pathname.match(/^\/api\/labs\/([^/]+)$/);
  if (labOne && method === "GET") {
    const row = get(db, "SELECT id, lab, assumptions, created_at FROM lab_runs WHERE id = ? AND user_id = ?", decodeURIComponent(labOne[1]), userId);
    if (!row) return json({ error: "not_found" }, 404);
    return json({ run: row });
  }
  const gameOne = pathname.match(/^\/api\/games\/([^/]+)$/);
  if (gameOne && method === "GET") {
    const row = get(db, "SELECT id, game, score, total, learning_claim FROM game_results WHERE id = ? AND user_id = ?", decodeURIComponent(gameOne[1]), userId);
    if (!row) return json({ error: "not_found" }, 404);
    return json({ result: row });
  }
  const nodeOne = pathname.match(/^\/api\/graph\/nodes\/([^/]+)$/);
  if (nodeOne && method === "GET") {
    const row = get(db, "SELECT id, label, topic_id FROM graph_nodes WHERE id = ? AND user_id = ?", decodeURIComponent(nodeOne[1]), userId);
    if (!row) return json({ error: "not_found" }, 404);
    return json({ node: row });
  }
  const deviceOne = pathname.match(/^\/api\/device\/notes\/([^/]+)$/);
  if (deviceOne && method === "GET") {
    const record = new DeviceStore(process.env.UNIBUD_DEVICE_DIR || ".data/device").read(userId).find((item) => item.id === decodeURIComponent(deviceOne[1]));
    if (!record) return json({ error: "not_found" }, 404);
    return json({ record });
  }
  const sessionOne = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionOne && method === "GET") {
    const row = get(db, "SELECT id, status, kind, started_at FROM study_sessions WHERE id = ? AND user_id = ?", decodeURIComponent(sessionOne[1]), userId);
    if (!row) return json({ error: "not_found" }, 404);
    return json({ session: row });
  }
  return json({ error: "not_found" }, 404);
}
