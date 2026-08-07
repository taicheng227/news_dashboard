import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureStructure, serializeFrontmatter, identifierExists, slugify } from './lib/vault.mjs';
import { vaultPath } from './lib/paths.mjs';

function runYtDlp(args) {
  const result = spawnSync('yt-dlp', args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT' || /not recognized/i.test(result.stderr || '')) {
    throw new Error('yt-dlp is not installed. Install it, then retry; the full video is never downloaded.');
  }
  if (result.status !== 0) throw new Error((result.stderr || 'yt-dlp failed').trim());
  return result.stdout;
}

function timestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function vttToMarkdown(vtt) {
  const blocks = vtt.replace(/\r/g, '').split(/\n{2,}/);
  const output = [];
  let previous = '';
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line && !/^WEBVTT|^Kind:|^Language:|^NOTE/.test(line));
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const start = lines[timingIndex].match(/(\d{2}:)?\d{2}:\d{2}[.,]\d{3}/)?.[0] || '00:00.000';
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text === previous) continue;
    previous = text;
    const parts = start.replace(',', '.').split(':').map(Number);
    const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    output.push(`[${timestamp(seconds)}] ${text}`);
  }
  return output.join('\n\n');
}

export async function saveYoutube(url) {
  await ensureStructure();
  const directory = vaultPath('sources', 'youtube');
  const metadata = JSON.parse(runYtDlp(['--dump-single-json', '--skip-download', '--no-playlist', url]));
  if (await identifierExists(directory, 'video_id', metadata.id)) return { skipped: true, videoId: metadata.id };
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ai-radar-youtube-'));
  let source = 'youtube_human';
  try {
    const output = path.join(temporary, '%(id)s.%(ext)s');
    try {
      runYtDlp(['--skip-download', '--no-playlist', '--write-subs', '--sub-langs', 'en.*', '--sub-format', 'vtt', '-o', output, url]);
    } catch {
      source = 'youtube_auto';
      runYtDlp(['--skip-download', '--no-playlist', '--write-auto-subs', '--sub-langs', 'en.*', '--sub-format', 'vtt', '-o', output, url]);
    }
    const subtitle = (await readdir(temporary)).find((file) => file.endsWith('.vtt'));
    if (!subtitle) throw new Error('Transcript unavailable. YouTube did not provide usable English captions.');
    const transcript = vttToMarkdown(await readFile(path.join(temporary, subtitle), 'utf8'));
    if (!transcript) throw new Error('Transcript unavailable. The caption file contained no usable text.');
    const captured = new Date().toISOString();
    const markdown = `${serializeFrontmatter({
      type: 'ai-source', source_type: 'youtube', video_id: metadata.id, title: metadata.title,
      channel: metadata.channel || metadata.uploader || 'Unknown', url: metadata.webpage_url || url,
      captured, transcript_source: source,
    })}\n# ${metadata.title}\n\n## Transcript\n\n${transcript}\n`;
    const filePath = path.join(directory, `${captured.slice(0, 10)}-${slugify(metadata.title, metadata.id)}.md`);
    await writeFile(filePath, markdown, 'utf8');
    return { skipped: false, videoId: metadata.id, filePath, transcriptSource: source };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  try {
    if (!url) throw new Error('Usage: npm run youtube -- <youtube-url>');
    const result = await saveYoutube(url);
    console.log(result.skipped ? `Video ${result.videoId} is already in the vault.` : `Saved ${result.filePath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
