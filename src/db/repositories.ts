import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import type { SqliteDatabase } from "./connection.js";
import type {
  AnalysisRun,
  AnalysisRunRow,
  CollectionRun,
  CollectionRunRow,
  ContentItem,
  ContentItemRow,
  ContentSnapshot,
  ContentSnapshotRow,
  ContentStatus,
  CreateAnalysisRunInput,
  FinishCollectionRunInput,
  InsertContentSnapshotInput,
  InsertSourceSnapshotInput,
  ItemAssessment,
  ItemAssessmentRow,
  JsonObject,
  JsonValue,
  Newsletter,
  NewsletterEntry,
  NewsletterEntryRow,
  NewsletterImportInput,
  NewsletterRow,
  NewsletterView,
  PendingCandidate,
  PreviousAssessment,
  SeedSourceInput,
  Source,
  SourceItemFilters,
  SourceItemView,
  SourceRow,
  SourceSnapshot,
  SourceSnapshotRow,
  StartCollectionRunInput,
  StatusSummary,
  UpsertContentItemInput,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function stringifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

function inferWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function ensureNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RepositoryInvariantError(`${name} must be a non-negative integer.`);
  }
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    provider: row.provider,
    kind: row.kind,
    canonicalUrl: row.canonical_url,
    enabled: row.enabled === 1,
    config: parseJson<JsonObject>(row.config_json, {}),
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCollectionRun(row: CollectionRunRow): CollectionRun {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    sourcesChecked: row.sources_checked,
    itemsDiscovered: row.items_discovered,
    itemsCreated: row.items_created,
    snapshotsCreated: row.snapshots_created,
    errors: parseJson<JsonValue[]>(row.errors_json, []),
  };
}

function mapSourceSnapshot(row: SourceSnapshotRow): SourceSnapshot {
  return {
    id: row.id,
    sourceId: row.source_id,
    collectionRunId: row.collection_run_id,
    url: row.url,
    fetchedAt: row.fetched_at,
    httpStatus: row.http_status,
    contentType: row.content_type,
    contentHash: row.content_hash,
    rawBodyGzip: row.raw_body_gzip,
    etag: row.etag,
    lastModified: row.last_modified,
  };
}

function mapContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    identityKey: row.identity_key,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    kind: row.kind,
    title: row.title,
    author: row.author,
    publishedAt: row.published_at,
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
    contentStatus: row.content_status,
    currentSnapshotId: row.current_snapshot_id,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapContentSnapshot(row: ContentSnapshotRow): ContentSnapshot {
  return {
    id: row.id,
    itemId: row.item_id,
    collectionRunId: row.collection_run_id,
    sourceSnapshotId: row.source_snapshot_id,
    capturedAt: row.captured_at,
    contentHash: row.content_hash,
    rawFormat: row.raw_format,
    rawContentGzip: row.raw_content_gzip,
    extractedText: row.extracted_text,
    wordCount: row.word_count,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapAnalysisRun(row: AnalysisRunRow): AnalysisRun {
  return {
    id: row.id,
    status: row.status,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    modelName: row.model_name,
    reasoningEffort: row.reasoning_effort,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    errorMessage: row.error_message,
  };
}

function mapAssessment(row: ItemAssessmentRow): ItemAssessment {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    itemId: row.item_id,
    snapshotId: row.snapshot_id,
    disposition: row.disposition,
    importance: row.importance,
    category: row.category,
    confidence: row.confidence,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    keyPoints: parseJson<string[]>(row.key_points_json, []),
    caveats: parseJson<string[]>(row.caveats_json, []),
    createdAt: row.created_at,
  };
}

function mapNewsletter(row: NewsletterRow): Newsletter {
  return {
    id: row.id,
    newsletterDate: row.newsletter_date,
    version: row.version,
    analysisRunId: row.analysis_run_id,
    title: row.title,
    dek: row.dek,
    markdown: row.markdown,
    html: row.html,
    status: row.status,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
    supersedesId: row.supersedes_id,
  };
}

function mapNewsletterEntry(row: NewsletterEntryRow): NewsletterEntry {
  return {
    id: row.id,
    newsletterId: row.newsletter_id,
    section: row.section,
    rank: row.rank,
    headline: row.headline,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    caveats: parseJson<string[]>(row.caveats_json, []),
  };
}

export class RepositoryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryInvariantError";
  }
}

export class CollectionAlreadyRunningError extends Error {
  constructor(
    public readonly activeRunId: string,
    public readonly expiresAt: string,
  ) {
    super(`Collection run ${activeRunId} already holds the collection lock until ${expiresAt}.`);
    this.name = "CollectionAlreadyRunningError";
  }
}

export interface InsertResult<T> {
  row: T;
  created: boolean;
}

interface CandidateQueryRow {
  item_id: string;
  snapshot_id: string;
  provider: PendingCandidate["provider"];
  item_kind: PendingCandidate["itemKind"];
  title: string;
  author: string | null;
  published_at: string | null;
  canonical_url: string | null;
  metadata_json: string;
  extracted_text: string;
  content_status: ContentStatus;
  captured_at: string;
  content_hash: string;
}

interface PreviousAssessmentQueryRow {
  analysis_run_id: string;
  snapshot_id: string;
  disposition: PreviousAssessment["disposition"];
  importance: number | null;
  category: PreviousAssessment["category"];
  confidence: PreviousAssessment["confidence"];
  summary: string;
  why_it_matters: string;
  created_at: string;
}

export class RadarRepository {
  constructor(private readonly database: SqliteDatabase) {}

