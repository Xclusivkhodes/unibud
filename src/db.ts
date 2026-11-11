import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type Db = DatabaseSync;

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schema);
  migrateProfiles(db);
  return db;
}

function migrateProfiles(db: DatabaseSync): void {
  const names = new Set((db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("age_band")) db.exec("ALTER TABLE profiles ADD COLUMN age_band TEXT");
  if (!names.has("parent_contact_verified")) db.exec("ALTER TABLE profiles ADD COLUMN parent_contact_verified INTEGER NOT NULL DEFAULT 0");
  if (!names.has("dev_mailbox_simulated_at")) db.exec("ALTER TABLE profiles ADD COLUMN dev_mailbox_simulated_at TEXT");
}

function bind(params: unknown[]): SQLInputValue[] {
  return params as SQLInputValue[];
}

export function all<T>(db: Db, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...bind(params)) as T[];
}

export function get<T>(db: Db, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...bind(params)) as T | undefined;
}

export function run(db: Db, sql: string, ...params: unknown[]): { changes: number } {
  const result = db.prepare(sql).run(...bind(params)) as { changes?: number | bigint };
  return { changes: Number(result.changes ?? 0) };
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
