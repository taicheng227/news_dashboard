import { pathToFileURL } from 'node:url';
import { collectOfficial } from './lib/official.mjs';
import { collectReddit } from './lib/reddit.mjs';
import { ensureStructure, readState } from './lib/vault.mjs';

export async function collectAll({ fetchImpl = fetch, now = new Date() } = {}) {
  await ensureStructure();
  const state = await readState();
  const capturedAt = now.toISOString();
  const official = await collectOfficial({
    lastSuccessfulRun: state.lastSuccessfulRun,
    officialHashes: state.officialHashes,
    capturedAt,
    fetchImpl,
  });
  const reddit = await collectReddit({ capturedAt, fetchImpl, now: now.getTime() });
  return {
    capturedAt,
    officialHashes: official.hashes,
    stats: {
      officialCaptured: official.captured,
      redditCaptured: reddit.captured,
      redditInspected: reddit.inspected,
      redditFiltered: reddit.filtered,
      youtubeAdded: 0,
    },
    failures: [...official.failures, ...reddit.failures],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectAll();
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) console.error(`Completed with ${result.failures.length} source failure(s).`);
}
