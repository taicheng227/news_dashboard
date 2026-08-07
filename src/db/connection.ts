import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  readonlyPath?: boolean;
  fileMustExist?: boolean;
}

export function resolveDatabasePath(databasePath = process.env.DATABASE_PATH): string {
  return path.resolve(databasePath ?? "./data/ai-radar.sqlite");
}

export function openDatabase(
  databasePath = resolveDatabasePath(),
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  const resolvedPath = path.resolve(databasePath);

  if (!options.readonlyPath) {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const database = new Database(resolvedPath, {
    readonly: options.readonlyPath ?? false,
    fileMustExist: options.fileMustExist ?? false,
  });

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (!options.readonlyPath) {
    database.pragma("journal_mode = WAL");
  }

  return database;
}

export function closeDatabase(database: SqliteDatabase): void {
  if (database.open) {
    database.close();
  }
}
