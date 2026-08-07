import { ArticleIndexAdapter } from "./article-index-adapter.js";
import { RollingChangelogAdapter } from "./rolling-changelog-adapter.js";
import type { SourceAdapter, SourceConfiguration, SourceKind } from "./types.js";
import { YoutubeChannelAdapter, type YtDlpOptions } from "./youtube-adapter.js";

export interface AdapterRegistryOptions {
  ytDlp?: YtDlpOptions;
}

export function createAdapterRegistry(
  options: AdapterRegistryOptions = {},
): ReadonlyMap<SourceKind, SourceAdapter> {
  return new Map<SourceKind, SourceAdapter>([
    ["ARTICLE_INDEX", new ArticleIndexAdapter()],
    ["ROLLING_CHANGELOG", new RollingChangelogAdapter()],
    ["YOUTUBE_CHANNEL", new YoutubeChannelAdapter(options.ytDlp)],
  ]);
}

const defaultRegistry = createAdapterRegistry();

export function getSourceAdapter(
  source: SourceConfiguration,
  registry: ReadonlyMap<SourceKind, SourceAdapter> = defaultRegistry,
): SourceAdapter {
  const adapter = registry.get(source.kind);
  if (!adapter) throw new Error(`No V1 adapter registered for ${source.kind}`);
  return adapter;
}

export * from "./types.js";

