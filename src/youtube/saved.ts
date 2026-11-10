import { all, get, run, type Db } from "../db.js";
import { newId, nowIso } from "../security/crypto.js";
import { auditYouTubeUrl, buildPlaylistListUrl, buildVideosListUrl, cacheFresh, youtubeApiKey, type MockFetch } from "./api.js";

export type SavedYouTube = { id: string; kind: "video" | "playlist"; resourceId: string; note: string };

export type YouTubeMetadata = { kind: "video" | "playlist"; resourceId: string; title: string | null; channel: string | null; thumbnailUrl: string | null; fetchedAt: string };

type MetadataRow = { title: string | null; channel: string | null; thumbnail_url: string | null; fetched_at: string };

export function saveYouTubeItem(db: Db, userId: string, input: { kind: "video" | "playlist"; resourceId: string; note?: string }): SavedYouTube {
  const resourceId = input.resourceId.trim();
  if (!resourceId) throw new Error("resource_id_required");
  const id = newId();
  const note = input.note ?? "";
  run(db, "INSERT INTO youtube_saved (id, user_id, kind, resource_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, input.kind, resourceId, note, nowIso());
  return { id, kind: input.kind, resourceId, note };
}

export function listSavedYouTube(db: Db, userId: string): SavedYouTube[] {
  return all<{ id: string; kind: "video" | "playlist"; resource_id: string; note: string }>(db, "SELECT id, kind, resource_id, note FROM youtube_saved WHERE user_id = ? ORDER BY created_at", userId).map((row) => ({
    id: row.id,
    kind: row.kind,
    resourceId: row.resource_id,
    note: row.note,
  }));
}

export function writeYouTubeMetadata(db: Db, input: { kind: "video" | "playlist"; resourceId: string; title: string | null; channel: string | null; thumbnailUrl: string | null; fetchedAt: string }): void {
  run(
    db,
    `INSERT INTO youtube_metadata (kind, resource_id, title, channel, thumbnail_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, resource_id) DO UPDATE SET title = excluded.title, channel = excluded.channel, thumbnail_url = excluded.thumbnail_url, fetched_at = excluded.fetched_at`,
    input.kind,
    input.resourceId,
    input.title,
    input.channel,
    input.thumbnailUrl,
    input.fetchedAt,
  );
}

/** Fresh snapshots only. A stale row is excluded and is not returned. */
export function readFreshYouTubeMetadata(db: Db, kind: "video" | "playlist", resourceId: string, now: string): YouTubeMetadata | null {
  const row = get<MetadataRow>(db, "SELECT title, channel, thumbnail_url, fetched_at FROM youtube_metadata WHERE kind = ? AND resource_id = ?", kind, resourceId);
  if (!row || !cacheFresh(row.fetched_at, now)) return null;
  return { kind, resourceId, title: row.title, channel: row.channel, thumbnailUrl: row.thumbnail_url, fetchedAt: row.fetched_at };
}

export function purgeExpiredYouTubeMetadata(db: Db, now: string): number {
  const rows = all<{ kind: string; resource_id: string; fetched_at: string }>(db, "SELECT kind, resource_id, fetched_at FROM youtube_metadata");
  let removed = 0;
  for (const row of rows) {
    if (!cacheFresh(row.fetched_at, now)) {
      run(db, "DELETE FROM youtube_metadata WHERE kind = ? AND resource_id = ?", row.kind, row.resource_id);
      removed += 1;
    }
  }
  return removed;
}

export type DisplayState = "fresh" | "refreshed" | "unconfigured" | "not_executed";

/**
 * Serves a saved id and note permanently. Metadata older than 30 days is not served.
 * A refresh uses the injected transport only. Pending a final YouTube policy-text check before launch.
 */
export async function displaySavedYouTube(db: Db, userId: string, savedId: string, now: string, transport?: MockFetch): Promise<{
  saved: SavedYouTube;
  metadata: YouTubeMetadata | null;
  metadataState: DisplayState;
  requested: string[];
}> {
  const row = get<{ id: string; kind: "video" | "playlist"; resource_id: string; note: string }>(db, "SELECT id, kind, resource_id, note FROM youtube_saved WHERE id = ? AND user_id = ?", savedId, userId);
  if (!row) throw new Error("not_found");
  const saved = { id: row.id, kind: row.kind, resourceId: row.resource_id, note: row.note };
  const fresh = readFreshYouTubeMetadata(db, saved.kind, saved.resourceId, now);
  if (fresh) return { saved, metadata: fresh, metadataState: "fresh", requested: [] };
  const apiKey = youtubeApiKey();
  if (!apiKey) return { saved, metadata: null, metadataState: "unconfigured", requested: [] };
  if (!transport) return { saved, metadata: null, metadataState: "not_executed", requested: [] };
  const url = saved.kind === "video" ? buildVideosListUrl([saved.resourceId], apiKey) : buildPlaylistListUrl(saved.resourceId, apiKey);
  const response = await transport(url.toString(), { redirect: "error" });
  const payload = (await response.json()) as { items?: Array<Record<string, unknown>> };
  const item = payload.items?.[0];
  const snippet = (item?.snippet ?? {}) as Record<string, unknown>;
  const thumbs = snippet.thumbnails as Record<string, { url?: string }> | undefined;
  const scrub = (value: string | null) => (value && apiKey.length >= 8 && value.includes(apiKey) ? value.split(apiKey).join("[redacted]") : value);
  const metadata = {
    kind: saved.kind,
    resourceId: saved.resourceId,
    title: scrub(typeof snippet.title === "string" ? snippet.title : null),
    channel: scrub(typeof snippet.channelTitle === "string" ? snippet.channelTitle : null),
    thumbnailUrl: scrub(thumbs?.medium?.url ?? thumbs?.default?.url ?? null),
    fetchedAt: now,
  };
  writeYouTubeMetadata(db, metadata);
  return { saved, metadata, metadataState: "refreshed", requested: [auditYouTubeUrl(url.toString())] };
}
