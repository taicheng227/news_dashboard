CREATE TABLE source (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('OPENAI', 'ANTHROPIC', 'KIMI', 'QWEN', 'ZAI', 'YOUTUBE')),
  kind TEXT NOT NULL CHECK (kind IN ('ARTICLE_INDEX', 'ROLLING_CHANGELOG', 'YOUTUBE_CHANNEL')),
  canonical_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(config_json))
);

CREATE TABLE collection_run (
  id TEXT PRIMARY KEY,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('SCHEDULED', 'MANUAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  sources_checked INTEGER NOT NULL DEFAULT 0 CHECK (sources_checked >= 0),
  items_discovered INTEGER NOT NULL DEFAULT 0 CHECK (items_discovered >= 0),
  items_created INTEGER NOT NULL DEFAULT 0 CHECK (items_created >= 0),
  snapshots_created INTEGER NOT NULL DEFAULT 0 CHECK (snapshots_created >= 0),
  errors_json TEXT NOT NULL DEFAULT '[]',
  CHECK (json_valid(errors_json)),
  CHECK ((status = 'RUNNING' AND completed_at IS NULL) OR status <> 'RUNNING')
);

CREATE TABLE source_snapshot (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE RESTRICT,
  collection_run_id TEXT NOT NULL REFERENCES collection_run(id) ON DELETE RESTRICT,
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  content_type TEXT,
  content_hash TEXT NOT NULL,
  raw_body_gzip BLOB NOT NULL,
  etag TEXT,
  last_modified TEXT,
  UNIQUE (source_id, content_hash)
);

CREATE TABLE content_item (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE RESTRICT,
  identity_key TEXT NOT NULL UNIQUE,
  external_id TEXT,
  canonical_url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('ANNOUNCEMENT', 'RELEASE_NOTE', 'MODEL_RELEASE', 'VIDEO')),
  title TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  content_status TEXT NOT NULL CHECK (content_status IN ('DISCOVERED', 'FETCHED', 'TRANSCRIPT_UNAVAILABLE', 'FETCH_FAILED')),
  current_snapshot_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (json_valid(metadata_json)),
  FOREIGN KEY (current_snapshot_id) REFERENCES content_snapshot(id) ON DELETE RESTRICT
);

CREATE TABLE content_snapshot (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE RESTRICT,
  collection_run_id TEXT NOT NULL REFERENCES collection_run(id) ON DELETE RESTRICT,
  source_snapshot_id TEXT REFERENCES source_snapshot(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_format TEXT NOT NULL CHECK (raw_format IN ('HTML', 'VTT', 'JSON', 'TEXT')),
  raw_content_gzip BLOB NOT NULL,
  extracted_text TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (json_valid(metadata_json)),
  UNIQUE (item_id, content_hash),
  UNIQUE (id, item_id)
);

CREATE TABLE analysis_run (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  model_name TEXT,
  reasoning_effort TEXT,
  prompt_version TEXT NOT NULL,
  input_hash TEXT,
  error_message TEXT,
  CHECK ((status = 'RUNNING' AND completed_at IS NULL) OR status <> 'RUNNING')
);

-- Freezes the exact candidate snapshot set exported for an analysis run. Without
-- this small mapping, a collection that lands during analysis could change the
-- current snapshot and make a valid import impossible to verify deterministically.
CREATE TABLE analysis_run_candidate (
  analysis_run_id TEXT NOT NULL REFERENCES analysis_run(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (analysis_run_id, item_id),
  FOREIGN KEY (snapshot_id, item_id) REFERENCES content_snapshot(id, item_id) ON DELETE RESTRICT
);

CREATE TABLE item_assessment (
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_run(id) ON DELETE RESTRICT,
  item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('INCLUDE', 'WATCH', 'ARCHIVE')),
  importance INTEGER CHECK (importance IS NULL OR importance BETWEEN 1 AND 5),
  category TEXT NOT NULL CHECK (category IN ('PRODUCT_RELEASE', 'MODEL_RELEASE', 'CODING_AGENT', 'DEVELOPER_TOOL', 'AI_APPLICATION', 'RESEARCH', 'COMMENTARY', 'OTHER')),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  summary TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  key_points_json TEXT NOT NULL DEFAULT '[]',
  caveats_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  CHECK (json_valid(key_points_json)),
  CHECK (json_valid(caveats_json)),
  UNIQUE (analysis_run_id, item_id),
  UNIQUE (id, item_id),
  FOREIGN KEY (snapshot_id, item_id) REFERENCES content_snapshot(id, item_id) ON DELETE RESTRICT
);

CREATE TABLE newsletter (
  id TEXT PRIMARY KEY,
  newsletter_date TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  analysis_run_id TEXT NOT NULL REFERENCES analysis_run(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  dek TEXT NOT NULL,
  markdown TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  generated_at TEXT NOT NULL,
  published_at TEXT,
  supersedes_id TEXT REFERENCES newsletter(id) ON DELETE RESTRICT,
  UNIQUE (newsletter_date, version),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE TABLE newsletter_entry (
  id TEXT PRIMARY KEY,
  newsletter_id TEXT NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('IMPORTANT', 'WORTH_KNOWING', 'FROM_YOUTUBE', 'WATCHLIST')),
  rank INTEGER NOT NULL CHECK (rank >= 1),
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  caveats_json TEXT NOT NULL DEFAULT '[]',
  CHECK (json_valid(caveats_json))
);

CREATE TABLE newsletter_entry_source (
  newsletter_entry_id TEXT NOT NULL REFERENCES newsletter_entry(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES content_item(id) ON DELETE RESTRICT,
  assessment_id TEXT NOT NULL,
  PRIMARY KEY (newsletter_entry_id, item_id),
  FOREIGN KEY (assessment_id, item_id) REFERENCES item_assessment(id, item_id) ON DELETE RESTRICT
);

CREATE TABLE collection_lock (
  lock_name TEXT PRIMARY KEY CHECK (lock_name = 'collection'),
  owner_run_id TEXT NOT NULL REFERENCES collection_run(id) ON DELETE CASCADE,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_source_enabled ON source(enabled, slug);
CREATE INDEX idx_collection_run_started ON collection_run(started_at DESC);
CREATE INDEX idx_source_snapshot_source_fetched ON source_snapshot(source_id, fetched_at DESC);
CREATE INDEX idx_content_item_source_published ON content_item(source_id, published_at DESC);
CREATE INDEX idx_content_item_current_snapshot ON content_item(current_snapshot_id);
CREATE INDEX idx_content_snapshot_item_captured ON content_snapshot(item_id, captured_at DESC);
CREATE INDEX idx_analysis_run_started ON analysis_run(started_at DESC);
CREATE INDEX idx_analysis_run_candidate_snapshot ON analysis_run_candidate(snapshot_id);
CREATE INDEX idx_item_assessment_snapshot ON item_assessment(snapshot_id);
CREATE INDEX idx_item_assessment_item_created ON item_assessment(item_id, created_at DESC);
CREATE INDEX idx_newsletter_date_status ON newsletter(newsletter_date DESC, status, version DESC);
CREATE INDEX idx_newsletter_entry_order ON newsletter_entry(newsletter_id, section, rank);
