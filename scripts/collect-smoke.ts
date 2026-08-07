import { SOURCES } from "../config/sources.js";
import { createAdapterRegistry, getSourceAdapter } from "../src/sources/registry.js";

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

const requested = optionValues("--source");
const requestedSet = requested.length ? new Set(requested) : null;
const discoveryOnly = process.argv.includes("--discovery-only");
const sources = SOURCES.filter(
  (source) => source.enabled && (!requestedSet || requestedSet.has(source.slug)),
);

if (requestedSet) {
  const unknown = [...requestedSet].filter(
    (slug) => !SOURCES.some((source) => source.slug === slug),
  );
  if (unknown.length) {
    console.error(`Unknown source slug(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
}

const adapters = createAdapterRegistry();
let failures = 0;
for (const source of sources) {
  const startedAt = Date.now();
  try {
    const adapter = getSourceAdapter(source, adapters);
    const discovered = await adapter.discover(source, {
      initialBackfill: true,
      since: new Date(Date.now() - 30 * 86_400_000),
      limit: 2,
    });
    let fetched: Record<string, unknown> | null = null;
    if (!discoveryOnly && discovered.items[0]) {
      const content = await adapter.fetch(source, discovered.items[0]);
      fetched = {
        identityKey: discovered.items[0].identityKey,
        status: content.status,
        rawFormat: content.rawFormat,
        wordCount: content.wordCount,
        contentHash: content.contentHash,
      };
    }
    console.log(
      JSON.stringify({
        source: source.slug,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        discoveryHttpStatus: discovered.surface.httpStatus,
        discoveryHash: discovered.surface.contentHash,
        discoveredItems: discovered.items.length,
        fetched,
      }),
    );
  } catch (error) {
    failures += 1;
    console.error(
      JSON.stringify({
        source: source.slug,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

if (failures) process.exitCode = 1;

