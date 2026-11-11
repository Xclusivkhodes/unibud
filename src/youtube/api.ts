import { redact } from "../security/redact.js";
import { assertThumbnailUrl } from "../security/ssrf.js";

/**
 * Quota figures are taken from UB-RES-02's inspection of
 * https://developers.google.com/youtube/v3/determine_quota_cost (Y1, visible update 2026-11-03).
 * This run's direct fetch of that page timed out, so these are not a re-verified live project quota.
 * search.list is its own bucket. The historical "100 units from the general 10,000" default is not used.
 */
export const YOUTUBE_QUOTA = {
  searchList: { bucket: "search.list", documentedDailyCalls: 100, unitCost: 1, source: "UB-RES-02 Y1" },
  generalDailyUnits: { documentedDefault: 10000, source: "UB-RES-02 Y1" },
  videosListUnits: 1,
  playlistsListUnits: 1,
  playlistItemsListUnits: 1,
  captionsDownloadUnits: 200,
  reFetchedThisRun: false,
  liveProjectLimit: "unknown",
} as const;

export const CACHE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function cacheFresh(fetchedAt: string, now: string): boolean {
  return new Date(now).getTime() - new Date(fetchedAt).getTime() < CACHE_MAX_MS;
}

export function watchUrl(videoId: string): string | null {
  if (!VIDEO_ID.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export type VideoCard = {
  videoId: string;
  title: string | null;
  channel: string | null;
  url: string;
  thumbnailUrl: string | null;
  duration: string | null;
  textLanguage: string | null;
  audioLanguage: string | null;
  embeddable: boolean | null;
  evidence: "youtube_metadata";
  watched: false;
  suitability: null;
  qualityScore: null;
};

export function cardFromParts(searchItem: Record<string, unknown>, videoItem: Record<string, unknown> | null): VideoCard | null {
  const id = (searchItem.id as { videoId?: string } | undefined)?.videoId;
  if (!id || !watchUrl(id)) return null;
  const searchSnippet = (searchItem.snippet ?? {}) as Record<string, unknown>;
  const videoSnippet = (videoItem?.snippet ?? searchSnippet) as Record<string, unknown>;
  const thumbs = videoSnippet.thumbnails as Record<string, { url?: string }> | undefined;
  const thumb = assertThumbnailUrl(thumbs?.medium?.url ?? thumbs?.default?.url ?? null);
  const content = (videoItem?.contentDetails ?? {}) as { duration?: string };
  const status = (videoItem?.status ?? {}) as { embeddable?: boolean };
  return {
    videoId: id,
    title: typeof videoSnippet.title === "string" ? videoSnippet.title : null,
    channel: typeof videoSnippet.channelTitle === "string" ? videoSnippet.channelTitle : null,
    url: watchUrl(id) as string,
    thumbnailUrl: thumb,
    duration: typeof content.duration === "string" ? content.duration : null,
    textLanguage: typeof videoSnippet.defaultLanguage === "string" ? videoSnippet.defaultLanguage : null,
    audioLanguage: typeof videoSnippet.defaultAudioLanguage === "string" ? videoSnippet.defaultAudioLanguage : null,
    embeddable: typeof status.embeddable === "boolean" ? status.embeddable : null,
    evidence: "youtube_metadata",
    watched: false,
    suitability: null,
    qualityScore: null,
  };
}

export function playlistView(playlist: { contentDetails?: { itemCount?: number } }, items: Array<{ contentDetails?: { videoId?: string } }>) {
  return {
    itemCount: playlist.contentDetails?.itemCount ?? null,
    publisherOrder: items.map((item) => item.contentDetails?.videoId).filter((id): id is string => Boolean(id)),
    aggregateDuration: "not_computed_policy_blocked" as const,
    qualityScore: "not_computed_policy_blocked" as const,
    pedagogicalOrder: "not_inferred_from_playlist" as const,
  };
}

export function quotaForSearchAndHydrate(): { searchBucketCalls: number; generalUnits: number } {
  return { searchBucketCalls: YOUTUBE_QUOTA.searchList.unitCost, generalUnits: YOUTUBE_QUOTA.videosListUnits };
}

export function captionDownloadStatus(): { available: false; reason: string; units: number } {
  return {
    available: false,
    reason: "captions.download requires OAuth and permission to edit the video; not granted in this build",
    units: YOUTUBE_QUOTA.captionsDownloadUnits,
  };
}

export type SearchResult =
  | { status: "unconfigured" }
  | { status: "offline" }
  | { status: "not_executed"; reason: "live_youtube_call_not_authorized" }
  | { status: "ok"; cards: VideoCard[]; quota: ReturnType<typeof quotaForSearchAndHydrate>; fixture: boolean };

export function buildSearchListUrl(query: string, apiKey: string): URL {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", query);
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("key", apiKey);
  return url;
}

export function buildVideosListUrl(ids: string[], apiKey: string): URL {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,status");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", apiKey);
  return url;
}

export function buildPlaylistListUrl(playlistId: string, apiKey: string): URL {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", playlistId);
  url.searchParams.set("key", apiKey);
  return url;
}

export function buildPlaylistItemsUrl(playlistId: string, apiKey: string, pageToken?: string): URL {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  url.searchParams.set("key", apiKey);
  return url;
}

export type MockFetch = (url: string, init: { redirect: "error" }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Audit copy of an outbound URL. The transport still receives the official `key` query. */
export function auditYouTubeUrl(url: string): string {
  return redact(url);
}

function scrubSecret(value: string | null, secret: string): string | null {
  if (!value || secret.length < 8 || !value.includes(secret)) return value;
  return value.split(secret).join("[redacted]");
}

function scrubCard(card: VideoCard, secret: string): VideoCard {
  return {
    ...card,
    title: scrubSecret(card.title, secret),
    channel: scrubSecret(card.channel, secret),
    url: scrubSecret(card.url, secret) ?? card.url,
    thumbnailUrl: scrubSecret(card.thumbnailUrl, secret),
  };
}

export async function runMockedSearch(options: { apiKey: string; query: string; fetchImpl: MockFetch }): Promise<SearchResult & { requested: string[] }> {
  const outbound: string[] = [];
  const searchUrl = buildSearchListUrl(options.query, options.apiKey);
  outbound.push(searchUrl.toString());
  const searchResponse = await options.fetchImpl(searchUrl.toString(), { redirect: "error" });
  const search = (await searchResponse.json()) as { items?: Record<string, unknown>[] };
  const ids = (search.items ?? []).map((item) => (item.id as { videoId?: string } | undefined)?.videoId).filter((id): id is string => Boolean(id));
  const videosUrl = buildVideosListUrl(ids, options.apiKey);
  outbound.push(videosUrl.toString());
  const videosResponse = await options.fetchImpl(videosUrl.toString(), { redirect: "error" });
  const videos = (await videosResponse.json()) as { items?: Record<string, unknown>[] };
  const byId = new Map((videos.items ?? []).map((video) => [String(video.id), video]));
  const cards = (search.items ?? [])
    .map((item) => cardFromParts(item, byId.get(String((item.id as { videoId?: string }).videoId)) ?? null))
    .filter((card): card is VideoCard => card !== null)
    .map((card) => scrubCard(card, options.apiKey));
  return { status: "ok", cards, quota: quotaForSearchAndHydrate(), fixture: true, requested: outbound.map(auditYouTubeUrl) };
}

export async function runMockedPlaylist(options: { apiKey: string; playlistId: string; fetchImpl: MockFetch }): Promise<ReturnType<typeof playlistView> & { requested: string[] }> {
  const outbound = [buildPlaylistListUrl(options.playlistId, options.apiKey).toString(), buildPlaylistItemsUrl(options.playlistId, options.apiKey).toString()];
  const playlistResponse = await options.fetchImpl(outbound[0], { redirect: "error" });
  const playlistJson = (await playlistResponse.json()) as { items?: Array<{ contentDetails?: { itemCount?: number } }> };
  const itemsResponse = await options.fetchImpl(outbound[1], { redirect: "error" });
  const itemsJson = (await itemsResponse.json()) as { items?: Array<{ contentDetails?: { videoId?: string } }> };
  return { ...playlistView(playlistJson.items?.[0] ?? {}, itemsJson.items ?? []), requested: outbound.map(auditYouTubeUrl) };
}

export function youtubeApiKey(): string | undefined {
  const value = process.env.YOUTUBE_API_KEY?.trim();
  return value ? value : undefined;
}

/** Server entry. Reads YOUTUBE_API_KEY from the environment and never returns that value. */
export async function searchFromServerEnv(options: {
  query: string;
  online?: boolean;
  transport?: MockFetch;
}): Promise<SearchResult & { requested?: string[] }> {
  if (options.online === false) return { status: "offline" };
  const apiKey = youtubeApiKey();
  if (!apiKey) return { status: "unconfigured" };
  if (!options.transport) return { status: "not_executed", reason: "live_youtube_call_not_authorized" };
  return runMockedSearch({ apiKey, query: options.query, fetchImpl: options.transport });
}

export async function searchVideos(options: {
  apiKey: string | undefined;
  online: boolean;
  allowNetwork: boolean;
  fixture?: { search: Record<string, unknown>; videos: Record<string, unknown>[] };
}): Promise<SearchResult> {
  if (!options.online) return { status: "offline" };
  if (!options.apiKey) return { status: "unconfigured" };
  if (!options.allowNetwork || !options.fixture) {
    return { status: "not_executed", reason: "live_youtube_call_not_authorized" };
  }
  const items = ((options.fixture.search.items as Record<string, unknown>[]) ?? []);
  const byId = new Map(options.fixture.videos.map((video) => [String(video.id), video]));
  const cards = items
    .map((item) => cardFromParts(item, byId.get(String((item.id as { videoId?: string }).videoId)) ?? null))
    .filter((card): card is VideoCard => card !== null)
    .map((card) => scrubCard(card, options.apiKey ?? ""));
  return { status: "ok", cards, quota: quotaForSearchAndHydrate(), fixture: true };
}
