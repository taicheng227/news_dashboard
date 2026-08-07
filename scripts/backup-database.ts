import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import { closeDatabase, openDatabase, resolveDatabasePath } from "../src/db/connection.js";

function parseRetention(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "7", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("AI_RADAR_BACKUP_RETENTION must be a positive integer.");
  }
  return parsed;
}

function backupFilename(now = new Date()): string {
  return `ai-radar-${now.toISOString().replaceAll(":", "-")}.sqlite`;
}

async function main(): Promise<void> {
  const databasePath = resolveDatabasePath();
  const backupDirectory = path.resolve(
    process.env.AI_RADAR_BACKUP_DIR ?? path.join(path.dirname(databasePath), "manual-backups"),
  );
  const retention = parseRetention(process.env.AI_RADAR_BACKUP_RETENTION);
  mkdirSync(backupDirectory, { recursive: true });

  const destination = path.join(backupDirectory, backupFilename());
  const database = openDatabase(databasePath, { fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    closeDatabase(database);
  }

  const backups = readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^ai-radar-.+\.sqlite$/.test(entry.name))
    .map((entry) => {
      const absolutePath = path.resolve(backupDirectory, entry.name);
      if (path.dirname(absolutePath) !== backupDirectory) {
        throw new Error(`Refusing to inspect backup outside ${backupDirectory}`);
      }
      return { absolutePath, modifiedAt: statSync(absolutePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const expired of backups.slice(retention)) {
    unlinkSync(expired.absolutePath);
  }

  console.log(`Created SQLite online backup: ${destination}`);
  console.log(`Retained ${Math.min(backups.length, retention)} manual backup(s).`);
}

await main();
