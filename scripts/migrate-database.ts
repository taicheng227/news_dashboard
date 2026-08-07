import { closeDatabase, openDatabase, resolveDatabasePath } from "../src/db/connection.js";
import { migrateDatabase } from "../src/db/migrate.js";

const databasePath = resolveDatabasePath();
const database = openDatabase(databasePath);

try {
  const result = migrateDatabase(database);
  if (result.applied.length === 0) {
    console.log(`Database is already at schema version ${result.currentVersion}: ${databasePath}`);
  } else {
    console.log(
      `Migrated ${databasePath} from version ${result.previousVersion} to ${result.currentVersion}: ` +
        result.applied.join(", "),
    );
  }
} finally {
  closeDatabase(database);
}
