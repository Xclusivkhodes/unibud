import { AppError } from "../security/crypto.js";

const ALLOWED_HTTPS_HOSTS = new Set([
  "www.googleapis.com",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.x.ai",
]);

export function classifyOutboundUrl(raw: string): { kind: "allowlisted" | "loopback"; href: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("ssrf_rejected", "URL was rejected.");
  }
  if (url.username || url.password) throw new AppError("ssrf_rejected", "URL was rejected.");
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
    return { kind: "loopback", href: url.href };
  }
  if (url.protocol === "https:" && ALLOWED_HTTPS_HOSTS.has(url.hostname)) {
    return { kind: "allowlisted", href: url.href };
  }
  throw new AppError("ssrf_rejected", "URL was rejected.");
}

export function assertThumbnailUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "i.ytimg.com" && url.hostname !== "yt3.ggpht.com") return null;
  return url.href;
}
