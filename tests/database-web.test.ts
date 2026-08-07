import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeDatabase, openDatabase } from "../src/db/connection.js";
import { migrateDatabase } from "../src/db/migrate.js";
import {
  CollectionAlreadyRunningError,
  RadarRepository,
  RepositoryInvariantError,
} from "../src/db/repositories.js";
import type { NewsletterView } from "../src/db/types.js";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/server.js";

async function fixtureDatabase() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-radar-db-test-"));
  const database = openDatabase(path.join(directory, "radar.sqlite"));
  migrateDatabase(database, path.resolve("migrations"));
  const repository = new RadarRepository(database);
  const source = repository.seedSources([
    {
      slug: "openai-news",
      name: "OpenAI News",
      provider: "OPENAI",
      kind: "ARTICLE_INDEX",
      canonicalUrl: "https://openai.com/news/",
      enabled: true,
    },
  ])[0];
  const collection = repository.startCollectionRun({
    trigger: "MANUAL",
    startedAt: "2026-08-07T00:00:00.000Z",
  });
  const item = repository.upsertContentItem({
    sourceId: source.id,
    identityKey: "url:https://openai.com/index/subagents",
    canonicalUrl: "https://openai.com/index/subagents",
    kind: "ANNOUNCEMENT",
    title: "Codex gets subagents",
    publishedAt: "2026-08-07T00:00:00.000Z",
    discoveredAt: "2026-08-07T00:10:00.000Z",
    metadata: { description: "Codex can delegate independent work." },
  }).row;
  const snapshot = repository.insertContentSnapshot({
    itemId: item.id,
    collectionRunId: collection.id,
    capturedAt: "2026-08-07T00:20:00.000Z",
    contentHash: "hash-v1",
    rawFormat: "HTML",
    rawContent: "<article>Version one raw HTML</article>",
    extractedText: "Codex can delegate independent work to subagents.",
  });
  repository.finishCollectionRun(collection.id, {
    status: "SUCCEEDED",
    completedAt: "2026-08-07T00:30:00.000Z",
    sourcesChecked: 1,
    itemsDiscovered: 1,
    itemsCreated: 1,
    snapshotsCreated: 1,
  });
  return { directory, database, repository, source, item, snapshot };
}

function importEdition(
  repository: RadarRepository,
  runId: string,
  title = "Delegation becomes a first-class coding workflow",
): NewsletterView {
  const candidates = repository.listAnalysisRunCandidates(runId);
  assert.ok(candidates.length > 0);
  return repository.importNewsletter({
    analysisRunId: runId,
    expectedCandidates: candidates.map(({ itemId, snapshotId }) => ({ itemId, snapshotId })),
    editionDate: "2026-08-07",
    title,
    dek: "One practical release worth understanding.",
    markdown: `# ${title}\n\nYou're caught up.`,
    html: `<h1>${title}</h1><p>You're caught up.</p>`,
    status: "PUBLISHED",
    generatedAt: "2026-08-07T10:00:00.000Z",
    publishedAt: "2026-08-07T10:00:00.000Z",
    assessments: candidates.map((candidate) => ({
      itemId: candidate.itemId,
      snapshotId: candidate.snapshotId,
      disposition: "INCLUDE" as const,
      importance: 5,
      category: "CODING_AGENT" as const,
      confidence: "HIGH" as const,
      summary: "Codex can now delegate independent coding work.",
      whyItMatters: "Larger tasks can be split without manual coordination.",
      keyPoints: ["Subagents can work independently."],
      caveats: [],
    })),
    entries: [
      {
        section: "IMPORTANT",
        rank: 1,
        headline: "Codex can delegate independent work",
        summary: "Subagents are now part of the coding workflow.",
        whyItMatters: "Parallel work reduces coordination overhead.",
        caveats: [],
        sourceItemIds: [candidates[0].itemId],
      },
    ],
  });
}

