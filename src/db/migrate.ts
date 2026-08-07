import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SqliteDatabase } from "./connection.js";

export interface Migration {
  version: number;
  filename: string;
  sql: string;
}

export interface MigrationResult {
  previousVersion: number;
  currentVersion: number;
  applied: string[];
}

const MIGRATION_NAME = /^(\d+)[_-].+\.sql$/;

export function loadMigrations(
  migrationsDirectory = path.resolve("migrations"),
): Migration[] {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_NAME.test(entry.name))
    .map((entry) => {
      const match = MIGRATION_NAME.exec(entry.name);
      if (!match) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }

      return {
        version: Number.parseInt(match[1], 10),
        filename: entry.name,
        sql: readFileSync(path.join(migrationsDirectory, entry.name), "utf8"),
      };
    })
    .sort((left, right) => left.version - right.version);

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(
        `Duplicate migration version ${migrations[index].version}: ` +
          `${migrations[index - 1].filename}, ${migrations[index].filename}`,
      );
    }
  }

  return migrations;
}

export function migrateDatabase(
  database: SqliteDatabase,
  migrationsDirectory = path.resolve("migrations"),
): MigrationResult {
  const migrations = loadMigrations(migrationsDirectory);
  const previousVersion = database.pragma("user_version", { simple: true }) as number;
  const latestVersion = migrations.at(-1)?.version ?? 0;

  if (previousVersion > latestVersion) {
    throw new Error(
      `Database schema version ${previousVersion} is newer than the latest available migration ${latestVersion}.`,
    );
  }

  const pending = migrations.filter((migration) => migration.version > previousVersion);
  for (const migration of pending) {
    database.transaction(() => {
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }

  return {
    previousVersion,
    currentVersion: pending.at(-1)?.version ?? previousVersion,
    applied: pending.map((migration) => migration.filename),
  };
}
