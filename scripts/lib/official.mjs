import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readOfficialSources } from './config.mjs';
import { htmlToText, stripCdata, truncate } from './text.mjs';
import { identifierExists, serializeFrontmatter, shortHash, slugify } from './vault.mjs';
import { vaultPath } from './paths.mjs';

const USER_AGENT = 'AI-Radar/1.0 (personal news reader)';

export async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/rss+xml,application/atom+xml,text/plain;q=0.9,*/*;q=0.5' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return stripCdata(match[1]).trim();
  }
  return '';
}

export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const title = htmlToText(tag(block, ['title']));
    const url = htmlToText(tag(block, ['link'])) || atomLink || htmlToText(tag(block, ['guid', 'id']));
    return {
      title,
      url,
      id: htmlToText(tag(block, ['guid', 'id'])) || url,
      published: htmlToText(tag(block, ['pubDate', 'published', 'updated'])),
      summary: htmlToText(tag(block, ['content:encoded', 'content', 'description', 'summary'])),
    };
  }).filter((item) => item.title && item.url);
}

function isRelevant(item, keywords) {
  if (!keywords.length) return true;
  const haystack = `${item.title}\n${item.summary}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function dateOnly(value, fallback = new Date()) {
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  return date.toISOString().slice(0, 10);
}

async function saveOfficialNote({ source, title, url, published, captured, content, identifier, identifierKey = 'url' }) {
  const directory = vaultPath('sources', 'official', source.provider);
  await mkdir(directory, { recursive: true });
  if (await identifierExists(directory, identifierKey, identifier)) return false;
  const attributes = {
    type: 'ai-source', source_type: 'official', provider: source.provider,
    [identifierKey]: identifier, url, published: dateOnly(published, new Date(captured)), captured,
  };
  const markdown = `${serializeFrontmatter(attributes)}\n# ${title}\n\n${truncate(content) || 'No extractable text was available. Use the canonical link above.'}\n`;
  const filename = `${dateOnly(published, new Date(captured))}-${slugify(title)}.md`;
  await writeFile(path.join(directory, filename), markdown, 'utf8');
  return true;
}

async function collectFeed(source, context) {
  const xml = await fetchText(source.url, context.fetchImpl);
  const capturedTime = new Date(context.capturedAt).getTime();
  const previousRun = context.lastSuccessfulRun ? new Date(context.lastSuccessfulRun).getTime() : Number.NaN;
  const cutoff = Number.isNaN(previousRun)
    ? new Date(capturedTime - 7 * 86400000)
    : new Date(Math.min(previousRun, capturedTime - 48 * 60 * 60 * 1000));
  let captured = 0;
  for (const item of parseFeed(xml)) {
    const published = new Date(item.published);
    if (!Number.isNaN(published.getTime()) && published < cutoff) continue;
    if (!isRelevant(item, source.keywords)) continue;
    let content = item.summary;
    try {
      content = htmlToText(await fetchText(item.url, context.fetchImpl)) || content;
    } catch {
      // Feed text is a sufficient fallback for a small personal archive.
    }
    if (await saveOfficialNote({ source, ...item, captured: context.capturedAt, content, identifier: item.url })) captured += 1;
  }
  return captured;
}

async function collectPage(source, context) {
  const raw = await fetchText(source.url, context.fetchImpl);
  const content = source.url.endsWith('.md') ? raw.trim() : htmlToText(raw);
  const hash = shortHash(content);
  if (context.officialHashes[source.url] === hash) return { captured: 0, hash };
  const title = source.name;
  const saved = await saveOfficialNote({
    source,
    title: `${title} snapshot`,
    url: source.url,
    published: context.capturedAt,
    captured: context.capturedAt,
    content,
    identifier: hash,
    identifierKey: 'content_hash',
  });
  return { captured: saved ? 1 : 0, hash };
}

export async function collectOfficial({ lastSuccessfulRun, officialHashes = {}, capturedAt = new Date().toISOString(), fetchImpl = fetch } = {}) {
  const stats = { captured: 0, hashes: { ...officialHashes }, failures: [] };
  for (const source of await readOfficialSources()) {
    try {
      if (source.type === 'rss') {
        stats.captured += await collectFeed(source, { lastSuccessfulRun, capturedAt, fetchImpl });
      } else if (source.type === 'page') {
        const result = await collectPage(source, { capturedAt, fetchImpl, officialHashes: stats.hashes });
        stats.captured += result.captured;
        stats.hashes[source.url] = result.hash;
      } else {
        throw new Error(`Unsupported source type: ${source.type}`);
      }
    } catch (error) {
      stats.failures.push(`${source.name}: ${error.message}`);
    }
  }
  return stats;
}