async function cleanup(fixture: Awaited<ReturnType<typeof fixtureDatabase>>) {
  closeDatabase(fixture.database);
  await rm(fixture.directory, { recursive: true, force: true });
}

test("snapshot storage is compressed, deduplicated, and selected once as a candidate", async () => {
  const fixture = await fixtureDatabase();
  try {
    assert.equal(fixture.snapshot.created, true);
    const duplicateRun = fixture.repository.startCollectionRun({ trigger: "MANUAL" });
    const duplicate = fixture.repository.insertContentSnapshot({
      itemId: fixture.item.id,
      collectionRunId: duplicateRun.id,
      contentHash: "hash-v1",
      rawFormat: "HTML",
      rawContent: "<article>Version one raw HTML</article>",
      extractedText: "Codex can delegate independent work to subagents.",
    });
    fixture.repository.finishCollectionRun(duplicateRun.id, {
      status: "SUCCEEDED",
      sourcesChecked: 1,
      itemsDiscovered: 1,
      itemsCreated: 0,
      snapshotsCreated: 0,
    });
    assert.equal(duplicate.created, false);
    assert.equal(
      fixture.repository.readContentSnapshotBody(fixture.snapshot.row.id)?.toString("utf8"),
      "<article>Version one raw HTML</article>",
    );
    assert.deepEqual(
      fixture.repository.pendingCandidates().map((candidate) => candidate.snapshotId),
      [fixture.snapshot.row.id],
    );
  } finally {
    await cleanup(fixture);
  }
});

test("database collection lock rejects a concurrent active run", async () => {
  const fixture = await fixtureDatabase();
  try {
    const active = fixture.repository.startCollectionRun({ trigger: "MANUAL", lockTtlMs: 60_000 });
    assert.throws(
      () => fixture.repository.startCollectionRun({ trigger: "MANUAL", lockTtlMs: 60_000 }),
      (error: unknown) =>
        error instanceof CollectionAlreadyRunningError && error.activeRunId === active.id,
    );
    fixture.repository.releaseCollectionLock(active.id);
  } finally {
    await cleanup(fixture);
  }
});

test("malformed newsletter import rolls back every assessment and newsletter write", async () => {
  const fixture = await fixtureDatabase();
  try {
    const run = fixture.repository.createAnalysisRun({
      windowStart: "1970-01-01T00:00:00.000Z",
      windowEnd: "2026-08-08T00:00:00.000Z",
      promptVersion: "v1",
    });
    const candidates = fixture.repository.listAnalysisRunCandidates(run.id);
    assert.throws(
      () =>
        fixture.repository.importNewsletter({
          analysisRunId: run.id,
          expectedCandidates: candidates.map(({ itemId, snapshotId }) => ({ itemId, snapshotId })),
          editionDate: "2026-08-07",
          title: "Invalid edition",
          dek: "This should roll back.",
          markdown: "Invalid",
          html: "<p>Invalid</p>",
          assessments: candidates.map((candidate) => ({
            itemId: candidate.itemId,
            snapshotId: candidate.snapshotId,
            disposition: "INCLUDE",
            importance: 5,
            category: "CODING_AGENT",
            confidence: "HIGH",
            summary: "Summary",
            whyItMatters: "Reason",
            keyPoints: [],
            caveats: [],
          })),
          entries: [
            {
              section: "IMPORTANT",
              rank: 1,
              headline: "Invented source",
              summary: "Invalid",
              whyItMatters: "Invalid",
              caveats: [],
              sourceItemIds: ["invented-item"],
            },
          ],
        }),
      RepositoryInvariantError,
    );
    const assessmentCount = fixture.database
      .prepare("SELECT count(*) AS count FROM item_assessment")
      .get() as { count: number };
    const newsletterCount = fixture.database
      .prepare("SELECT count(*) AS count FROM newsletter")
      .get() as { count: number };
    assert.equal(assessmentCount.count, 0);
    assert.equal(newsletterCount.count, 0);
  } finally {
    await cleanup(fixture);
  }
});

