import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const compiledScript = path.resolve("dist/scripts/backup-database.js");
const sourceScript = path.resolve("scripts/backup-database.ts");
const production = process.env.NODE_ENV === "production";
if (production && !existsSync(compiledScript)) {
  throw new Error(`Compiled backup script is missing: ${compiledScript}`);
}
const args = production
  ? [compiledScript]
  : ["--import", "tsx", sourceScript];
const result = spawnSync(process.execPath, args, {
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
