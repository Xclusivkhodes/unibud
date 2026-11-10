export type LedgerImpl = "tested" | "partial" | "not_implemented" | "blocked";

export const OFFLINE_LEDGER: Array<{ id: string; impl: LedgerImpl; behavior: string }> = [
  { id: "server-account-persistence", impl: "tested", behavior: "SQLite account data survives reopen of the same file." },
  { id: "device-file-note-reload", impl: "tested", behavior: "File-backed device store reloads notes and keeps saved_on_device until ack." },
  { id: "sync-ack-required", impl: "tested", behavior: "Synced is set only by applyAck." },
  { id: "conflict-preserves-both", impl: "tested", behavior: "Revision mismatch returns server and client bodies." },
  { id: "account-switch-clears-device", impl: "tested", behavior: "clear(user) removes that user's device file." },
  { id: "offline-ai", impl: "tested", behavior: "Provider routing returns offline_provider_unavailable and does not invent an answer." },
  { id: "offline-youtube-search", impl: "tested", behavior: "Search returns offline. No media download." },
  { id: "deterministic-lab-without-network", impl: "tested", behavior: "Pure lab functions do not use the network." },
  { id: "study-circle-share", impl: "tested", behavior: "Sharing is server-acked membership, not a local click." },
  { id: "browser-service-worker", impl: "not_implemented", behavior: "No service worker during the UI hold." },
  { id: "browser-reload-offline", impl: "not_implemented", behavior: "No browser offline reload test. Required scope remains outstanding." },
];
