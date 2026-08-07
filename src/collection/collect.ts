import { SOURCES } from "../../config/sources.js";
import type {
  CollectionRun,
  CollectionStatus,
  ContentItem,
  ContentSnapshot,
  FinishCollectionRunInput,
  InsertContentSnapshotInput,
  InsertSourceSnapshotInput,
  JsonObject,
  JsonValue,
  SeedSourceInput,
  Source,
  SourceSnapshot,
  StartCollectionRunInput,
  UpsertContentItemInput,
} from "../db/types.js";
import {
  createAdapterRegistry,
  getSourceAdapter,
  type AdapterRegistryOptions,
} from "../sources/registry.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  SourceAdapter,
  SourceConfiguration,
  SourceKind,
} from "../sources/types.js";

const DAY_MS = 86_400_000;
const INITIAL_BACKFILL_MS = 30 * DAY_MS;
const OVERLAP_MS = 48 * 60 * 60 * 1_000;

type MaybePromise<T> = T | Promise<T>;
type InsertResult<T> = { row: T; created: boolean };

/** The small repository surface collection owns; RadarRepository implements it. */
export interface CollectionRepository {
  seedSources(inputs: readonly SeedSourceInput[]): MaybePromise<unknown>;
  listSources(options?: { enabledOnly?: boolean }): MaybePromise<Source[]>;
  startCollectionRun(input: StartCollectionRunInput): MaybePromise<CollectionRun>;
  finishCollectionRun(
    runId: string,
    input: FinishCollectionRunInput,
  ): MaybePromise<unknown>;
  releaseCollectionLock(runId: string): MaybePromise<unknown>;
  refreshCollectionLock(runId: string, lockTtlMs?: number): MaybePromise<boolean>;
  updateSourceStatus(
    sourceId: string,
    input: { success: boolean; checkedAt?: string; error?: string | null },
  ): MaybePromise<unknown>;
  getContentItemByIdentityKey(identityKey: string): MaybePromise<ContentItem | null>;
  insertSourceSnapshot(
    input: InsertSourceSnapshotInput,
  ): MaybePromise<InsertResult<SourceSnapshot>>;
  upsertContentItem(
    input: UpsertContentItemInput,
  ): MaybePromise<InsertResult<ContentItem>>;
  updateContentStatus(
    itemId: string,
    status: "FETCHED" | "TRANSCRIPT_UNAVAILABLE" | "FETCH_FAILED",
  ): MaybePromise<unknown>;
  insertContentSnapshot(
    input: InsertContentSnapshotInput,
  ): MaybePromise<InsertResult<ContentSnapshot>>;
}

export interface CollectionLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  operation: string;
  runId: string | null;
  sourceSlug: string | null;
  itemId: string | null;
  message: string;
}

export interface CollectOptions {
  trigger?: "SCHEDULED" | "MANUAL";
  lockTtlMs?: number;
  sourceSlugs?: readonly string[];
  now?: () => Date;
  adapters?: ReadonlyMap<SourceKind, SourceAdapter>;
  adapterOptions?: AdapterRegistryOptions;
  onLog?: (entry: CollectionLog) => void;
}

export interface CollectionError {
  sourceSlug: string | null;
  itemIdentityKey: string | null;
  message: string;
}

