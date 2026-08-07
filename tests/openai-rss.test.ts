import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { getConfiguredSource } from "../config/sources.js";
import { ArticleIndexAdapter } from "../src/sources/article-index-adapter.js";
import {
  parseOpenAiNewsRss,
  parseOpenAiProductReleaseNotesRss,
} from "../src/sources/openai-rss.js";
import { RollingChangelogAdapter } from "../src/sources/rolling-changelog-adapter.js";

const fixtures = path.resolve("tests/fixtures");
const context = {
  initialBackfill: true,
  since: new Date("2026-07-01T00:00:00Z"),
  limit: 50,
};

test("OpenAI News RSS discovers canonical articles and retains feed metadata", async () => {
  const source = getConfiguredSource("openai-news");
  assert.ok(source);
  const xml = await readFile(path.join(fixtures, "openai-news-rss.xml"), "utf8");
  const items = parseOpenAiNewsRss(source, xml, context);

  assert.equal(items.length, 2);
  assert.equal(items[0].canonicalUrl, "https://openai.com/index/codex-background-tasks");
  assert.equal(
    items[0].identityKey,
    "url:https://openai.com/index/codex-background-tasks",
  );
  assert.equal(items[0].externalId, "https://openai.com/index/codex-background-tasks");
  assert.equal(items[0].author, "OpenAI");
  assert.deepEqual(items[0].metadata.rssCategories, ["Product"]);
  assert.match(String(items[0].metadata.rssDescription), /longer software tasks/);
});

test(
  "OpenAI News uses an explicit metadata-only RSS fallback when its article is 403",
  { concurrency: false },
  async () => {
    const source = getConfiguredSource("openai-news");
    assert.ok(source);
    const xml = await readFile(path.join(fixtures, "openai-news-rss.xml"), "utf8");
    const item = parseOpenAiNewsRss(source, xml, context)[0];
    assert.ok(item);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("blocked", {
        status: 403,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const fetched = await new ArticleIndexAdapter().fetch(source, item);
      assert.equal(fetched.status, "FETCHED");
      assert.equal(fetched.rawFormat, "JSON");
      assert.equal(fetched.metadata.contentQuality, "METADATA_ONLY");
      assert.equal(fetched.metadata.extractionMethod, "RSS_METADATA_FALLBACK");
      assert.equal(fetched.metadata.linkedArticleHttpStatus, 403);
      assert.match(fetched.extractedText, /structured results when work completes/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test("OpenAI Product RSS becomes discrete dated inline release notes", async () => {
  const source = getConfiguredSource("openai-product-release-notes");
  assert.ok(source);
  const xml = await readFile(
    path.join(fixtures, "openai-product-release-notes-rss.xml"),
    "utf8",
  );
  const items = parseOpenAiProductReleaseNotesRss(source, xml, context);

  assert.equal(items.length, 2);
  assert.equal(items[0].canonicalUrl, source.url);
  assert.equal(items[0].publishedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(items[0].kind, "RELEASE_NOTE");
  assert.match(
    items[0].identityKey,
    /^changelog:openai-product-release-notes:2026-08-05-projects-can-now-share-connected-sources$/,
  );
  assert.equal(items[0].metadata.sourceFormat, "RSS");
  assert.equal(items[0].inlineContent?.rawFormat, "HTML");
  assert.match(items[0].inlineContent?.extractedText ?? "", /Admins can control access/);

  const fetched = await new RollingChangelogAdapter().fetch(source, items[0]);
  assert.equal(fetched.status, "FETCHED");
  assert.equal(fetched.rawFormat, "HTML");
  assert.match(fetched.extractedText, /share connected sources/);
});