  seedSources(inputs: readonly SeedSourceInput[]): Source[] {
    const statement = this.database.prepare(`
      INSERT INTO source (
        id, slug, name, provider, kind, canonical_url, enabled, config_json,
        created_at, updated_at
      ) VALUES (
        @id, @slug, @name, @provider, @kind, @canonicalUrl, @enabled, @configJson,
        @now, @now
      )
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        provider = excluded.provider,
        kind = excluded.kind,
        canonical_url = excluded.canonical_url,
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
      RETURNING *
    `);

    return this.database.transaction((seeds: readonly SeedSourceInput[]) => {
      const timestamp = nowIso();
      return seeds.map((input) => {
        const row = statement.get({
          id: randomUUID(),
          slug: input.slug,
          name: input.name,
          provider: input.provider,
          kind: input.kind,
          canonicalUrl: input.canonicalUrl,
          enabled: input.enabled === false ? 0 : 1,
          configJson: stringifyJson(input.config ?? {}),
          now: timestamp,
        }) as SourceRow;
        return mapSource(row);
      });
    })(inputs);
  }

  listSources(options: { enabledOnly?: boolean } = {}): Source[] {
    const rows = options.enabledOnly
      ? (this.database.prepare("SELECT * FROM source WHERE enabled = 1 ORDER BY slug").all() as SourceRow[])
      : (this.database.prepare("SELECT * FROM source ORDER BY slug").all() as SourceRow[]);
    return rows.map(mapSource);
  }