test("changed snapshots become pending and same-date regeneration preserves both versions", async () => {
  const fixture = await fixtureDatabase();
  try {
    const firstRun = fixture.repository.createAnalysisRun({
      windowStart: "1970-01-01T00:00:00.000Z",
      windowEnd: "2026-08-08T00:00:00.000Z",
      promptVersion: "v1",
    });
    const first = importEdition(fixture.repository, firstRun.id);
    assert.equal(first.newsletter.version, 1);
    assert.equal(fixture.repository.countPendingCandidates(), 0);

    const collection = fixture.repository.startCollectionRun({ trigger: "MANUAL" });
    const changed = fixture.repository.insertContentSnapshot({
      itemId: fixture.item.id,
      collectionRunId: collection.id,
      contentHash: "hash-v2",
      rawFormat: "HTML",
      rawContent: "<article>Version two raw HTML</article>",
      extractedText: "Codex can delegate with new per-agent controls.",
    });
    fixture.repository.finishCollectionRun(collection.id, {
      status: "SUCCEEDED",
      sourcesChecked: 1,
      itemsDiscovered: 1,
      itemsCreated: 0,
      snapshotsCreated: 1,
    });
    assert.equal(fixture.repository.pendingCandidates()[0].snapshotId, changed.row.id);

    const secondRun = fixture.repository.createAnalysisRun({
      windowStart: "2026-08-07T10:00:00.000Z",
      windowEnd: "2026-08-08T00:00:00.000Z",
      promptVersion: "v1",
    });
    const second = importEdition(fixture.repository, secondRun.id, "Delegation controls get more precise");
    assert.equal(second.newsletter.version, 2);
    assert.equal(fixture.repository.getNewsletterByDate("2026-08-07", 1)?.newsletter.status, "SUPERSEDED");
    assert.equal(fixture.repository.getNewsletterByDate("2026-08-07")?.newsletter.version, 2);
    assert.deepEqual(
      fixture.repository.listNewsletterVersions("2026-08-07").map((edition) => edition.version),
      [2, 1],
    );
  } finally {
    await cleanup(fixture);
  }
});

test("Fastify renders the stored homepage and enforces route-specific authentication", async () => {
  const fixture = await fixtureDatabase();
  const run = fixture.repository.createAnalysisRun({
    windowStart: "1970-01-01T00:00:00.000Z",
    windowEnd: "2026-08-08T00:00:00.000Z",
    promptVersion: "v1",
  });
  importEdition(fixture.repository, run.id);
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_PATH: path.join(fixture.directory, "unused.sqlite"),
    DASHBOARD_USERNAME: "radar",
    DASHBOARD_PASSWORD: "dashboard-password",
    AI_RADAR_ADMIN_TOKEN: "separate-admin-token",
  });
  const app = await buildApp({ env, database: fixture.database, logger: false });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/" })).statusCode, 401);
    const authorization = `Basic ${Buffer.from("radar:dashboard-password").toString("base64")}`;
    const home = await app.inject({ method: "GET", url: "/", headers: { authorization } });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Delegation becomes a first-class coding workflow/);
    assert.match(home.body, /Codex can delegate independent work/);
    assert.match(home.body, /You're caught up\./);
    const archive = await app.inject({
      method: "GET",
      url: "/archive",
      headers: { authorization },
    });
    assert.equal(archive.statusCode, 200);
    assert.match(archive.body, /Delegation becomes a first-class coding workflow/);
    const sources = await app.inject({
      method: "GET",
      url: "/sources?page=1",
      headers: { authorization },
    });
    assert.equal(sources.statusCode, 200);
    assert.match(sources.body, /Page 1/);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/sources?page=0",
          headers: { authorization },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/internal/status",
          headers: { authorization },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/internal/status",
          headers: { authorization: "Bearer separate-admin-token" },
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    await cleanup(fixture);
  }
});
