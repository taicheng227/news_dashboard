import type { SourceConfiguration } from "../src/sources/types.js";

/**
 * The complete, fixed V1 collection registry. Channel IDs are deliberately
 * checked in: resolving a YouTube handle is a manual setup operation, not a
 * daily dependency.
 */
export const SOURCES = [
  {
    slug: "openai-news",
    name: "OpenAI News",
    provider: "OPENAI",
    kind: "ARTICLE_INDEX",
    url: "https://openai.com/news/",
    enabled: true,
  },
  {
    slug: "openai-product-release-notes",
    name: "OpenAI Product Release Notes",
    provider: "OPENAI",
    kind: "ROLLING_CHANGELOG",
    url: "https://openai.com/products/release-notes/",
    enabled: true,
  },
  {
    slug: "openai-codex-changelog",
    name: "Codex Changelog",
    provider: "OPENAI",
    kind: "ROLLING_CHANGELOG",
    url: "https://developers.openai.com/codex/changelog",
    enabled: true,
  },
  {
    slug: "anthropic-news",
    name: "Anthropic News",
    provider: "ANTHROPIC",
    kind: "ARTICLE_INDEX",
    url: "https://www.anthropic.com/news",
    enabled: true,
  },
  {
    slug: "anthropic-claude-apps-release-notes",
    name: "Claude Apps Release Notes",
    provider: "ANTHROPIC",
    kind: "ROLLING_CHANGELOG",
    url: "https://docs.anthropic.com/en/release-notes/claude-apps",
    enabled: true,
  },
  {
    slug: "anthropic-claude-code-changelog",
    name: "Claude Code Changelog",
    provider: "ANTHROPIC",
    kind: "ROLLING_CHANGELOG",
    url: "https://docs.anthropic.com/en/release-notes/claude-code",
    enabled: true,
  },
  {
    slug: "anthropic-platform-release-notes",
    name: "Claude Platform Release Notes",
    provider: "ANTHROPIC",
    kind: "ROLLING_CHANGELOG",
    url: "https://docs.anthropic.com/en/release-notes/api",
    enabled: true,
  },
  {
    slug: "kimi-blog",
    name: "Kimi Blog",
    provider: "KIMI",
    kind: "ARTICLE_INDEX",
    url: "https://www.kimi.com/blog/",
    enabled: true,
  },
  {
    slug: "qwen-research",
    name: "Qwen Research and Releases",
    provider: "QWEN",
    kind: "ARTICLE_INDEX",
    url: "https://qwen.ai/research",
    enabled: true,
  },
  {
    slug: "zai-blog",
    name: "Z.ai Blog",
    provider: "ZAI",
    kind: "ARTICLE_INDEX",
    url: "https://z.ai/blog",
    enabled: true,
  },
  {
    slug: "zai-release-notes",
    name: "Z.ai Release Notes",
    provider: "ZAI",
    kind: "ROLLING_CHANGELOG",
    url: "https://docs.z.ai/release-notes/new-released",
    enabled: true,
  },
  {
    slug: "youtube-matt-wolfe",
    name: "Matt Wolfe",
    provider: "YOUTUBE",
    kind: "YOUTUBE_CHANNEL",
    url: "https://www.youtube.com/@mreflow",
    channelId: "UChpleBmo18P08aKCIgti38g",
    enabled: true,
  },
  {
    slug: "youtube-theo-t3",
    name: "Theo — t3.gg",
    provider: "YOUTUBE",
    kind: "YOUTUBE_CHANNEL",
    url: "https://www.youtube.com/@t3dotgg",
    channelId: "UCbRP3c757lWg9M-U7TyEkXA",
    enabled: true,
  },
] as const satisfies readonly SourceConfiguration[];

export function getConfiguredSource(slug: string): SourceConfiguration | undefined {
  return SOURCES.find((source) => source.slug === slug);
}
