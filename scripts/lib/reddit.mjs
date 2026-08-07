import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { htmlToText, truncate } from './text.mjs';
import { identifierExists, serializeFrontmatter, slugify } from './vault.mjs';
import { vaultPath } from './paths.mjs';

export const POST_THRESHOLD = 50;
export const COMMENT_THRESHOLD = 20;
export const SUBREDDITS = ['codex', 'ClaudeCode'];
const USER_AGENT = 'AI-Radar/1.0 (personal news reader)';

export function filterRedditPosts(posts, now = Date.now()) {
  const cutoff = now - 48 * 60 * 60 * 1000;
  return posts.filter((post) => Number(post.score) >= POST_THRESHOLD && Number(post.created_utc) * 1000 >= cutoff);
}

export function flattenComments(children = []) {
  const comments = [];
  for (const child of children) {
    if (child.kind !== 't1' || !child.data) continue;
    comments.push(child.data);
    const replies = child.data.replies?.data?.children;
    if (Array.isArray(replies)) comments.push(...flattenComments(replies));
  }
  return comments;
}

export function filterRedditComments(comments) {
  return comments.filter((comment) => Number(comment.score) >= COMMENT_THRESHOLD && comment.body && comment.body !== '[deleted]');
}

async function redditToken(fetchImpl) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${authorization}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Reddit OAuth failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Reddit OAuth returned no access token.');
  return payload.access_token;
}

async function redditJson(apiPath, fetchImpl, token) {
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const response = await fetchImpl(`${base}${apiPath}`, {
    headers: {
      ...(token ? { authorization: `bearer ${token}` } : {}),
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
  });
  if (response.status === 403 && !token) {
    throw new Error('403 Blocked (set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for reliable read-only access)');
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function saveDiscussion(subreddit, post, comments, capturedAt) {
  const directory = vaultPath('sources', 'reddit', subreddit.toLowerCase());
  await mkdir(directory, { recursive: true });
  if (await identifierExists(directory, 'reddit_id', post.id)) return false;
  const url = `https://www.reddit.com${post.permalink}`;
  const published = new Date(post.created_utc * 1000).toISOString().slice(0, 10);
  const metadata = serializeFrontmatter({
    type: 'ai-source', source_type: 'reddit', subreddit, reddit_id: post.id, url,
    published, captured: capturedAt, score_at_capture: post.score, comment_threshold: COMMENT_THRESHOLD,
  });
  const body = truncate(htmlToText(post.selftext || ''), 10000) || (post.url && post.url !== url ? `Linked article: ${post.url}` : 'No post body.');
  const benchmark = comments.length
    ? comments.sort((a, b) => b.score - a.score).map((comment) => `### +${comment.score}\n\n${truncate(htmlToText(comment.body), 5000)}`).join('\n\n')
    : '_No comments met the +20 threshold at capture time._';
  const markdown = `${metadata}\n# ${post.title}\n\n## Post\n\n${body}\n\n## Community benchmark\n\n${benchmark}\n`;
  await writeFile(path.join(directory, `${published}-${slugify(post.title, post.id)}.md`), markdown, 'utf8');
  return true;
}

export async function collectReddit({ capturedAt = new Date().toISOString(), fetchImpl = fetch, now = Date.now() } = {}) {
  const stats = { inspected: 0, captured: 0, filtered: 0, failures: [] };
  let token = null;
  try {
    token = await redditToken(fetchImpl);
  } catch (error) {
    stats.failures.push(error.message);
    return stats;
  }
  for (const subreddit of SUBREDDITS) {
    try {
      const listing = await redditJson(`/r/${subreddit}/new.json?limit=100&raw_json=1`, fetchImpl, token);
      const posts = (listing?.data?.children || []).map((child) => child.data).filter(Boolean)
        .filter((post) => Number(post.created_utc) * 1000 >= now - 48 * 60 * 60 * 1000);
      stats.inspected += posts.length;
      const qualifying = filterRedditPosts(posts, now);
      stats.filtered += posts.length - qualifying.length;
      for (const post of qualifying) {
        const thread = await redditJson(`${post.permalink}.json?limit=100&sort=top&raw_json=1`, fetchImpl, token);
        const comments = filterRedditComments(flattenComments(thread?.[1]?.data?.children || []));
        if (await saveDiscussion(subreddit, post, comments, capturedAt)) stats.captured += 1;
      }
    } catch (error) {
      stats.failures.push(`r/${subreddit}: ${error.message}`);
    }
  }
  return stats;
}
