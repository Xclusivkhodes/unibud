import path from "node:path";

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** SQLite file. Unset env resolves under the ignored `.data/` directory. */
export function databasePath(): string {
  return envOrDefault("UNIBUD_DB_PATH", path.join(".data", "unibud.sqlite"));
}

/** Upload root. Unset env resolves under the ignored `.data/` directory. */
export function uploadRoot(): string {
  return envOrDefault("UNIBUD_UPLOAD_DIR", path.join(".data", "uploads"));
}

/** Device-note JSON directory. Unset env resolves under the ignored `.data/` directory. */
export function deviceRoot(): string {
  return envOrDefault("UNIBUD_DEVICE_DIR", path.join(".data", "device"));
}
