import assert from "node:assert/strict";
import test from "node:test";

import {
  discoveryContext,
  selectRollingChangelogItems,
} from "../src/collection/collect.js";
import type { Source } from "../src/db/types.js";
import type { DiscoveredItem, DiscoveryContext } from "../src/sources/types.js";

function source(lastSuccessAt: string | null): Source {
  return {
    id: "source-1",
    slug: "anthropic-claude-code-changelog",
    name: "Claude Code Changelog",
    provider: "ANTHROPIC",
    kind: "ROLLING_CHANGELOG",
    canonicalUrl: "https://example.com/changelog",
    enabled: true,
    config: {},
    lastCheckedAt: lastSuccessAt,
    lastSuccessAt,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function item(
  identityKey: string,
  publishedAt: string | null,
  sourceFormat?: "MARKDOWN" | "HTML",
): DiscoveredItem {
  return {
    sourceSlug: "anthropic-claude-code-changelog",
    identityKey,
    externalId: identityKey,
    canonicalUrl: "https://example.com/changelog",
    kind: "RELEASE_NOTE",
    title: identityKey,
    author: null,
    publishedAt,
    discoveryFingerprint: identityKey,
    metadata: sourceFormat ? { sourceFormat } : {},
  };
}

test("rolling discovery contexts preserve the 30-day initial cap and 48-hour overlap", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const initial = discoveryContext(source(null), now);
  assert.equal(initial.initialBackfill, true);
  assert.equal(initial.since.toISOString(), "2026-07-09T12:00:00.000Z");
  assert.equal(initial.limit, 50);

  const incremental = discoveryContext(
    source("2026-08-08T10:00:00.000Z"),
    now,
  );
  assert.equal(incremental.initialBackfill, false);
  assert.equal(incremental.since.toISOString(), "2026-08-06T10:00:00.000Z");
  assert.equal(incremental.limit, 250);
});

test("initial rolling selection excludes dated history and never exceeds 50 entries", () => {
  const context: DiscoveryContext = {
    initialBackfill: true,
    since: new Date("2026-07-09T12:00:00.000Z"),
    limit: 250,
  };
  const recent = Array.from({ length: 55 }, (_, index) =>
    item(`recent-${index}`, "2026-08-01T00:00:00.000Z"),
  );
  const selected = selectRollingChangelogItems(
    [...recent, item("old", "2026-06-01T00:00:00.000Z")],
    context,
    new Set(),
  );
  assert.equal(selected.length, 50);
  assert.equal(selected.some((entry) => entry.identityKey === "old"), false);
});

test("incremental rolling selection keeps overlap and known edits without importing history", () => {
  const context: DiscoveryContext = {
    initialBackfill: false,
    since: new Date("2026-08-06T10:00:00.000Z"),
    limit: 250,
  };
  const selected = selectRollingChangelogItems(
    [
      item("new-leading-version", null, "MARKDOWN"),
      item("known-anchor", null, "MARKDOWN"),
      item("unknown-old-version", null, "MARKDOWN"),
      item("known-old-edited", "2025-01-01T00:00:00.000Z", "HTML"),
      item("unknown-old-dated", "2025-01-01T00:00:00.000Z", "HTML"),
      item("new-at-overlap-boundary", "2026-08-06T10:00:00.000Z", "HTML"),
      item("unknown-undated-html", null, "HTML"),
    ],
    context,
    new Set(["known-anchor", "known-old-edited"]),
  );

  assert.deepEqual(
    selected.map((entry) => entry.identityKey),
    [
      "new-leading-version",
      "known-anchor",
      "known-old-edited",
      "new-at-overlap-boundary",
    ],
  );
});

test("incremental undated history requires a known newest-first anchor", () => {
  const context: DiscoveryContext = {
    initialBackfill: false,
    since: new Date("2026-08-06T10:00:00.000Z"),
    limit: 250,
  };
  const selected = selectRollingChangelogItems(
    Array.from({ length: 250 }, (_, index) =>
      item(`history-${index}`, null, "MARKDOWN"),
    ),
    context,
    new Set(),
  );
  assert.deepEqual(selected, []);
});
