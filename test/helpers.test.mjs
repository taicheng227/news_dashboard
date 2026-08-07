import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { filterRedditComments, filterRedditPosts, flattenComments, SUBREDDITS } from '../scripts/lib/reddit.mjs';
import { markdownToHtml } from '../scripts/lib/markdown.mjs';
import { identifierExists, serializeFrontmatter } from '../scripts/lib/vault.mjs';
import { parseFeed } from '../scripts/lib/official.mjs';
import { vttToMarkdown } from '../scripts/youtube.mjs';

test('Reddit keeps only recent 50+ posts and 20+ comments', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const posts = [
    { id: 'keep', score: 50, created_utc: (now - 47 * 3600000) / 1000 },
    { id: 'low', score: 49, created_utc: now / 1000 },
    { id: 'old', score: 500, created_utc: (now - 49 * 3600000) / 1000 },
  ];
  assert.deepEqual(filterRedditPosts(posts, now).map((post) => post.id), ['keep']);
  assert.deepEqual(filterRedditComments([{ score: 20, body: 'yes' }, { score: 19, body: 'no' }]).map((comment) => comment.body), ['yes']);
});

test('Reddit collection scope matches the declared six communities', () => {
  assert.deepEqual(SUBREDDITS, ['codex', 'OpenAI', 'LocalLLM', 'Anthropic', 'ClaudeAI', 'ClaudeCode']);
});

test('nested Reddit comments are flattened', () => {
  const tree = [{ kind: 't1', data: { id: 'a', body: 'A', replies: { data: { children: [{ kind: 't1', data: { id: 'b', body: 'B' } }] } } } }];
  assert.deepEqual(flattenComments(tree).map((comment) => comment.id), ['a', 'b']);
});

test('frontmatter identifiers provide simple deduplication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-radar-test-'));
  try {
    await writeFile(path.join(directory, 'note.md'), `${serializeFrontmatter({ reddit_id: 'abc123' })}\n# Note\n`);
    assert.equal(await identifierExists(directory, 'reddit_id', 'abc123'), true);
    assert.equal(await identifierExists(directory, 'reddit_id', 'different'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('RSS and Atom entries normalize into source items', () => {
  const rss = '<rss><channel><item><title>Codex update</title><link>https://example.com/a</link><pubDate>Thu, 07 Aug 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Details</p>]]></description></item></channel></rss>';
  assert.deepEqual(parseFeed(rss)[0], { title: 'Codex update', url: 'https://example.com/a', id: 'https://example.com/a', published: 'Thu, 07 Aug 2026 10:00:00 GMT', summary: 'Details' });
});

test('Markdown rendering escapes HTML while preserving allowed formatting', () => {
  const html = markdownToHtml('## Important\n\n<script>alert(1)</script> **Safe**');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>Safe<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
});

test('VTT captions become deduplicated timestamped paragraphs', () => {
  const transcript = vttToMarkdown('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n\n00:00:03.000 --> 00:00:05.000\nHello\n\n00:01:04.000 --> 00:01:06.000\nWorld');
  assert.equal(transcript, '[00:01] Hello\n\n[01:04] World');
});
