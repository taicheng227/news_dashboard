export const SOURCE_KINDS = [
  "ARTICLE_INDEX",
  "ROLLING_CHANGELOG",
  "YOUTUBE_CHANNEL",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_PROVIDERS = [
  "OPENAI",
  "ANTHROPIC",
  "KIMI",
  "QWEN",
  "ZAI",
  "YOUTUBE",
] as const;

export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export const CONTENT_KINDS = [
  "ANNOUNCEMENT",
  "RELEASE_NOTE",
  "MODEL_RELEASE",
  "VIDEO",
] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

export type ContentStatus =
  | "DISCOVERED"
  | "FETCHED"
  | "TRANSCRIPT_UNAVAILABLE"
  | "FETCH_FAILED";

export type RawFormat = "HTML" | "VTT" | "JSON" | "TEXT";

export interface SourceConfiguration {
  slug: string;
  name: string;
  provider: SourceProvider;
  kind: SourceKind;
  url: string;
  enabled: boolean;
  /** Required for YouTube sources after the one-time/manual handle resolution. */
  channelId?: string;
}

export interface DiscoveryContext {
  /** True until this source has its first successful collection. */
  initialBackfill: boolean;
  /** Inclusive overlap boundary for incremental discovery. */
  since: Date;
  /** Hard source-specific cap (50 official items or 10 videos in V1). */
  limit: number;
}

export interface SurfacePayload {
  url: string;
  fetchedAt: string;
  httpStatus: number;
  contentType: string | null;
  rawBody: Buffer;
  contentHash: string;
  etag: string | null;
  lastModified: string | null;
}

export interface DiscoveredItem {
  sourceSlug: string;
  identityKey: string;
  externalId: string | null;
  canonicalUrl: string;
  kind: ContentKind;
  title: string;
  author: string | null;
  publishedAt: string | null;
  /** A cheap discovery-surface signal, not the permanent content hash. */
  discoveryFingerprint: string | null;
  metadata: Record<string, unknown>;
  /** Content already fully represented by a rolling page or first-party feed. */
  inlineContent?: {
    raw: Buffer;
    rawFormat: RawFormat;
    extractedText: string;
  };
}

export interface DiscoveryResult {
  surface: SurfacePayload;
  items: DiscoveredItem[];
}

export interface FetchedContent {
  status: Exclude<ContentStatus, "DISCOVERED" | "FETCH_FAILED">;
  rawContent: Buffer | null;
  rawFormat: RawFormat | null;
  extractedText: string;
  contentHash: string | null;
  wordCount: number;
  title?: string;
  author?: string | null;
  publishedAt?: string | null;
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  discover(
    source: SourceConfiguration,
    context: DiscoveryContext,
  ): Promise<DiscoveryResult>;
  fetch(
    source: SourceConfiguration,
    item: DiscoveredItem,
  ): Promise<FetchedContent>;
}
