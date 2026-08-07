import { collectAll } from './collect.mjs';
import { publishSite } from './publish.mjs';
import { renderLatest } from './render.mjs';
import { synthesizeBrief } from './synthesize.mjs';
import { readState, writeState } from './lib/vault.mjs';

const startedAt = new Date();
const publish = process.argv.includes('--publish');
const previous = await readState();

console.log('1/3 Collecting configured sources…');
const collection = await collectAll({ now: startedAt });
for (const failure of collection.failures) console.error(`Source warning: ${failure}`);

console.log('2/3 Creating the finite daily brief…');
const brief = await synthesizeBrief({ since: previous.lastSuccessfulRun, date: startedAt, stats: collection.stats });

console.log('3/3 Rendering the static dashboard…');
const rendered = await renderLatest();

if (publish) {
  console.log('Publishing the rendered dashboard…');
  await publishSite();
}

await writeState({
  ...previous,
  lastSuccessfulRun: startedAt.toISOString(),
  officialHashes: collection.officialHashes,
  lastRunStats: collection.stats,
  lastRunFailures: collection.failures,
});

console.log(`Daily run complete. ${brief.sourceFiles.length} new source file(s); dashboard: ${rendered}`);
