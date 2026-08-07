import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdownToHtml } from './lib/markdown.mjs';
import { websiteRoot, vaultPath } from './lib/paths.mjs';
import { ensureStructure, listMarkdown, parseFrontmatter, readState } from './lib/vault.mjs';

function humanDate(value) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(date);
}

function humanTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not refreshed yet';
  return new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' }).format(date);
}

export function renderPage({ attributes = {}, body = '', state = {} }) {
  const important = Number(attributes.important_count || 0);
  const worth = Number(attributes.worth_knowing_count || 0);
  const filtered = Number(attributes.reddit_filtered_count ?? state.lastRunStats?.redditFiltered ?? 0);
  const date = attributes.date || new Date().toISOString().slice(0, 10);
  const refreshed = attributes.refreshed || state.lastSuccessfulRun;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A finite daily briefing on the AI developments worth your attention.">
  <title>AI Radar — ${humanDate(date)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="masthead">
    <a class="brand" href="#top" aria-label="AI Radar home"><span class="brand-dot"></span>AI RADAR</a>
    <p class="frequency">One careful scan · once a day</p>
  </header>
  <main id="top">
    <section class="hero">
      <div>
        <p class="eyebrow">DAILY SIGNAL / ${date.replaceAll('-', '.')}</p>
        <h1>${humanDate(date)}</h1>
        <p class="lede">The useful edge of AI news, with the noise left outside.</p>
      </div>
      <div class="radar-mark" aria-hidden="true"><span></span><i></i></div>
    </section>
    <section class="dashboard-grid">
      <aside class="status-panel" aria-label="Daily status">
        <p class="status-label">LAST REFRESHED</p>
        <p class="refresh-time">${humanTime(refreshed)}</p>
        <div class="metric"><strong>${important}</strong><span>important<br>development${important === 1 ? '' : 's'}</span></div>
        <div class="metric"><strong>${worth}</strong><span>worth<br>knowing</span></div>
        <div class="metric muted"><strong>${filtered}</strong><span>Reddit posts<br>filtered</span></div>
        <p class="next-refresh">NEXT REFRESH<br><strong>Tomorrow</strong></p>
      </aside>
      <article class="brief">
        ${markdownToHtml(body)}
      </article>
    </section>
    <section class="caught-up" aria-label="Caught up">
      <span class="check">✓</span>
      <div><p>RADAR CLEAR</p><h2>You're caught up.</h2></div>
      <p class="permission">Close the tab. Go make something.</p>
    </section>
  </main>
  <footer><span>AI RADAR</span><span>Finite by design.</span></footer>
</body>
</html>`;
}

async function latestBrief() {
  const files = (await listMarkdown(vaultPath('briefs'))).sort().reverse();
  if (!files.length) return {
    attributes: { date: new Date().toISOString().slice(0, 10), important_count: 0, worth_knowing_count: 0, reddit_filtered_count: 0 },
    body: '# AI Brief\n\n## Ready when you are\n\nRun `npm run daily` to collect and synthesize your first brief.\n',
  };
  return parseFrontmatter(await readFile(files[0], 'utf8'));
}

export async function renderLatest() {
  await ensureStructure();
  const [brief, state] = await Promise.all([latestBrief(), readState()]);
  await mkdir(websiteRoot, { recursive: true });
  await writeFile(path.join(websiteRoot, 'index.html'), renderPage({ ...brief, state }), 'utf8');
  return path.join(websiteRoot, 'index.html');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Rendered ${await renderLatest()}`);
}
