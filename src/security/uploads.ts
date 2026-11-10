import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../security/crypto.js";

const MAX_BYTES = 1_000_000;

export type UploadDecision =
  | { ok: true; id: string; mime: "text/plain" | "text/markdown" | "image/jpeg" | "image/png" | "image/webp"; byteLength: number; sha256: string }
  | { ok: false; code: string };

export function inspectUpload(bytes: Uint8Array, declaredMime: string): UploadDecision {
  if (bytes.byteLength === 0) return { ok: false, code: "empty_upload" };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, code: "upload_too_large" };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { ok: false, code: "compressed_not_accepted" };
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { ok: false, code: "compressed_not_accepted" };
  const mime = sniff(bytes, declaredMime);
  if (!mime) return { ok: false, code: "mime_rejected" };
  return {
    ok: true,
    id: randomBytes(16).toString("hex"),
    mime,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sniff(
  bytes: Uint8Array,
  declaredMime: string,
): "text/plain" | "text/markdown" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && declaredMime === "image/jpeg") return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && declaredMime === "image/png") return "image/png";
  if (
    bytes.byteLength > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    declaredMime === "image/webp"
  ) {
    return "image/webp";
  }
  if (declaredMime !== "text/plain" && declaredMime !== "text/markdown") return null;
  for (const byte of bytes) {
    if (byte === 0) return null;
  }
  return declaredMime;
}

export function storagePath(userId: string, uploadId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(userId) || !/^[a-f0-9]+$/.test(uploadId)) {
    throw new AppError("invalid_storage_id", "Storage id was rejected.");
  }
  return `${userId}/${uploadId}`;
}
