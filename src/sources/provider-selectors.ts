import type { ContentKind, SourceConfiguration } from "./types.js";

export interface ProviderParsingProfile {
  listingLinkSelectors: readonly string[];
  articleSelectors: readonly string[];
  changelogRootSelectors: readonly string[];
  defaultKind: ContentKind;
  acceptsArticleUrl(url: URL, source: SourceConfiguration): boolean;
}

const BASE_PROFILE: ProviderParsingProfile = {
  listingLinkSelectors: [
    "main article a[href]",
    "main [class*=card i] a[href]",
    "main a[href]",
  ],
  articleSelectors: ["article", "main [class*=article i]", "main"],
  changelogRootSelectors: ["main article", "main", "article"],
  defaultKind: "ANNOUNCEMENT",
  acceptsArticleUrl(url, source) {
    const sourceUrl = new URL(source.url);
    return url.hostname === sourceUrl.hostname && url.pathname !== sourceUrl.pathname;
  },
};

const PROFILES: Record<string, Partial<ProviderParsingProfile>> = {
  "openai-news": {
    listingLinkSelectors: [
      "main article a[href]",
      "main a[href*='/index/']",
      "main a[href*='/news/']",
    ],
    articleSelectors: ["article", "main [data-article-body]", "main"],
    acceptsArticleUrl(url) {
      return /\/(?:index|news)\/[^/]+\/?$/i.test(url.pathname);
    },
  },
  "anthropic-news": {
    listingLinkSelectors: ["main article a[href]", "main a[href*='/news/']"],
    articleSelectors: ["article", "main [class*=prose i]", "main"],
    acceptsArticleUrl(url) {
      return /^\/news\/[^/]+\/?$/i.test(url.pathname);
    },
  },
  "kimi-blog": {
    listingLinkSelectors: ["main article a[href]", "main a[href*='/blog/']"],
    articleSelectors: ["article", "main [class*=markdown i]", "main"],
    defaultKind: "MODEL_RELEASE",
    acceptsArticleUrl(url) {
      return /^\/blog\/[^/]+/i.test(url.pathname);
    },
  },
  "qwen-research": {
    listingLinkSelectors: [
      "main article a[href]",
      "main a[href*='/research']",
      "main a[href*='/blog/']",
    ],
    articleSelectors: ["article", "main [class*=markdown i]", "main"],
    defaultKind: "MODEL_RELEASE",
    acceptsArticleUrl(url, source) {
      const sourceUrl = new URL(source.url);
      if (url.hostname !== sourceUrl.hostname) return false;
      return (
        /^\/research\//i.test(url.pathname) ||
        (url.pathname === "/research" && url.search.length > 1) ||
        /^\/blog\//i.test(url.pathname)
      );
    },
  },
  "zai-blog": {
    listingLinkSelectors: ["main article a[href]", "main a[href*='/blog/']"],
    articleSelectors: ["article", "main [class*=prose i]", "main"],
    defaultKind: "MODEL_RELEASE",
    acceptsArticleUrl(url) {
      return /^\/blog\/[^/]+/i.test(url.pathname);
    },
  },
  "openai-product-release-notes": {
    changelogRootSelectors: ["main article", "main"],
  },
  "openai-codex-changelog": {
    // The current Learn site renders each release entry as a sibling article.
    // Selecting the first article drops every subsequent release, so parse the
    // complete main region and let the rolling boundary parser split entries.
    changelogRootSelectors: ["main .sl-markdown-content", "main"],
  },
  "anthropic-claude-apps-release-notes": {
    changelogRootSelectors: ["main [class*=prose i]", "main"],
  },
  "anthropic-claude-code-changelog": {
    changelogRootSelectors: ["main [class*=prose i]", "main"],
  },
  "anthropic-platform-release-notes": {
    changelogRootSelectors: ["main [class*=prose i]", "main"],
  },
  "zai-release-notes": {
    changelogRootSelectors: ["main [class*=prose i]", "main"],
  },
};

export function getProviderProfile(
  source: SourceConfiguration,
): ProviderParsingProfile {
  return { ...BASE_PROFILE, ...(PROFILES[source.slug] ?? {}) };
}