  getSourceById(id: string): Source | null {
    const row = this.database.prepare("SELECT * FROM source WHERE id = ?").get(id) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  getSourceBySlug(slug: string): Source | null {
    const row = this.database.prepare("SELECT * FROM source WHERE slug = ?").get(slug) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  updateSourceStatus(
    sourceId: string,
    input: {
      checkedAt?: string;
      success?: boolean;
      successAt?: string;
      error?: string | null;
    },
  ): Source {
    const checkedAt = input.checkedAt ?? nowIso();
    const succeeded = input.success ?? input.successAt !== undefined;
    const row = succeeded
      ? (this.database.prepare(`
          UPDATE source
          SET last_checked_at = @checkedAt,
              last_success_at = @successAt,
              last_error = NULL,
              updated_at = @checkedAt
          WHERE id = @sourceId
          RETURNING *
        `).get({ sourceId, checkedAt, successAt: input.successAt ?? checkedAt }) as SourceRow | undefined)
      : (this.database.prepare(`
          UPDATE source
          SET last_checked_at = @checkedAt,
              last_error = @error,
              updated_at = @checkedAt
          WHERE id = @sourceId
          RETURNING *
        `).get({ sourceId, checkedAt, error: input.error ?? "Unknown source failure" }) as SourceRow | undefined);

    if (!row) {
      throw new RepositoryInvariantError(`Unknown source: ${sourceId}`);
    }
    return mapSource(row);
  }

  markSourceSucceeded(sourceId: string, checkedAt?: string): Source {
    return this.updateSourceStatus(sourceId, {
      success: true,
      checkedAt,
      successAt: checkedAt,
    });
  }

  markSourceFailed(sourceId: string, error: string, checkedAt?: string): Source {
    return this.updateSourceStatus(sourceId, { success: false, checkedAt, error });
  }

  startCollectionRun(input: StartCollectionRunInput): CollectionRun {
    const ttlMs = input.lockTtlMs ?? 30 * 60 * 1_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new RepositoryInvariantError("lockTtlMs must be a positive integer.");
    }

    return this.database.transaction(() => {
      const startedAt = input.startedAt ?? nowIso();
      const expiresAt = new Date(Date.parse(startedAt) + ttlMs).toISOString();
      this.database.prepare(`
        DELETE FROM collection_lock
        WHERE expires_at <= @startedAt
           OR NOT EXISTS (
             SELECT 1 FROM collection_run
             WHERE collection_run.id = collection_lock.owner_run_id
               AND collection_run.status = 'RUNNING'
           )
      `).run({ startedAt });

      const active = this.database.prepare(`
        SELECT owner_run_id, expires_at
        FROM collection_lock
        WHERE lock_name = 'collection'
      `).get() as { owner_run_id: string; expires_at: string } | undefined;
      if (active) {
        throw new CollectionAlreadyRunningError(active.owner_run_id, active.expires_at);
      }

      const runId = randomUUID();
      const row = this.database.prepare(`
        INSERT INTO collection_run (
          id, "trigger", status, started_at, completed_at, sources_checked,
          items_discovered, items_created, snapshots_created, errors_json
        ) VALUES (@id, @trigger, 'RUNNING', @startedAt, NULL, 0, 0, 0, 0, '[]')
        RETURNING *
      `).get({ id: runId, trigger: input.trigger, startedAt }) as CollectionRunRow;

      this.database.prepare(`
        INSERT INTO collection_lock (lock_name, owner_run_id, acquired_at, expires_at)
        VALUES ('collection', @runId, @startedAt, @expiresAt)
      `).run({ runId, startedAt, expiresAt });
      return mapCollectionRun(row);
    })();
  }

  refreshCollectionLock(runId: string, lockTtlMs = 30 * 60 * 1_000): boolean {
    if (!Number.isSafeInteger(lockTtlMs) || lockTtlMs <= 0) {
      throw new RepositoryInvariantError("lockTtlMs must be a positive integer.");
    }
    const refreshedAt = nowIso();
    const expiresAt = new Date(Date.parse(refreshedAt) + lockTtlMs).toISOString();
    const result = this.database.prepare(`
      UPDATE collection_lock
      SET expires_at = @expiresAt
      WHERE lock_name = 'collection' AND owner_run_id = @runId
    `).run({ runId, expiresAt });
    return result.changes === 1;
  }

  releaseCollectionLock(runId: string): boolean {
    return this.database.prepare(`
      DELETE FROM collection_lock
      WHERE lock_name = 'collection' AND owner_run_id = ?
    `).run(runId).changes === 1;
  }

  finishCollectionRun(runId: string, input: FinishCollectionRunInput): CollectionRun {
    for (const [name, value] of Object.entries({
      sourcesChecked: input.sourcesChecked,
      itemsDiscovered: input.itemsDiscovered,
      itemsCreated: input.itemsCreated,
      snapshotsCreated: input.snapshotsCreated,
    })) {
      ensureNonNegativeInteger(value, name);
    }

    return this.database.transaction(() => {
      const row = this.database.prepare(`
        UPDATE collection_run
        SET status = @status,
            completed_at = @completedAt,
            sources_checked = @sourcesChecked,
            items_discovered = @itemsDiscovered,
            items_created = @itemsCreated,
            snapshots_created = @snapshotsCreated,
            errors_json = @errorsJson
        WHERE id = @runId AND status = 'RUNNING'
        RETURNING *
      `).get({
        runId,
        status: input.status,
        completedAt: input.completedAt ?? nowIso(),
        sourcesChecked: input.sourcesChecked,
        itemsDiscovered: input.itemsDiscovered,
        itemsCreated: input.itemsCreated,
        snapshotsCreated: input.snapshotsCreated,
        errorsJson: stringifyJson(input.errors ?? []),
      }) as CollectionRunRow | undefined;
      if (!row) {
        throw new RepositoryInvariantError(`Collection run ${runId} is missing or no longer running.`);
      }
      this.releaseCollectionLock(runId);
      return mapCollectionRun(row);
    })();
  }

  getCollectionRun(runId: string): CollectionRun | null {
    const row = this.database.prepare("SELECT * FROM collection_run WHERE id = ?").get(runId) as
      | CollectionRunRow
      | undefined;
    return row ? mapCollectionRun(row) : null;
  }

  getLatestCollectionRun(status?: Exclude<CollectionRun["status"], "RUNNING">): CollectionRun | null {
    const row = status
      ? (this.database.prepare(`
          SELECT * FROM collection_run WHERE status = ? ORDER BY started_at DESC LIMIT 1
        `).get(status) as CollectionRunRow | undefined)
      : (this.database.prepare(`
          SELECT * FROM collection_run ORDER BY started_at DESC LIMIT 1
        `).get() as CollectionRunRow | undefined);
    return row ? mapCollectionRun(row) : null;
  }

  insertSourceSnapshot(input: InsertSourceSnapshotInput): InsertResult<SourceSnapshot> {
    const id = randomUUID();
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO source_snapshot (
        id, source_id, collection_run_id, url, fetched_at, http_status,
        content_type, content_hash, raw_body_gzip, etag, last_modified
      ) VALUES (
        @id, @sourceId, @collectionRunId, @url, @fetchedAt, @httpStatus,
        @contentType, @contentHash, @rawBodyGzip, @etag, @lastModified
      )
    `).run({
      id,
      sourceId: input.sourceId,
      collectionRunId: input.collectionRunId,
      url: input.url,
      fetchedAt: input.fetchedAt ?? nowIso(),
      httpStatus: input.httpStatus,
      contentType: input.contentType ?? null,
      contentHash: input.contentHash,
      rawBodyGzip: gzipSync(asBuffer(input.rawBody)),
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
    });

    const row = this.database.prepare(`
      SELECT * FROM source_snapshot WHERE source_id = ? AND content_hash = ?
    `).get(input.sourceId, input.contentHash) as SourceSnapshotRow | undefined;
    if (!row) {
      throw new RepositoryInvariantError("Source snapshot insert did not produce a readable row.");
    }
    return { row: mapSourceSnapshot(row), created: result.changes === 1 };
  }

  getSourceSnapshot(snapshotId: string): SourceSnapshot | null {
    const row = this.database.prepare("SELECT * FROM source_snapshot WHERE id = ?").get(snapshotId) as
      | SourceSnapshotRow
      | undefined;
    return row ? mapSourceSnapshot(row) : null;
  }

  getLatestSourceSnapshot(sourceId: string): SourceSnapshot | null {
    const row = this.database.prepare(`
      SELECT * FROM source_snapshot WHERE source_id = ? ORDER BY fetched_at DESC LIMIT 1
    `).get(sourceId) as SourceSnapshotRow | undefined;
    return row ? mapSourceSnapshot(row) : null;
  }

  readSourceSnapshotBody(snapshotId: string): Buffer | null {
    const row = this.database.prepare(`
      SELECT raw_body_gzip FROM source_snapshot WHERE id = ?
    `).get(snapshotId) as { raw_body_gzip: Buffer } | undefined;
    return row ? gunzipSync(row.raw_body_gzip) : null;
  }

  upsertContentItem(input: UpsertContentItemInput): InsertResult<ContentItem> {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT * FROM content_item WHERE identity_key = ?
      `).get(input.identityKey) as ContentItemRow | undefined;
      const timestamp = input.lastSeenAt ?? nowIso();

      if (existing && existing.source_id !== input.sourceId) {
        throw new RepositoryInvariantError(
          `Identity key ${input.identityKey} already belongs to source ${existing.source_id}.`,
        );
      }

      if (!existing) {
        const row = this.database.prepare(`
          INSERT INTO content_item (
            id, source_id, identity_key, external_id, canonical_url, kind, title,
            author, published_at, discovered_at, last_seen_at, content_status,
            current_snapshot_id, metadata_json
          ) VALUES (
            @id, @sourceId, @identityKey, @externalId, @canonicalUrl, @kind, @title,
            @author, @publishedAt, @discoveredAt, @lastSeenAt, 'DISCOVERED',
            NULL, @metadataJson
          )
          RETURNING *
        `).get({
          id: randomUUID(),
          sourceId: input.sourceId,
          identityKey: input.identityKey,
          externalId: input.externalId ?? null,
          canonicalUrl: input.canonicalUrl ?? null,
          kind: input.kind,
          title: input.title,
          author: input.author ?? null,
          publishedAt: input.publishedAt ?? null,
          discoveredAt: input.discoveredAt ?? timestamp,
          lastSeenAt: timestamp,
          metadataJson: stringifyJson(input.metadata ?? {}),
        }) as ContentItemRow;
        return { row: mapContentItem(row), created: true };
      }

      const row = this.database.prepare(`
        UPDATE content_item
        SET external_id = @externalId,
            canonical_url = @canonicalUrl,
            kind = @kind,
            title = @title,
            author = @author,
            published_at = @publishedAt,
            last_seen_at = @lastSeenAt,
            metadata_json = @metadataJson
        WHERE id = @id
        RETURNING *
      `).get({
        id: existing.id,
        externalId: input.externalId ?? null,
        canonicalUrl: input.canonicalUrl ?? null,
        kind: input.kind,
        title: input.title,
        author: input.author ?? null,
        publishedAt: input.publishedAt ?? null,
        lastSeenAt: timestamp,
        metadataJson: stringifyJson(input.metadata ?? {}),
      }) as ContentItemRow;
      return { row: mapContentItem(row), created: false };
    })();
  }

  getContentItem(itemId: string): ContentItem | null {
    const row = this.database.prepare("SELECT * FROM content_item WHERE id = ?").get(itemId) as
      | ContentItemRow
      | undefined;
    return row ? mapContentItem(row) : null;
  }

  getContentItemByIdentityKey(identityKey: string): ContentItem | null {
    const row = this.database.prepare(`
      SELECT * FROM content_item WHERE identity_key = ?
    `).get(identityKey) as ContentItemRow | undefined;
    return row ? mapContentItem(row) : null;
  }

  updateContentStatus(itemId: string, status: ContentStatus): ContentItem {
    const row = this.database.prepare(`
      UPDATE content_item SET content_status = @status WHERE id = @itemId RETURNING *
    `).get({ itemId, status }) as ContentItemRow | undefined;
    if (!row) {
      throw new RepositoryInvariantError(`Unknown content item: ${itemId}`);
    }
    return mapContentItem(row);
  }

  insertContentSnapshot(input: InsertContentSnapshotInput): InsertResult<ContentSnapshot> {
    return this.database.transaction(() => {
      const id = randomUUID();
      const result = this.database.prepare(`
        INSERT OR IGNORE INTO content_snapshot (
          id, item_id, collection_run_id, source_snapshot_id, captured_at,
          content_hash, raw_format, raw_content_gzip, extracted_text, word_count,
          metadata_json
        ) VALUES (
          @id, @itemId, @collectionRunId, @sourceSnapshotId, @capturedAt,
          @contentHash, @rawFormat, @rawContentGzip, @extractedText, @wordCount,
          @metadataJson
        )
      `).run({
        id,
        itemId: input.itemId,
        collectionRunId: input.collectionRunId,
        sourceSnapshotId: input.sourceSnapshotId ?? null,
        capturedAt: input.capturedAt ?? nowIso(),
        contentHash: input.contentHash,
        rawFormat: input.rawFormat,
        rawContentGzip: gzipSync(asBuffer(input.rawContent)),
        extractedText: input.extractedText,
        wordCount: input.wordCount ?? inferWordCount(input.extractedText),
        metadataJson: stringifyJson(input.metadata ?? {}),
      });

      const row = this.database.prepare(`
        SELECT * FROM content_snapshot WHERE item_id = ? AND content_hash = ?
      `).get(input.itemId, input.contentHash) as ContentSnapshotRow | undefined;
      if (!row) {
        throw new RepositoryInvariantError("Content snapshot insert did not produce a readable row.");
      }

      const itemUpdate = this.database.prepare(`
        UPDATE content_item
        SET current_snapshot_id = @snapshotId,
            content_status = @contentStatus
        WHERE id = @itemId
      `).run({
        snapshotId: row.id,
        itemId: input.itemId,
        contentStatus: input.contentStatus ?? "FETCHED",
      });
      if (itemUpdate.changes !== 1) {
        throw new RepositoryInvariantError(`Unknown content item: ${input.itemId}`);
      }

      return { row: mapContentSnapshot(row), created: result.changes === 1 };
    })();
  }

  getContentSnapshot(snapshotId: string): ContentSnapshot | null {
    const row = this.database.prepare("SELECT * FROM content_snapshot WHERE id = ?").get(snapshotId) as
      | ContentSnapshotRow
      | undefined;
    return row ? mapContentSnapshot(row) : null;
  }

  getCurrentContentSnapshot(itemId: string): ContentSnapshot | null {
    const row = this.database.prepare(`
      SELECT cs.*
      FROM content_item ci
      JOIN content_snapshot cs ON cs.id = ci.current_snapshot_id
      WHERE ci.id = ?
    `).get(itemId) as ContentSnapshotRow | undefined;
    return row ? mapContentSnapshot(row) : null;
  }

  listContentSnapshots(itemId: string): ContentSnapshot[] {
    const rows = this.database.prepare(`
      SELECT * FROM content_snapshot WHERE item_id = ? ORDER BY captured_at DESC
    `).all(itemId) as ContentSnapshotRow[];
    return rows.map(mapContentSnapshot);
  }

  readContentSnapshotBody(snapshotId: string): Buffer | null {
    const row = this.database.prepare(`
      SELECT raw_content_gzip FROM content_snapshot WHERE id = ?
    `).get(snapshotId) as { raw_content_gzip: Buffer } | undefined;
    return row ? gunzipSync(row.raw_content_gzip) : null;
  }

  getContentSnapshotText(itemId: string, snapshotId: string): string | null {
    const row = this.database.prepare(`
      SELECT extracted_text FROM content_snapshot WHERE id = ? AND item_id = ?
    `).get(snapshotId, itemId) as { extracted_text: string } | undefined;
    return row?.extracted_text ?? null;
  }

  pendingCandidates(): PendingCandidate[] {
    const rows = this.database.prepare(`
      SELECT
        ci.id AS item_id,
        cs.id AS snapshot_id,
        s.provider,
        ci.kind AS item_kind,
        ci.title,
        ci.author,
        ci.published_at,
        ci.canonical_url,
        ci.metadata_json,
        cs.extracted_text,
        ci.content_status,
        cs.captured_at,
        cs.content_hash
      FROM content_item ci
      JOIN content_snapshot cs ON cs.id = ci.current_snapshot_id
      JOIN source s ON s.id = ci.source_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM item_assessment ia
        JOIN analysis_run ar ON ar.id = ia.analysis_run_id
        WHERE ia.snapshot_id = cs.id AND ar.status = 'SUCCEEDED'
      )
      ORDER BY COALESCE(ci.published_at, cs.captured_at), ci.id
    `).all() as CandidateQueryRow[];
    return rows.map((row) => this.mapPendingCandidate(row));
  }

  countPendingCandidates(): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM content_item ci
      JOIN content_snapshot cs ON cs.id = ci.current_snapshot_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM item_assessment ia
        JOIN analysis_run ar ON ar.id = ia.analysis_run_id
        WHERE ia.snapshot_id = cs.id AND ar.status = 'SUCCEEDED'
      )
    `).get() as { count: number };
    return row.count;
  }

  createAnalysisRun(input: CreateAnalysisRunInput): AnalysisRun {
    return this.database.transaction(() => {
      const startedAt = input.startedAt ?? nowIso();
      const id = randomUUID();
      const row = this.database.prepare(`
        INSERT INTO analysis_run (
          id, status, window_start, window_end, started_at, completed_at,
          model_name, reasoning_effort, prompt_version, input_hash, error_message
        ) VALUES (
          @id, 'RUNNING', @windowStart, @windowEnd, @startedAt, NULL,
          @modelName, @reasoningEffort, @promptVersion, @inputHash, NULL
        )
        RETURNING *
      `).get({
        id,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        startedAt,
        modelName: input.modelName ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash ?? null,
      }) as AnalysisRunRow;

      const candidates = this.database.prepare(`
        SELECT ci.id AS item_id, cs.id AS snapshot_id
        FROM content_item ci
        JOIN content_snapshot cs ON cs.id = ci.current_snapshot_id
        WHERE cs.captured_at <= @windowEnd
          AND NOT EXISTS (
            SELECT 1
            FROM item_assessment ia
            JOIN analysis_run ar ON ar.id = ia.analysis_run_id
            WHERE ia.snapshot_id = cs.id AND ar.status = 'SUCCEEDED'
          )
        ORDER BY COALESCE(ci.published_at, cs.captured_at), ci.id
      `).all({ windowEnd: input.windowEnd }) as Array<{ item_id: string; snapshot_id: string }>;
      const insertCandidate = this.database.prepare(`
        INSERT INTO analysis_run_candidate (analysis_run_id, item_id, snapshot_id)
        VALUES (@analysisRunId, @itemId, @snapshotId)
      `);
      for (const candidate of candidates) {
        insertCandidate.run({
          analysisRunId: id,
          itemId: candidate.item_id,
          snapshotId: candidate.snapshot_id,
        });
      }
      return mapAnalysisRun(row);
    })();
  }

  getAnalysisRun(runId: string): AnalysisRun | null {
    const row = this.database.prepare("SELECT * FROM analysis_run WHERE id = ?").get(runId) as
      | AnalysisRunRow
      | undefined;
    return row ? mapAnalysisRun(row) : null;
  }

  getLatestAnalysisRun(): AnalysisRun | null {
    const row = this.database.prepare(`
      SELECT * FROM analysis_run ORDER BY started_at DESC LIMIT 1
    `).get() as AnalysisRunRow | undefined;
    return row ? mapAnalysisRun(row) : null;
  }

  listAnalysisRunCandidates(runId: string): PendingCandidate[] {
    const rows = this.database.prepare(`
      SELECT
        arc.item_id,
        arc.snapshot_id,
        s.provider,
        ci.kind AS item_kind,
        ci.title,
        ci.author,
        ci.published_at,
        ci.canonical_url,
        ci.metadata_json,
        cs.extracted_text,
        ci.content_status,
        cs.captured_at,
        cs.content_hash
      FROM analysis_run_candidate arc
      JOIN content_item ci ON ci.id = arc.item_id
      JOIN content_snapshot cs ON cs.id = arc.snapshot_id
      JOIN source s ON s.id = ci.source_id
      WHERE arc.analysis_run_id = ?
      ORDER BY COALESCE(ci.published_at, cs.captured_at), ci.id
    `).all(runId) as CandidateQueryRow[];
    return rows.map((row) => this.mapPendingCandidate(row));
  }

  updateAnalysisRunInputHash(runId: string, inputHash: string): AnalysisRun {
    const row = this.database.prepare(`
      UPDATE analysis_run
      SET input_hash = @inputHash
      WHERE id = @runId AND status = 'RUNNING'
      RETURNING *
    `).get({ runId, inputHash }) as AnalysisRunRow | undefined;
    if (!row) {
      throw new RepositoryInvariantError(`Analysis run ${runId} is missing or no longer running.`);
    }
    return mapAnalysisRun(row);
  }

  markAnalysisRunFailed(runId: string, error: string, completedAt = nowIso()): AnalysisRun {
    const row = this.database.prepare(`
      UPDATE analysis_run
      SET status = 'FAILED', completed_at = @completedAt, error_message = @error
      WHERE id = @runId AND status = 'RUNNING'
      RETURNING *
    `).get({ runId, completedAt, error }) as AnalysisRunRow | undefined;
    if (!row) {
      throw new RepositoryInvariantError(`Analysis run ${runId} is missing or no longer running.`);
    }
    return mapAnalysisRun(row);
  }

  failAnalysisRun(runId: string, error: string, completedAt?: string): AnalysisRun {
    return this.markAnalysisRunFailed(runId, error, completedAt);
  }

  importNewsletter(input: NewsletterImportInput): NewsletterView {
    return this.database.transaction(() => {
      const run = this.database.prepare(`
        SELECT * FROM analysis_run WHERE id = ?
      `).get(input.analysisRunId) as AnalysisRunRow | undefined;
      if (!run || run.status !== "RUNNING") {
        throw new RepositoryInvariantError(
          `Analysis run ${input.analysisRunId} is missing or no longer running.`,
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.editionDate)) {
        throw new RepositoryInvariantError("editionDate must use YYYY-MM-DD format.");
      }

      const frozen = this.database.prepare(`
        SELECT item_id, snapshot_id
        FROM analysis_run_candidate
        WHERE analysis_run_id = ?
        ORDER BY item_id
      `).all(input.analysisRunId) as Array<{ item_id: string; snapshot_id: string }>;
      const frozenKeys = frozen.map((value) => `${value.item_id}\u0000${value.snapshot_id}`).sort();
      const expectedKeys = input.expectedCandidates
        .map((value) => `${value.itemId}\u0000${value.snapshotId}`)
        .sort();
      const assessmentKeys = input.assessments
        .map((value) => `${value.itemId}\u0000${value.snapshotId}`)
        .sort();
      this.assertExactKeys("expected candidate bundle", frozenKeys, expectedKeys);
      this.assertExactKeys("assessment set", frozenKeys, assessmentKeys);

      const assessmentIds = new Map<string, { id: string; disposition: ItemAssessment["disposition"] }>();
      const insertedAt = nowIso();
      const insertAssessment = this.database.prepare(`
        INSERT INTO item_assessment (
          id, analysis_run_id, item_id, snapshot_id, disposition, importance,
          category, confidence, summary, why_it_matters, key_points_json,
          caveats_json, created_at
        ) VALUES (
          @id, @analysisRunId, @itemId, @snapshotId, @disposition, @importance,
          @category, @confidence, @summary, @whyItMatters, @keyPointsJson,
          @caveatsJson, @createdAt
        )
      `);
      for (const assessment of input.assessments) {
        if (assessmentIds.has(assessment.itemId)) {
          throw new RepositoryInvariantError(`Duplicate assessment for item ${assessment.itemId}.`);
        }
        const snapshot = this.database.prepare(`
          SELECT 1 FROM content_snapshot WHERE id = ? AND item_id = ?
        `).get(assessment.snapshotId, assessment.itemId);
        if (!snapshot) {
          throw new RepositoryInvariantError(
            `Snapshot ${assessment.snapshotId} does not belong to item ${assessment.itemId}.`,
          );
        }
        const assessmentId = randomUUID();
        insertAssessment.run({
          id: assessmentId,
          analysisRunId: input.analysisRunId,
          itemId: assessment.itemId,
          snapshotId: assessment.snapshotId,
          disposition: assessment.disposition,
          importance: assessment.importance,
          category: assessment.category,
          confidence: assessment.confidence,
          summary: assessment.summary,
          whyItMatters: assessment.whyItMatters,
          keyPointsJson: stringifyJson(assessment.keyPoints),
          caveatsJson: stringifyJson(assessment.caveats),
          createdAt: insertedAt,
        });
        assessmentIds.set(assessment.itemId, {
          id: assessmentId,
          disposition: assessment.disposition,
        });
      }

      for (const entry of input.entries) {
        const uniqueSourceIds = new Set(entry.sourceItemIds);
        if (entry.sourceItemIds.length === 0 || uniqueSourceIds.size !== entry.sourceItemIds.length) {
          throw new RepositoryInvariantError(
            `Newsletter entry "${entry.headline}" must contain unique source item IDs.`,
          );
        }
        const sources = entry.sourceItemIds.map((itemId) => {
          const assessment = assessmentIds.get(itemId);
          if (!assessment) {
            throw new RepositoryInvariantError(
              `Newsletter entry "${entry.headline}" references unassessed item ${itemId}.`,
            );
          }
          return assessment;
        });
        if (sources.every((source) => source.disposition === "ARCHIVE")) {
          throw new RepositoryInvariantError(
            `Newsletter entry "${entry.headline}" references only archived items.`,
          );
        }
      }

      const previous = this.database.prepare(`
        SELECT * FROM newsletter
        WHERE newsletter_date = ?
        ORDER BY version DESC
        LIMIT 1
      `).get(input.editionDate) as NewsletterRow | undefined;
      if (previous) {
        this.database.prepare(`
          UPDATE newsletter
          SET status = 'SUPERSEDED'
          WHERE newsletter_date = ? AND status <> 'SUPERSEDED'
        `).run(input.editionDate);
      }

      const generatedAt = input.generatedAt ?? nowIso();
      const status = input.status ?? "PUBLISHED";
      const newsletterId = randomUUID();
      this.database.prepare(`
        INSERT INTO newsletter (
          id, newsletter_date, version, analysis_run_id, title, dek, markdown,
          html, status, generated_at, published_at, supersedes_id
        ) VALUES (
          @id, @newsletterDate, @version, @analysisRunId, @title, @dek, @markdown,
          @html, @status, @generatedAt, @publishedAt, @supersedesId
        )
      `).run({
        id: newsletterId,
        newsletterDate: input.editionDate,
        version: (previous?.version ?? 0) + 1,
        analysisRunId: input.analysisRunId,
        title: input.title,
        dek: input.dek,
        markdown: input.markdown,
        html: input.html,
        status,
        generatedAt,
        publishedAt: status === "PUBLISHED" ? (input.publishedAt ?? generatedAt) : (input.publishedAt ?? null),
        supersedesId: previous?.id ?? null,
      });

      const insertEntry = this.database.prepare(`
        INSERT INTO newsletter_entry (
          id, newsletter_id, section, rank, headline, summary, why_it_matters,
          caveats_json
        ) VALUES (
          @id, @newsletterId, @section, @rank, @headline, @summary, @whyItMatters,
          @caveatsJson
        )
      `);
      const insertEntrySource = this.database.prepare(`
        INSERT INTO newsletter_entry_source (newsletter_entry_id, item_id, assessment_id)
        VALUES (@entryId, @itemId, @assessmentId)
      `);
      for (const entry of input.entries) {
        const entryId = randomUUID();
        insertEntry.run({
          id: entryId,
          newsletterId,
          section: entry.section,
          rank: entry.rank,
          headline: entry.headline,
          summary: entry.summary,
          whyItMatters: entry.whyItMatters,
          caveatsJson: stringifyJson(entry.caveats),
        });
        for (const itemId of entry.sourceItemIds) {
          const assessment = assessmentIds.get(itemId);
          if (!assessment) {
            throw new RepositoryInvariantError(`Missing assessment for source item ${itemId}.`);
          }
          insertEntrySource.run({ entryId, itemId, assessmentId: assessment.id });
        }
      }

      const completed = this.database.prepare(`
        UPDATE analysis_run
        SET status = 'SUCCEEDED', completed_at = @completedAt, error_message = NULL
        WHERE id = @runId AND status = 'RUNNING'
      `).run({ runId: input.analysisRunId, completedAt: nowIso() });
      if (completed.changes !== 1) {
        throw new RepositoryInvariantError(`Could not complete analysis run ${input.analysisRunId}.`);
      }

      const view = this.getNewsletterById(newsletterId);
      if (!view) {
        throw new RepositoryInvariantError(`Could not read imported newsletter ${newsletterId}.`);
      }
      return view;
    })();
  }

  private mapPendingCandidate(row: CandidateQueryRow): PendingCandidate {
    const metadata = parseJson<JsonObject>(row.metadata_json, {});
    const description = typeof metadata.description === "string" ? metadata.description : null;
    const quality: PendingCandidate["contentQuality"] =
      row.content_status === "TRANSCRIPT_UNAVAILABLE"
        ? "TRANSCRIPT_UNAVAILABLE"
        : row.content_status === "FETCH_FAILED"
          ? "FETCH_FAILED"
          : row.extracted_text.trim().length < 80
            ? "METADATA_ONLY"
            : "FULL_TEXT";
    const previousRows = this.database.prepare(`
      SELECT
        ia.analysis_run_id,
        ia.snapshot_id,
        ia.disposition,
        ia.importance,
        ia.category,
        ia.confidence,
        ia.summary,
        ia.why_it_matters,
        ia.created_at
      FROM item_assessment ia
      JOIN analysis_run ar ON ar.id = ia.analysis_run_id
      WHERE ia.item_id = @itemId
        AND ia.snapshot_id <> @snapshotId
        AND ar.status = 'SUCCEEDED'
      ORDER BY ia.created_at DESC
      LIMIT 5
    `).all({ itemId: row.item_id, snapshotId: row.snapshot_id }) as PreviousAssessmentQueryRow[];

    return {
      itemId: row.item_id,
      snapshotId: row.snapshot_id,
      provider: row.provider,
      itemKind: row.item_kind,
      title: row.title,
      author: row.author,
      publishedAt: row.published_at,
      canonicalUrl: row.canonical_url,
      description,
      cleanedContent: row.extracted_text,
      contentQuality: quality,
      capturedAt: row.captured_at,
      contentHash: row.content_hash,
      previousAssessments: previousRows.map((previous) => ({
        analysisRunId: previous.analysis_run_id,
        snapshotId: previous.snapshot_id,
        disposition: previous.disposition,
        importance: previous.importance,
        category: previous.category,
        confidence: previous.confidence,
        summary: previous.summary,
        whyItMatters: previous.why_it_matters,
        createdAt: previous.created_at,
      })),
    };
  }

  private assertExactKeys(label: string, expected: readonly string[], actual: readonly string[]): void {
    const unique = new Set(actual);
    if (
      unique.size !== actual.length ||
      expected.length !== actual.length ||
      expected.some((value, index) => value !== actual[index])
    ) {
      throw new RepositoryInvariantError(`${label} does not match the frozen analysis candidate set.`);
    }
  }

  getNewsletterById(newsletterId: string): NewsletterView | null {
    const row = this.database.prepare("SELECT * FROM newsletter WHERE id = ?").get(newsletterId) as
      | NewsletterRow
      | undefined;
    return row ? this.buildNewsletterView(row) : null;
  }

  getLatestPublishedNewsletter(): NewsletterView | null {
    const row = this.database.prepare(`
      SELECT * FROM newsletter
      WHERE status = 'PUBLISHED'
      ORDER BY newsletter_date DESC, version DESC
      LIMIT 1
    `).get() as NewsletterRow | undefined;
    return row ? this.buildNewsletterView(row) : null;
  }

  getNewsletterByDate(newsletterDate: string, version?: number): NewsletterView | null {
    const row = version === undefined
      ? (this.database.prepare(`
          SELECT * FROM newsletter
          WHERE newsletter_date = ? AND status = 'PUBLISHED'
          ORDER BY version DESC LIMIT 1
        `).get(newsletterDate) as NewsletterRow | undefined)
      : (this.database.prepare(`
          SELECT * FROM newsletter WHERE newsletter_date = ? AND version = ?
        `).get(newsletterDate, version) as NewsletterRow | undefined);
    return row ? this.buildNewsletterView(row) : null;
  }

  listNewsletterVersions(newsletterDate: string): Newsletter[] {
    const rows = this.database.prepare(`
      SELECT * FROM newsletter
      WHERE newsletter_date = ?
      ORDER BY version DESC
    `).all(newsletterDate) as NewsletterRow[];
    return rows.map(mapNewsletter);
  }

  listNewsletterArchive(options: { limit?: number; offset?: number } = {}): Newsletter[] {
    const offset = Math.max(options.offset ?? 0, 0);
    const rows = options.limit === undefined
      ? (this.database.prepare(`
          SELECT * FROM newsletter
          WHERE status = 'PUBLISHED'
          ORDER BY newsletter_date DESC, version DESC
          LIMIT -1 OFFSET ?
        `).all(offset) as NewsletterRow[])
      : (this.database.prepare(`
          SELECT * FROM newsletter
          WHERE status = 'PUBLISHED'
          ORDER BY newsletter_date DESC, version DESC
          LIMIT ? OFFSET ?
        `).all(Math.min(Math.max(options.limit, 1), 200), offset) as NewsletterRow[]);
    return rows.map(mapNewsletter);
  }

  listSourceItems(filters: SourceItemFilters = {}): SourceItemView[] {
    const where: string[] = [];
    const parameters: Record<string, string | number> = {
      limit: Math.min(Math.max(filters.limit ?? 100, 1), 200),
      offset: Math.max(filters.offset ?? 0, 0),
    };
    if (filters.provider) {
      where.push("s.provider = @provider");
      parameters.provider = filters.provider;
    }
    if (filters.kind) {
      where.push("ci.kind = @kind");
      parameters.kind = filters.kind;
    }
    if (filters.publishedFrom) {
      where.push("ci.published_at >= @publishedFrom");
      parameters.publishedFrom = filters.publishedFrom;
    }
    if (filters.publishedTo) {
      where.push("ci.published_at <= @publishedTo");
      parameters.publishedTo = filters.publishedTo;
    }
    if (filters.disposition) {
      where.push("ia.disposition = @disposition");
      parameters.disposition = filters.disposition;
    }

    const rows = this.database.prepare(`
      SELECT
        ci.id AS item_id,
        ci.title,
        s.provider,
        ci.kind AS item_kind,
        ci.published_at,
        ci.canonical_url,
        cs.captured_at,
        ia.disposition,
        ia.summary AS assessment_summary,
        ci.content_status
      FROM content_item ci
      JOIN source s ON s.id = ci.source_id
      LEFT JOIN content_snapshot cs ON cs.id = ci.current_snapshot_id
      LEFT JOIN item_assessment ia ON ia.id = (
        SELECT ia2.id
        FROM item_assessment ia2
        JOIN analysis_run ar2 ON ar2.id = ia2.analysis_run_id
        WHERE ia2.item_id = ci.id AND ar2.status = 'SUCCEEDED'
        ORDER BY ia2.created_at DESC
        LIMIT 1
      )
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(ci.published_at, ci.discovered_at) DESC, ci.id
      LIMIT @limit OFFSET @offset
    `).all(parameters) as Array<{
      item_id: string;
      title: string;
      provider: SourceItemView["provider"];
      item_kind: SourceItemView["itemKind"];
      published_at: string | null;
      canonical_url: string | null;
      captured_at: string | null;
      disposition: SourceItemView["disposition"];
      assessment_summary: string | null;
      content_status: SourceItemView["contentStatus"];
    }>;

    return rows.map((row) => ({
      itemId: row.item_id,
      title: row.title,
      provider: row.provider,
      itemKind: row.item_kind,
      publishedAt: row.published_at,
      canonicalUrl: row.canonical_url,
      capturedAt: row.captured_at,
      disposition: row.disposition,
      assessmentSummary: row.assessment_summary,
      contentStatus: row.content_status,
    }));
  }

  getStatusSummary(): StatusSummary {
    const latestProblemRow = this.database.prepare(`
      SELECT * FROM collection_run
      WHERE status IN ('PARTIAL', 'FAILED')
      ORDER BY started_at DESC LIMIT 1
    `).get() as CollectionRunRow | undefined;
    const sourceFailureRows = this.database.prepare(`
      SELECT * FROM source
      WHERE enabled = 1 AND last_error IS NOT NULL
      ORDER BY slug
    `).all() as SourceRow[];

    return {
      latestCollectionRun: this.getLatestCollectionRun(),
      latestSuccessfulCollectionRun: this.getLatestCollectionRun("SUCCEEDED"),
      latestProblemCollectionRun: latestProblemRow ? mapCollectionRun(latestProblemRow) : null,
      latestAnalysisRun: this.getLatestAnalysisRun(),
      latestNewsletter: this.getLatestPublishedNewsletter()?.newsletter ?? null,
      pendingCandidateCount: this.countPendingCandidates(),
      sourceFailures: sourceFailureRows.map(mapSource),
    };
  }

  private buildNewsletterView(row: NewsletterRow): NewsletterView {
    const entryRows = this.database.prepare(`
      SELECT * FROM newsletter_entry
      WHERE newsletter_id = ?
      ORDER BY CASE section
        WHEN 'IMPORTANT' THEN 1
        WHEN 'WORTH_KNOWING' THEN 2
        WHEN 'FROM_YOUTUBE' THEN 3
        WHEN 'WATCHLIST' THEN 4
      END, rank, id
    `).all(row.id) as NewsletterEntryRow[];
    const sourceStatement = this.database.prepare(`
      SELECT
        nes.item_id,
        nes.assessment_id,
        ci.title,
        ci.canonical_url,
        s.provider,
        ia.disposition,
        ia.summary AS assessment_summary
      FROM newsletter_entry_source nes
      JOIN content_item ci ON ci.id = nes.item_id
      JOIN source s ON s.id = ci.source_id
      JOIN item_assessment ia ON ia.id = nes.assessment_id
      WHERE nes.newsletter_entry_id = ?
      ORDER BY ci.id
    `);
    const entries = entryRows.map((entryRow) => {
      const sourceRows = sourceStatement.all(entryRow.id) as Array<{
        item_id: string;
        assessment_id: string;
        title: string;
        canonical_url: string | null;
        provider: SourceItemView["provider"];
        disposition: ItemAssessment["disposition"];
        assessment_summary: string;
      }>;
      return {
        ...mapNewsletterEntry(entryRow),
        sources: sourceRows.map((source) => ({
          itemId: source.item_id,
          assessmentId: source.assessment_id,
          title: source.title,
          canonicalUrl: source.canonical_url,
          provider: source.provider,
          disposition: source.disposition,
          assessmentSummary: source.assessment_summary,
        })),
      };
    });
    const counts = this.database.prepare(`
      SELECT
        COUNT(*) AS assessment_count,
        SUM(CASE WHEN disposition = 'ARCHIVE' THEN 1 ELSE 0 END) AS archived_count
      FROM item_assessment
      WHERE analysis_run_id = ?
    `).get(row.analysis_run_id) as { assessment_count: number; archived_count: number | null };

    return {
      newsletter: mapNewsletter(row),
      entries,
      assessmentCount: counts.assessment_count,
      archivedCount: counts.archived_count ?? 0,
    };
  }
}
