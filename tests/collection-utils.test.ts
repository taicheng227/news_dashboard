import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { getConfiguredSource } from "../config/sources.js";
import {
  canonicalizeUrl,
  changelogIdentityKey,
  urlIdentityKey,
  youtubeIdentityKey,
} from "../src/collection/canonicalize.js";
import {
  hashExtractedText,
  normalizeTextForHash,
} from "../src/collection/content-hash.js";
import { extractArticle } from "../src/collection/extract-article.js";
import { vttToText } from "../src/collection/vtt-to-text.js";
import {
  ArticleIndexAdapter,
  parseArticleIndex,
  parseQwenResearchRetrieval,
} from "../src/sources/article-index-adapter.js";
import {
  parseDatedMarkdownReleaseNotes,
  parseRollingChangelog,
} from "../src/sources/rolling-changelog-adapter.js";
import {
  parseZaiBlogSitemap,
  parseZaiUpdateReleaseNotes,
  ZAI_BLOG_SITEMAP,
} from "../src/sources/zai-source.js";
import { parseYoutubeRss } from "../src/sources/youtube-adapter.js";

const fixtures = path.resolve("tests/fixtures");
const context = {
  initialBackfill: true,
  since: new Date("2026-07-01T00:00:00Z"),
  limit: 50,
};

test("canonicalizeUrl strips trackers, fragments, default ports, and trailing slashes", () => {
  assert.equal(
    canonicalizeUrl("HTTPS://OpenAI.com:443/index/demo/?utm_source=rss&b=2&a=1#top"),
    "https://openai.com/index/demo?a=1&b=2",
  );
});

test("identity-key helpers are stable and source-specific", () => {
  assert.equal(
    urlIdentityKey("https://openai.com/index/demo/?utm_campaign=x"),
    "url:https://openai.com/index/demo",
  );
  assert.equal(youtubeIdentityKey("abc123"), "youtube:abc123");
  assert.equal(
    changelogIdentityKey("openai-codex", "Codex app 26.806"),
    "changelog:openai-codex:codex-app-26-806",
  );
});

test("content hashing deduplicates inconsequential whitespace", () => {
  const left = "A release\r\n\r\nwith   useful details.";
  const right = "A release\n\nwith useful details.";
  assert.equal(normalizeTextForHash(left), normalizeTextForHash(right));
  assert.equal(hashExtractedText(left), hashExtractedText(right));
});

test("article-index fixture discovers canonical discrete items", async () => {
  const source = getConfiguredSource("openai-news");
  assert.ok(source);
  const html = await readFile(path.join(fixtures, "article-index.html"), "utf8");
  const items = parseArticleIndex(source, html, context);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Codex gets subagents");
  assert.equal(items[0].identityKey, "url:https://openai.com/index/codex-gets-subagents");
  assert.equal(items[0].publishedAt, "2026-08-06T00:00:00.000Z");
});

test("article extraction excludes site chrome", async () => {
  const html = await readFile(path.join(fixtures, "article.html"), "utf8");
  const article = extractArticle(html, "https://openai.com/index/codex-gets-subagents");
  assert.match(article.text, /delegate independent tasks/);
  assert.doesNotMatch(article.text, /Cookie settings|Products Pricing/);
});

test("edited changelog entry keeps identity and changes content hash", async () => {
  const source = getConfiguredSource("openai-codex-changelog");
  assert.ok(source);
  const original = parseRollingChangelog(
    source,
    await readFile(path.join(fixtures, "changelog.html"), "utf8"),
    context,
  );
  const edited = parseRollingChangelog(
    source,
    await readFile(path.join(fixtures, "changelog-edited.html"), "utf8"),
    context,
  );
  const before = original.find((item) => item.externalId === "26.806");
  const after = edited.find((item) => item.externalId === "26.806");
  assert.ok(before?.inlineContent && after?.inlineContent);
  assert.equal(before.identityKey, after.identityKey);
  assert.notEqual(
    hashExtractedText(before.inlineContent.extractedText),
    hashExtractedText(after.inlineContent.extractedText),
  );
});

