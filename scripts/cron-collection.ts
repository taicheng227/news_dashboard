import { runRemoteCollection } from "./lib/internal-api.js";

try {
  const run = await runRemoteCollection();
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: run.status === "FAILED" ? "error" : "info",
      operation: "collection-trigger",
      runId: run.id,
      message: `Collection completed with status ${run.status}`,
    }),
  );
  if (run.status === "FAILED") process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      operation: "collection-trigger",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
