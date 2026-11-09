import { openDatabase, type Db } from "../db.js";

let database: Db | null = null;
let openedPath: string | null = null;

export function getAppDb(): Db {
  const path = process.env.UNIBUD_DB_PATH || ".data/unibud.sqlite";
  if (!database || openedPath !== path) {
    database = openDatabase(path);
    openedPath = path;
  }
  return database;
}
