import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { statePath, vaultPath, vaultRoot, websiteRoot } from './paths.mjs';

export const EMPTY_STATS = {
  officialCaptured: 0,
  redditCaptured: 0,
  redditInspected: 0,
  redditFiltered: 0,
  youtubeAdded: 0,
};

export async function ensureStructure() {
  const directories = [
    vaultPath('sources', 'official', 'openai'),
    vaultPath('sources', 'official', 'anthropic'),
    vaultPath('sources', 'reddit'),
    vaultPath('sources', 'youtube'),
    vaultPath('briefs'),
    vaultPath('config'),
    vaultPath('system'),
    websiteRoot,
  ];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
}

export async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { lastSuccessfulRun: null, officialHashes: {}, lastRunStats: { ...EMPTY_STATS }, lastRunFailures: [] };
  }
}

export async function writeState(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return { attributes: {}, body: markdown };
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return { attributes: {}, body: markdown };
  const attributes = {};
  for (const line of markdown.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try {
      attributes[key] = JSON.parse(raw);
    } catch {
      attributes[key] = raw;
    }
  }
  return { attributes, body: markdown.slice(end + 5) };
}

export function serializeFrontmatter(attributes) {
  const lines = Object.entries(attributes).map(([key, value]) => {
    if (value === null) return `${key}: null`;
    if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${value}`;
    return `${key}: ${JSON.stringify(String(value))}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

export function slugify(value, fallback = 'item') {
  const slug = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

export function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export async function listMarkdown(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdown(fullPath);
      return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function identifierExists(directory, key, value) {
  const expected = String(value);
  for (const file of await listMarkdown(directory)) {
    const { attributes } = parseFrontmatter(await readFile(file, 'utf8'));
    if (String(attributes[key] ?? '') === expected) return true;
  }
  return false;
}

export async function recentSourceFiles(since) {
  const sourceRoot = vaultPath('sources');
  const cutoff = since ? new Date(since).getTime() : 0;
  const files = [];
  for (const file of await listMarkdown(sourceRoot)) {
    const content = await readFile(file, 'utf8');
    const { attributes } = parseFrontmatter(content);
    const captured = Date.parse(attributes.captured || attributes.captured_at || '');
    const modified = (await stat(file)).mtimeMs;
    if ((!Number.isNaN(captured) && captured >= cutoff) || modified >= cutoff) files.push(file);
  }
  return files.sort();
}

export { vaultRoot, websiteRoot };
