import { collectSources } from "../src/collection/collect.js";
import {
  closeDatabase,
  openDatabase,
  resolveDatabasePath,
} from "../src/db/connection.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { RadarRepository } from "../src/db/repositories.js";

function optionValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

const databasePath = resolveDatabasePath();
const database = openDatabase(databasePath);
try {
  migrateDatabase(database);
  const repository = new RadarRepository(database);
  const sourceSlugs = optionValues("--source");
  const summary = await collectSources(repository, {
    trigger: "MANUAL",
    sourceSlugs: sourceSlugs.length ? sourceSlugs : undefined,
  });
  console.log(JSON.stringify({ databasePath, ...summary }, null, 2));
  if (summary.status === "FAILED") process.exitCode = 1;
} finally {
  closeDatabase(database);
}