export interface CollectionSummary {
  runId: string;
  status: Exclude<CollectionStatus, "RUNNING">;
  startedAt: string;
  completedAt: string;
  sourcesChecked: number;
  itemsDiscovered: number;
  itemsCreated: number;
  snapshotsCreated: number;
  errors: CollectionError[];
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function configuredSeed(source: SourceConfiguration): SeedSourceInput {
  return {
    slug: source.slug,
    name: source.name,
    provider: source.provider,
    kind: source.kind,
    canonicalUrl: source.url,
    enabled: source.enabled,
    config: source.channelId ? { channelId: source.channelId } : {},
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

export function discoveryContext(source: Source, now: Date): DiscoveryContext {
  const initialBackfill = !source.lastSuccessAt;
  const since = initialBackfill
    ? new Date(now.valueOf() - INITIAL_BACKFILL_MS)
    : new Date(new Date(source.lastSuccessAt!).valueOf() - OVERLAP_MS);
  return {
    initialBackfill,
    since,
    limit:
      source.kind === "YOUTUBE_CHANNEL"
        ? 10
        : source.kind === "ROLLING_CHANGELOG" && !initialBackfill
          ? 250
          : 50,
  };
}

function isInsideDiscoveryWindow(item: DiscoveredItem, since: Date): boolean {
  if (!item.publishedAt) return false;
  const publishedAt = new Date(item.publishedAt).valueOf();
  return Number.isFinite(publishedAt) && publishedAt >= since.valueOf();
}

/**
 * A rolling adapter may scan deeply enough to find previously stored entries,
 * but an incremental run must not turn that reconciliation scan into a history
 * import. Known identities remain eligible so edits are detected. The one V1
 * undated feed is newest-first Markdown, so only unknown entries ahead of its
 * first known anchor can be new; unknown entries behind the anchor are history.
 */
export function selectRollingChangelogItems(
  items: readonly DiscoveredItem[],
  context: DiscoveryContext,
  knownIdentityKeys: ReadonlySet<string>,
): DiscoveredItem[] {
  if (context.initialBackfill) {
    return items
      .filter(
        (item) =>
          item.publishedAt === null || isInsideDiscoveryWindow(item, context.since),
      )
      .slice(0, Math.min(context.limit, 50));
  }

  const firstKnownIndex = items.findIndex((item) =>
    knownIdentityKeys.has(item.identityKey),
  );
  return items.filter((item, index) => {
    if (knownIdentityKeys.has(item.identityKey)) return true;
    if (isInsideDiscoveryWindow(item, context.since)) return true;
    return (
      item.publishedAt === null &&
      item.metadata.sourceFormat === "MARKDOWN" &&
      firstKnownIndex >= 0 &&
      index < firstKnownIndex
    );
  });
}

function collectionStatus(
  successfulSources: number,
  errors: readonly CollectionError[],
): Exclude<CollectionStatus, "RUNNING"> {
  if (successfulSources === 0 && errors.length) return "FAILED";
  if (errors.length) return "PARTIAL";
  return "SUCCEEDED";
}

export async function collectSources(
  repository: CollectionRepository,
  options: CollectOptions = {},
): Promise<CollectionSummary> {
  const now = options.now ?? (() => new Date());
  const emit = (
    level: CollectionLog["level"],
    operation: string,
    message: string,
    runId: string | null = null,
    sourceSlug: string | null = null,
    itemId: string | null = null,
  ) => {
    const entry: CollectionLog = {
      timestamp: now().toISOString(),
      level,
      operation,
      runId,
      sourceSlug,
      itemId,
      message,
    };
    if (options.onLog) options.onLog(entry);
    else console.log(JSON.stringify(entry));
  };

  await repository.seedSources(SOURCES.map(configuredSeed));
  const lockTtlMs = options.lockTtlMs ?? 30 * 60 * 1_000;
  const run = await repository.startCollectionRun({
    trigger: options.trigger ?? "MANUAL",
    startedAt: now().toISOString(),
    lockTtlMs,
  });
  const startedAt = run.startedAt;
  const errors: CollectionError[] = [];
  let sourcesChecked = 0;
  let successfulSources = 0;
  let itemsDiscovered = 0;
  let itemsCreated = 0;
  let snapshotsCreated = 0;
  let finalStatus: Exclude<CollectionStatus, "RUNNING"> = "FAILED";
  let completedAt = now().toISOString();

  emit("info", "collection.start", "Collection started", run.id);

  try {
    const slugFilter = options.sourceSlugs?.length
      ? new Set(options.sourceSlugs)
      : null;
    const configuredBySlug = new Map<string, SourceConfiguration>(
      SOURCES.map((source) => [source.slug, source]),
    );
    const databaseSources = (await repository.listSources({ enabledOnly: true })).filter(
      (source) => !slugFilter || slugFilter.has(source.slug),
    );
    const adapters =
      options.adapters ?? createAdapterRegistry(options.adapterOptions);

    const refreshLock = async () => {
      if (!(await repository.refreshCollectionLock(run.id, lockTtlMs))) {
        throw new Error("Collection lock expired or is no longer owned by this run");
      }
    };

    for (const databaseSource of databaseSources) {
      await refreshLock();
      sourcesChecked += 1;
      const checkedAt = now().toISOString();
      const configured = configuredBySlug.get(databaseSource.slug);
      if (!configured) {
        const message = "Enabled database source is absent from the fixed V1 registry";
        errors.push({
          sourceSlug: databaseSource.slug,
          itemIdentityKey: null,
          message,
        });
        await repository.updateSourceStatus(databaseSource.id, {
          success: false,
          checkedAt,
          error: message,
        });
        emit("error", "source.finish", message, run.id, databaseSource.slug);
        continue;
      }

      emit("info", "source.start", "Source collection started", run.id, configured.slug);
      let sourceErrorCount = 0;
      try {
        const adapter = getSourceAdapter(configured, adapters);
        const context = discoveryContext(databaseSource, now());
        const discovered = await adapter.discover(configured, context);
        const existingItems = new Map<string, ContentItem | null>();
        let relevantItems = discovered.items;
        if (configured.kind === "ROLLING_CHANGELOG") {
          for (const item of discovered.items) {
            existingItems.set(
              item.identityKey,
              await repository.getContentItemByIdentityKey(item.identityKey),
            );
          }
          relevantItems = selectRollingChangelogItems(
            discovered.items,
            context,
            new Set(
              [...existingItems.entries()]
                .filter(([, existing]) => existing !== null)
                .map(([identityKey]) => identityKey),
            ),
          );
        }
        itemsDiscovered += relevantItems.length;
        const sourceSnapshot = await repository.insertSourceSnapshot({
          sourceId: databaseSource.id,
          collectionRunId: run.id,
          url: discovered.surface.url,
          fetchedAt: discovered.surface.fetchedAt,
          httpStatus: discovered.surface.httpStatus,
          contentType: discovered.surface.contentType,
          contentHash: discovered.surface.contentHash,
          rawBody: discovered.surface.rawBody,
          etag: discovered.surface.etag,
          lastModified: discovered.surface.lastModified,
        });
        if (sourceSnapshot.created) snapshotsCreated += 1;

        emit(
          "info",
          "source.discover",
          `Discovered ${relevantItems.length} relevant item(s)`,
          run.id,
          configured.slug,
        );

        for (const discoveredItem of relevantItems) {
          await refreshLock();
          const existingItem = existingItems.has(discoveredItem.identityKey)
            ? existingItems.get(discoveredItem.identityKey) ?? null
            : await repository.getContentItemByIdentityKey(discoveredItem.identityKey);
          const itemResult = await repository.upsertContentItem({
            sourceId: databaseSource.id,
            identityKey: discoveredItem.identityKey,
            externalId: discoveredItem.externalId,
            canonicalUrl: discoveredItem.canonicalUrl,
            kind: discoveredItem.kind,
            title: discoveredItem.title,
            author: discoveredItem.author,
            publishedAt: discoveredItem.publishedAt,
            lastSeenAt: now().toISOString(),
            metadata: toJsonObject({
              ...(existingItem?.metadata ?? {}),
              ...discoveredItem.metadata,
              discoveryFingerprint: discoveredItem.discoveryFingerprint,
            }),
          });
          if (itemResult.created) itemsCreated += 1;

          const shouldFetch =
            itemResult.created ||
            configured.kind === "ROLLING_CHANGELOG" ||
            itemResult.row.currentSnapshotId === null ||
            itemResult.row.contentStatus === "FETCH_FAILED" ||
            sourceSnapshot.created;
          if (!shouldFetch) continue;

          try {
            const fetched = await adapter.fetch(configured, discoveredItem);
            await repository.upsertContentItem({
              sourceId: databaseSource.id,
              identityKey: discoveredItem.identityKey,
              externalId: discoveredItem.externalId,
              canonicalUrl: discoveredItem.canonicalUrl,
              kind: discoveredItem.kind,
              title: fetched.title ?? discoveredItem.title,
              author: fetched.author ?? discoveredItem.author,
              publishedAt: fetched.publishedAt ?? discoveredItem.publishedAt,
              lastSeenAt: now().toISOString(),
              metadata: toJsonObject({
                ...itemResult.row.metadata,
                ...discoveredItem.metadata,
                ...fetched.metadata,
                discoveryFingerprint: discoveredItem.discoveryFingerprint,
              }),
            });

            if (fetched.status === "TRANSCRIPT_UNAVAILABLE") {
              if (!fetched.rawContent || !fetched.rawFormat || !fetched.contentHash) {
                throw new Error("Metadata-only video was missing its stable JSON payload");
              }
              const metadataSnapshot = await repository.insertContentSnapshot({
                itemId: itemResult.row.id,
                collectionRunId: run.id,
                sourceSnapshotId: null,
                capturedAt: now().toISOString(),
                contentHash: fetched.contentHash,
                rawFormat: fetched.rawFormat,
                rawContent: fetched.rawContent,
                extractedText: fetched.extractedText,
                wordCount: fetched.wordCount,
                metadata: toJsonObject(fetched.metadata),
                contentStatus: "TRANSCRIPT_UNAVAILABLE",
              });
              if (metadataSnapshot.created) snapshotsCreated += 1;
              emit(
                "warn",
                "item.transcript_unavailable",
                "No creator-provided or automatic English transcript was available",
                run.id,
                configured.slug,
                itemResult.row.id,
              );
              continue;
            }

            if (!fetched.rawContent || !fetched.rawFormat || !fetched.contentHash) {
              throw new Error("Fetched content was missing its immutable payload or hash");
            }
            const contentSnapshot = await repository.insertContentSnapshot({
              itemId: itemResult.row.id,
              collectionRunId: run.id,
              sourceSnapshotId:
                configured.kind === "ROLLING_CHANGELOG"
                  ? sourceSnapshot.row.id
                  : null,
              capturedAt: now().toISOString(),
              contentHash: fetched.contentHash,
              rawFormat: fetched.rawFormat,
              rawContent: fetched.rawContent,
              extractedText: fetched.extractedText,
              wordCount: fetched.wordCount,
              metadata: toJsonObject(fetched.metadata),
              contentStatus: "FETCHED",
            });
            if (contentSnapshot.created) snapshotsCreated += 1;
          } catch (error) {
            sourceErrorCount += 1;
            const message = errorMessage(error);
            errors.push({
              sourceSlug: configured.slug,
              itemIdentityKey: discoveredItem.identityKey,
              message,
            });
            await repository.updateContentStatus(itemResult.row.id, "FETCH_FAILED");
            emit(
              "error",
              "item.fetch",
              message,
              run.id,
              configured.slug,
              itemResult.row.id,
            );
          }
        }

        if (sourceErrorCount) {
          const message = `${sourceErrorCount} item fetch(es) failed`;
          await repository.updateSourceStatus(databaseSource.id, {
            success: false,
            checkedAt,
            error: message,
          });
          emit("warn", "source.finish", message, run.id, configured.slug);
        } else {
          successfulSources += 1;
          await repository.updateSourceStatus(databaseSource.id, {
            success: true,
            checkedAt,
          });
          emit("info", "source.finish", "Source collection succeeded", run.id, configured.slug);
        }
      } catch (error) {
        const message = errorMessage(error);
        errors.push({
          sourceSlug: configured.slug,
          itemIdentityKey: null,
          message,
        });
        await repository.updateSourceStatus(databaseSource.id, {
          success: false,
          checkedAt,
          error: message,
        });
        emit("error", "source.finish", message, run.id, configured.slug);
      }
    }

    finalStatus = collectionStatus(successfulSources, errors);
    completedAt = now().toISOString();
    await repository.finishCollectionRun(run.id, {
      status: finalStatus,
      completedAt,
      sourcesChecked,
      itemsDiscovered,
      itemsCreated,
      snapshotsCreated,
      errors: errors as unknown as JsonValue[],
    });
    emit(
      finalStatus === "SUCCEEDED" ? "info" : "warn",
      "collection.finish",
      `Collection ${finalStatus.toLowerCase()}: ${itemsCreated} new item(s), ${snapshotsCreated} new snapshot(s)`,
      run.id,
    );
  } catch (error) {
    const message = errorMessage(error);
    errors.push({ sourceSlug: null, itemIdentityKey: null, message });
    completedAt = now().toISOString();
    try {
      await repository.finishCollectionRun(run.id, {
        status: "FAILED",
        completedAt,
        sourcesChecked,
        itemsDiscovered,
        itemsCreated,
        snapshotsCreated,
        errors: errors as unknown as JsonValue[],
      });
    } catch {
      // The original failure is more useful; the lock is still released below.
    }
    emit("error", "collection.finish", message, run.id);
    finalStatus = "FAILED";
  } finally {
    await repository.releaseCollectionLock(run.id);
  }

  return {
    runId: run.id,
    status: finalStatus,
    startedAt,
    completedAt,
    sourcesChecked,
    itemsDiscovered,
    itemsCreated,
    snapshotsCreated,
    errors,
  };
}

export const collect = collectSources;
