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
  return db;
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
