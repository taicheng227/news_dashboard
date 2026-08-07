import { readFile } from 'node:fs/promises';
import { vaultPath } from './paths.mjs';

export function parseMarkdownTable(markdown) {
  const rows = markdown.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  if (rows.length < 3) return [];
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const headers = cells(rows[0]);
  return rows.slice(2).map(cells).filter((row) => row.length === headers.length).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
}

export async function readOfficialSources() {
  const markdown = await readFile(vaultPath('config', 'sources.md'), 'utf8');
  return parseMarkdownTable(markdown)
    .filter((row) => /^(yes|true|1)$/i.test(row.enabled))
    .map((row) => ({ ...row, keywords: row.keywords.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) }));
}
