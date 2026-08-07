import { runRemoteCollection } from "./lib/internal-api.js";

try {
  const run = await runRemoteCollection();
  console.log(JSON.stringify(run, null, 2));
  if (run.status === "FAILED") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
