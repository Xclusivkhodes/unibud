import { openDatabase, type Db } from "../db.js";
import { databasePath } from "./paths.js";

let database: Db | null = null;
let openedPath: string | null = null;

export function getAppDb(): Db {
  const path = databasePath();
  if (!database || openedPath !== path) {
    database = openDatabase(path);
    openedPath = path;
  }
  return database;
}
