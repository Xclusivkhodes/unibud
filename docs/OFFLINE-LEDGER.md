# Offline ledger

Authoritative ids live in `src/device/ledger.ts`.

| Id | State |
|---|---|
| server-account-persistence | Tested with a reopened SQLite file only inside one process. A second process reopen is not separately tested. |
| device-file-note-reload | Tested. Label remains `saved_on_device` until `applyAck`. |
| sync-ack-required | Tested. |
| conflict-preserves-both | Tested. |
| account-switch-clears-device | Tested via `clear`. |
| offline-ai | Tested denial. |
| offline-youtube-search | Tested denial. No video file is stored. |
| deterministic-lab-without-network | Pure functions. |
| study-circle-share | Server ack required. `stageLocalPost` is not success. |
| browser-service-worker | Not implemented. |
| browser-reload-offline | Not implemented. Required scope remains outstanding. |

Supported offline actions in this library: read and edit a device-file copy of a note, queue it, and reconcile through an explicit ack or conflict. Account data and Study Circle membership are server records. AI and YouTube search are online-only.
