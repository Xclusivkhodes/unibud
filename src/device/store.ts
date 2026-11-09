import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export type SyncState = "saved_on_device" | "pending_ack" | "synced" | "conflict";

export type DeviceRecord = {
  entity: "course" | "note" | "deck" | "attempt";
  id: string;
  body: unknown;
  baseRev: number | null;
  syncState: SyncState;
  serverBody?: unknown;
};

type FileShape = { userId: string; records: DeviceRecord[] };

export class DeviceStore {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }

  private file(userId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(userId)) throw new Error("invalid_user");
    return path.join(this.root, `${userId}.json`);
  }

  read(userId: string): DeviceRecord[] {
    const file = this.file(userId);
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    return parsed.records;
  }

  save(userId: string, record: DeviceRecord): void {
    const records = this.read(userId).filter((item) => item.id !== record.id);
    records.push({ ...record, syncState: record.syncState === "synced" ? "synced" : "saved_on_device" });
    this.write(userId, records);
  }

  queue(userId: string, id: string, body: unknown): DeviceRecord {
    const current = this.read(userId).find((item) => item.id === id);
    if (!current) throw new Error("missing_device_record");
    const next = { ...current, body, syncState: "pending_ack" as const };
    this.write(userId, this.read(userId).map((item) => (item.id === id ? next : item)));
    return next;
  }

  applyAck(userId: string, id: string, ack: { status: "acked"; rev: number; body: unknown }): void {
    if (ack.status !== "acked") throw new Error("missing_ack");
    const next = this.read(userId).map((item) =>
      item.id === id ? { ...item, body: ack.body, baseRev: ack.rev, syncState: "synced" as const, serverBody: undefined } : item,
    );
    this.write(userId, next);
  }

  applyConflict(userId: string, id: string, serverBody: unknown, localBody: unknown): void {
    const next = this.read(userId).map((item) =>
      item.id === id ? { ...item, syncState: "conflict" as const, serverBody, body: localBody } : item,
    );
    this.write(userId, next);
  }

  clear(userId: string): void {
    const file = this.file(userId);
    if (existsSync(file)) rmSync(file);
  }

  private write(userId: string, records: DeviceRecord[]): void {
    const payload: FileShape = { userId, records };
    writeFileSync(this.file(userId), JSON.stringify(payload));
  }
}