test("Anthropic Platform Markdown becomes dated items under the configured canonical URL", async () => {
  const source = getConfiguredSource("anthropic-platform-release-notes");
  assert.ok(source);
  const markdown = await readFile(
    path.join(fixtures, "anthropic-platform-release-notes.md"),
    "utf8",
  );
  const items = parseDatedMarkdownReleaseNotes(source, markdown, context);
  assert.equal(items.length, 2);
  assert.equal(items[0].publishedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(items[0].canonicalUrl, source.url);
  assert.equal(
    items[0].identityKey,
    "changelog:anthropic-platform-release-notes:2026-08-05-august-5-2026",
  );
  assert.equal(items[0].metadata.sourceFormat, "MARKDOWN");
  assert.match(items[0].inlineContent?.extractedText ?? "", /structured tool results/);
});

test("Qwen retrieval fixture yields durable canonical identities and inline content", async () => {
  const source = getConfiguredSource("qwen-research");
  assert.ok(source);
  const payload = await readFile(
    path.join(fixtures, "qwen-research-retrieval.json"),
    "utf8",
  );
  const items = parseQwenResearchRetrieval(source, payload, context);
  assert.equal(items.length, 2);
  assert.equal(items[0].canonicalUrl, "https://qwen.ai/research/qwen-image-3-0");
  assert.equal(
    items[0].identityKey,
    "url:https://qwen.ai/research/qwen-image-3-0",
  );
  assert.equal(items[1].canonicalUrl, "https://qwen.ai/research/qwen3-coder-next");
  assert.equal(items[0].metadata.discoveredFrom, source.url);
  assert.equal(items[0].inlineContent?.rawFormat, "HTML");

  const fetched = await new ArticleIndexAdapter().fetch(source, items[0]);
  assert.equal(fetched.status, "FETCHED");
  assert.equal(fetched.metadata.extractionMethod, "QWEN_RETRIEVAL_API");
  assert.match(fetched.extractedText, /native image generation and editing/i);
});

test("Z.ai sitemap discovery keeps only canonical first-level blog posts", async () => {
  const source = getConfiguredSource("zai-blog");
  assert.ok(source);
  const xml = await readFile(path.join(fixtures, "zai-blog-sitemap.xml"), "utf8");
  const items = parseZaiBlogSitemap(source, xml, context);
  assert.equal(items.length, 2);
  assert.equal(items[0].canonicalUrl, "https://z.ai/blog/glm-5.2");
  assert.equal(items[0].identityKey, "url:https://z.ai/blog/glm-5.2");
  assert.equal(items[0].publishedAt, null);
  assert.equal(items[0].metadata.discoveredFrom, "https://z.ai/sitemap.xml");
  assert.equal(items[1].canonicalUrl, "https://z.ai/blog/zcube");
});

test("Z.ai blog adapter fetches the sitemap instead of the canonical 404 URL", async () => {
  const source = getConfiguredSource("zai-blog");
  assert.ok(source);
  const xml = await readFile(path.join(fixtures, "zai-blog-sitemap.xml"), "utf8");
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | null = null;
  globalThis.fetch = (async (input) => {
    requestedUrl = input instanceof Request ? input.url : input.toString();
    return new Response(xml, {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  }) as typeof fetch;

  try {
    const result = await new ArticleIndexAdapter().discover(source, context);
    assert.equal(requestedUrl, ZAI_BLOG_SITEMAP);
    assert.equal(result.items.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Z.ai Update components become stable dated release-note items", async () => {
  const source = getConfiguredSource("zai-release-notes");
  assert.ok(source);
  const markdown = await readFile(
    path.join(fixtures, "zai-release-notes.md"),
    "utf8",
  );
  const items = parseZaiUpdateReleaseNotes(source, markdown, context);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "GLM-5.2");
  assert.equal(items[0].publishedAt, "2026-08-06T00:00:00.000Z");
  assert.equal(
    items[0].identityKey,
    "changelog:zai-release-notes:2026-08-06-glm-5-2",
  );
  assert.equal(items[0].canonicalUrl, source.url);
  assert.equal(items[0].metadata.sourceFormat, "MARKDOWN_UPDATE");
  assert.match(items[0].inlineContent?.extractedText ?? "", /longer, more reliable/);
  assert.doesNotMatch(items[0].inlineContent?.extractedText ?? "", /<Update/);
});

test("YouTube RSS fixture discovers the stable video ID", async () => {
  const source = getConfiguredSource("youtube-theo-t3");
  assert.ok(source);
  const xml = await readFile(path.join(fixtures, "youtube-feed.xml"), "utf8");
  const items = parseYoutubeRss(source, xml, { ...context, limit: 10 });
  assert.equal(items.length, 1);
  assert.equal(items[0].identityKey, "youtube:abc123xyz");
  assert.equal(items[0].author, "Theo - t3.gg");
  assert.equal(items[0].canonicalUrl, "https://www.youtube.com/watch?v=abc123xyz");
});

test("VTT normalization collapses rolling and exact duplicate captions", async () => {
  const vtt = await readFile(path.join(fixtures, "captions.vtt"), "utf8");
  const transcript = vttToText(vtt);
  assert.equal(
    transcript,
    "[00:01]\n\nCodex can now delegate tasks to subagents\n\n[01:05]\n\nThis changes the workflow.",
  );
  assert.equal(transcript.match(/This changes/g)?.length, 1);
});
