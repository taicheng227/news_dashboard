export const SOURCE_PROVIDERS = [
  "OPENAI",
  "ANTHROPIC",
  "KIMI",
  "QWEN",
  "ZAI",
  "YOUTUBE",
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export const SOURCE_KINDS = [
  "ARTICLE_INDEX",
  "ROLLING_CHANGELOG",
  "YOUTUBE_CHANNEL",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const COLLECTION_TRIGGERS = ["SCHEDULED", "MANUAL"] as const;
export type CollectionTrigger = (typeof COLLECTION_TRIGGERS)[number];

export const COLLECTION_STATUSES = ["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const CONTENT_KINDS = ["ANNOUNCEMENT", "RELEASE_NOTE", "MODEL_RELEASE", "VIDEO"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_STATUSES = [
  "DISCOVERED",
  "FETCHED",
  "TRANSCRIPT_UNAVAILABLE",
  "FETCH_FAILED",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const RAW_FORMATS = ["HTML", "VTT", "JSON", "TEXT"] as const;
export type RawFormat = (typeof RAW_FORMATS)[number];

export const ANALYSIS_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const DISPOSITIONS = ["INCLUDE", "WATCH", "ARCHIVE"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const ASSESSMENT_CATEGORIES = [
  "PRODUCT_RELEASE",
  "MODEL_RELEASE",
  "CODING_AGENT",
  "DEVELOPER_TOOL",
  "AI_APPLICATION",
  "RESEARCH",
  "COMMENTARY",
  "OTHER",
] as const;
export type AssessmentCategory = (typeof ASSESSMENT_CATEGORIES)[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const NEWSLETTER_STATUSES = ["DRAFT", "PUBLISHED", "SUPERSEDED"] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];

export const NEWSLETTER_SECTIONS = [
  "IMPORTANT",
  "WORTH_KNOWING",
  "FROM_YOUTUBE",
  "WATCHLIST",
] as const;
export type NewsletterSection = (typeof NEWSLETTER_SECTIONS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  provider: SourceProvider;
  kind: SourceKind;
  canonical_url: string;
  enabled: 0 | 1;
  config_json: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionRunRow {
  id: string;
  trigger: CollectionTrigger;
  status: CollectionStatus;
  started_at: string;
  completed_at: string | null;
  sources_checked: number;
  items_discovered: number;
  items_created: number;
  snapshots_created: number;
  errors_json: string;
}

export interface SourceSnapshotRow {
  id: string;
  source_id: string;
  collection_run_id: string;
  url: string;
  fetched_at: string;
  http_status: number;
  content_type: string | null;
  content_hash: string;
  raw_body_gzip: Buffer;
  etag: string | null;
  last_modified: string | null;
}

export interface ContentItemRow {
  id: string;
  source_id: string;
  identity_key: string;
  external_id: string | null;
  canonical_url: string | null;
  kind: ContentKind;
  title: string;
  author: string | null;
  published_at: string | null;
  discovered_at: string;
  last_seen_at: string;
  content_status: ContentStatus;
  current_snapshot_id: string | null;
  metadata_json: string;
}

export interface ContentSnapshotRow {
  id: string;
  item_id: string;
  collection_run_id: string;
  source_snapshot_id: string | null;
  captured_at: string;
  content_hash: string;
  raw_format: RawFormat;
  raw_content_gzip: Buffer;
  extracted_text: string;
  word_count: number;
  metadata_json: string;
}

export interface AnalysisRunRow {
  id: string;
  status: AnalysisStatus;
  window_start: string;
  window_end: string;
  started_at: string;
  completed_at: string | null;
  model_name: string | null;
  reasoning_effort: string | null;
  prompt_version: string;
  input_hash: string | null;
  error_message: string | null;
}

export interface AnalysisRunCandidateRow {
  analysis_run_id: string;
  item_id: string;
  snapshot_id: string;
}

export interface ItemAssessmentRow {
  id: string;
  analysis_run_id: string;
  item_id: string;
  snapshot_id: string;
  disposition: Disposition;
  importance: number | null;
  category: AssessmentCategory;
  confidence: Confidence;
  summary: string;
  why_it_matters: string;
  key_points_json: string;
  caveats_json: string;
  created_at: string;
}

export interface NewsletterRow {
  id: string;
  newsletter_date: string;
  version: number;
  analysis_run_id: string;
  title: string;
  dek: string;
  markdown: string;
  html: string;
  status: NewsletterStatus;
  generated_at: string;
  published_at: string | null;
  supersedes_id: string | null;
}

export interface NewsletterEntryRow {
  id: string;
  newsletter_id: string;
  section: NewsletterSection;
  rank: number;
  headline: string;
  summary: string;
  why_it_matters: string;
  caveats_json: string;
}

export interface Source {
  id: string;
  slug: string;
  name: string;
  provider: SourceProvider;
  kind: SourceKind;
  canonicalUrl: string;
  enabled: boolean;
  config: JsonObject;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionRun {
  id: string;
  trigger: CollectionTrigger;
  status: CollectionStatus;
  startedAt: string;
  completedAt: string | null;
  sourcesChecked: number;
  itemsDiscovered: number;
  itemsCreated: number;
  snapshotsCreated: number;
  errors: JsonValue[];
}

export interface SourceSnapshot {
  id: string;
  sourceId: string;
  collectionRunId: string;
  url: string;
  fetchedAt: string;
  httpStatus: number;
  contentType: string | null;
  contentHash: string;
  rawBodyGzip: Buffer;
  etag: string | null;
  lastModified: string | null;
}

export interface ContentItem {
  id: string;
  sourceId: string;
  identityKey: string;
  externalId: string | null;
  canonicalUrl: string | null;
  kind: ContentKind;
  title: string;
  author: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  contentStatus: ContentStatus;
  currentSnapshotId: string | null;
  metadata: JsonObject;
}

export interface ContentSnapshot {
  id: string;
  itemId: string;
  collectionRunId: string;
  sourceSnapshotId: string | null;
  capturedAt: string;
  contentHash: string;
  rawFormat: RawFormat;
  rawContentGzip: Buffer;
  extractedText: string;
  wordCount: number;
  metadata: JsonObject;
}

export interface AnalysisRun {
  id: string;
  status: AnalysisStatus;
  windowStart: string;
  windowEnd: string;
  startedAt: string;
  completedAt: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
  promptVersion: string;
  inputHash: string | null;
  errorMessage: string | null;
}

export interface ItemAssessment {
  id: string;
  analysisRunId: string;
  itemId: string;
  snapshotId: string;
  disposition: Disposition;
  importance: number | null;
  category: AssessmentCategory;
  confidence: Confidence;
  summary: string;
  whyItMatters: string;
  keyPoints: string[];
  caveats: string[];
  createdAt: string;
}

export interface Newsletter {
  id: string;
  newsletterDate: string;
  version: number;
  analysisRunId: string;
  title: string;
  dek: string;
  markdown: string;
  html: string;
  status: NewsletterStatus;
  generatedAt: string;
  publishedAt: string | null;
  supersedesId: string | null;
}

export interface NewsletterEntry {
  id: string;
  newsletterId: string;
  section: NewsletterSection;
  rank: number;
  headline: string;
  summary: string;
  whyItMatters: string;
  caveats: string[];
}

export interface SeedSourceInput {
  slug: string;
  name: string;
  provider: SourceProvider;
  kind: SourceKind;
  canonicalUrl: string;
  enabled?: boolean;
  config?: JsonObject;
}

export interface StartCollectionRunInput {
  trigger: CollectionTrigger;
  startedAt?: string;
  lockTtlMs?: number;
}

export interface FinishCollectionRunInput {
  status: Exclude<CollectionStatus, "RUNNING">;
  completedAt?: string;
  sourcesChecked: number;
  itemsDiscovered: number;
  itemsCreated: number;
  snapshotsCreated: number;
  errors?: JsonValue[];
}

export interface InsertSourceSnapshotInput {
  sourceId: string;
  collectionRunId: string;
  url: string;
  fetchedAt?: string;
  httpStatus: number;
  contentType?: string | null;
  contentHash: string;
  rawBody: string | Buffer;
  etag?: string | null;
  lastModified?: string | null;
}

export interface UpsertContentItemInput {
  sourceId: string;
  identityKey: string;
  externalId?: string | null;
  canonicalUrl?: string | null;
  kind: ContentKind;
  title: string;
  author?: string | null;
  publishedAt?: string | null;
  discoveredAt?: string;
  lastSeenAt?: string;
  metadata?: JsonObject;
}

export interface InsertContentSnapshotInput {
  itemId: string;
  collectionRunId: string;
  sourceSnapshotId?: string | null;
  capturedAt?: string;
  contentHash: string;
  rawFormat: RawFormat;
  rawContent: string | Buffer;
  extractedText: string;
  wordCount?: number;
  metadata?: JsonObject;
  contentStatus?: Extract<ContentStatus, "FETCHED" | "TRANSCRIPT_UNAVAILABLE">;
}

export interface CreateAnalysisRunInput {
  windowStart: string;
  windowEnd: string;
  startedAt?: string;
  modelName?: string | null;
  reasoningEffort?: string | null;
  promptVersion: string;
  inputHash?: string | null;
}

export interface PreviousAssessment {
  analysisRunId: string;
  snapshotId: string;
  disposition: Disposition;
  importance: number | null;
  category: AssessmentCategory;
  confidence: Confidence;
  summary: string;
  whyItMatters: string;
  createdAt: string;
}

export type ContentQuality = "FULL_TEXT" | "METADATA_ONLY" | "TRANSCRIPT_UNAVAILABLE" | "FETCH_FAILED";

export interface PendingCandidate {
  itemId: string;
  snapshotId: string;
  provider: SourceProvider;
  itemKind: ContentKind;
  title: string;
  author: string | null;
  publishedAt: string | null;
  canonicalUrl: string | null;
  description: string | null;
  cleanedContent: string;
  contentQuality: ContentQuality;
  capturedAt: string;
  contentHash: string;
  previousAssessments: PreviousAssessment[];
}

export interface AssessmentImport {
  itemId: string;
  snapshotId: string;
  disposition: Disposition;
  importance: number | null;
  category: AssessmentCategory;
  confidence: Confidence;
  summary: string;
  whyItMatters: string;
  keyPoints: string[];
  caveats: string[];
}

export interface NewsletterEntryImport {
  section: NewsletterSection;
  rank: number;
  headline: string;
  summary: string;
  whyItMatters: string;
  caveats: string[];
  sourceItemIds: string[];
}

export interface NewsletterImportInput {
  analysisRunId: string;
  expectedCandidates: ReadonlyArray<{ itemId: string; snapshotId: string }>;
  editionDate: string;
  title: string;
  dek: string;
  markdown: string;
  html: string;
  status?: Exclude<NewsletterStatus, "SUPERSEDED">;
  generatedAt?: string;
  publishedAt?: string | null;
  assessments: readonly AssessmentImport[];
  entries: readonly NewsletterEntryImport[];
}

export interface NewsletterEntrySourceView {
  itemId: string;
  assessmentId: string;
  title: string;
  canonicalUrl: string | null;
  provider: SourceProvider;
  disposition: Disposition;
  assessmentSummary: string;
}

export interface NewsletterEntryView extends NewsletterEntry {
  sources: NewsletterEntrySourceView[];
}

export interface NewsletterView {
  newsletter: Newsletter;
  entries: NewsletterEntryView[];
  assessmentCount: number;
  archivedCount: number;
}

export interface SourceItemFilters {
  provider?: SourceProvider;
  kind?: ContentKind;
  publishedFrom?: string;
  publishedTo?: string;
  disposition?: Disposition;
  limit?: number;
  offset?: number;
}

export interface SourceItemView {
  itemId: string;
  title: string;
  provider: SourceProvider;
  itemKind: ContentKind;
  publishedAt: string | null;
  canonicalUrl: string | null;
  capturedAt: string | null;
  disposition: Disposition | null;
  assessmentSummary: string | null;
  contentStatus: ContentStatus;
}

export interface StatusSummary {
  latestCollectionRun: CollectionRun | null;
  latestSuccessfulCollectionRun: CollectionRun | null;
  latestProblemCollectionRun: CollectionRun | null;
  latestAnalysisRun: AnalysisRun | null;
  latestNewsletter: Newsletter | null;
  pendingCandidateCount: number;
  sourceFailures: Source[];
}
