import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { canonicalizeUrl, urlIdentityKey } from "../collection/canonicalize.js";
import {
  hashExtractedText,
  normalizeTextForHash,
  sha256,
} from "../collection/content-hash.js";
import { countWords, extractArticle } from "../collection/extract-article.js";
import { fetchSurface, HttpStatusError } from "../collection/http.js";
import {
  OPENAI_NEWS_RSS_URL,
  openAiNewsMetadataFallback,
  parseOpenAiNewsRss,
} from "./openai-rss.js";
import { getProviderProfile } from "./provider-selectors.js";
import { parseZaiBlogSitemap, ZAI_BLOG_SITEMAP } from "./zai-source.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  DiscoveryResult,
  FetchedContent,
  SourceAdapter,
  SourceConfiguration,
} from "./types.js";

interface ArticleCandidate {
  url: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  description: string | null;
}

const QWEN_RESEARCH_RETRIEVAL_API =
  "https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=en-US";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstString(child);
      if (found) return found;
    }
  }
  const record = asRecord(value);
  if (record) {
    return firstString(record.name) ?? firstString(record.url) ?? null;
  }
  return null;
}

function validIsoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  if (parsed.valueOf() > Date.now() + 86_400_000) return null;
  return parsed.toISOString();
}

function qwenCanonicalUrl(
  source: SourceConfiguration,
  pathValue: string,
): string | null {
  try {
    const sourceUrl = new URL(source.url);
    const trimmed = pathValue.trim();
    const candidate = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(
          trimmed.replace(/^\/+/, "").startsWith("research/")
            ? `/${trimmed.replace(/^\/+/, "")}`
            : `/research/${trimmed.replace(/^\/+|\/+$/g, "")}`,
          sourceUrl,
        );
    if (
      candidate.hostname !== sourceUrl.hostname ||
      !/^\/research\/[^/]+\/?$/i.test(candidate.pathname)
    ) {
      return null;
    }
    return canonicalizeUrl(candidate.href);
  } catch {
    return null;
  }
}

export function parseQwenResearchRetrieval(
  source: SourceConfiguration,
  rawJson: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const payload: unknown = JSON.parse(rawJson);
  const payloadRecord = asRecord(payload);
  const data = asRecord(payloadRecord?.data);
  if (!payloadRecord || payloadRecord.success !== true || !Array.isArray(data?.articles)) {
    throw new Error("Qwen research retrieval payload did not contain data.articles");
  }

  const items: DiscoveredItem[] = [];
  for (const value of data.articles) {
    const article = asRecord(value);
    const extra = asRecord(article?.extra);
    if (!article || !extra) continue;
    const rawPath = firstString(article.path);
    const title = normalizeTextForHash(firstString(article.title) ?? "");
    if (!rawPath || title.length < 3) continue;
    const canonicalUrl = qwenCanonicalUrl(source, rawPath);
    if (!canonicalUrl) continue;

    const publishedAt = validIsoDate(firstString(extra.date));
    if (
      publishedAt &&
      new Date(publishedAt).valueOf() < context.since.valueOf()
    ) {
      continue;
    }
    const content = firstString(article.content);
    const extraction = content
      ? extractArticle(content, canonicalUrl, getProviderProfile(source).articleSelectors)
      : null;
    const description = firstString(extra.description);
    const author = firstString(extra.author) ?? firstString(article.author);
    const tags = Array.isArray(extra.tags)
      ? extra.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const extractedText = extraction?.text ?? "";

    items.push({
      sourceSlug: source.slug,
      identityKey: urlIdentityKey(canonicalUrl),
      externalId: firstString(article.id) ?? rawPath,
      canonicalUrl,
      kind: "MODEL_RELEASE",
      title,
      author,
      publishedAt,
      discoveryFingerprint: extractedText
        ? hashExtractedText(extractedText)
        : sha256(JSON.stringify([title, publishedAt, description, tags])),
      metadata: {
        description,
        tags,
        qwenPath: rawPath,
        discoveredFrom: source.url,
        collectionSurface: QWEN_RESEARCH_RETRIEVAL_API,
        extractionMethod: content ? "QWEN_RETRIEVAL_API" : null,
      },
      inlineContent: content
        ? {
            raw: Buffer.from(content, "utf8"),
            rawFormat: "HTML",
            extractedText,
          }
        : undefined,
    });
  }

  const unique = new Map<string, DiscoveredItem>();
  for (const item of items) unique.set(item.identityKey, item);
  return [...unique.values()]
    .sort((left, right) => {
      const leftDate = left.publishedAt ? new Date(left.publishedAt).valueOf() : 0;
      const rightDate = right.publishedAt ? new Date(right.publishedAt).valueOf() : 0;
      return rightDate - leftDate || left.identityKey.localeCompare(right.identityKey);
    })
    .slice(0, context.limit);
}

function dateFromText(value: string): string | null {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?\b/,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
    /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const parsed = validIsoDate(match?.[0] ?? null);
    if (parsed) return parsed;
  }
  return null;
}

function dateFromUrl(url: string): string | null {
  const match = new URL(url).pathname.match(/\/(20\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$)/);
  return match
    ? validIsoDate(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T00:00:00Z`)
    : null;
}

function candidateFromJsonLd(
  value: unknown,
  source: SourceConfiguration,
): ArticleCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((child) => candidateFromJsonLd(child, source));
  }
  const object = asRecord(value);
  if (!object) return [];

  const nested = object["@graph"]
    ? candidateFromJsonLd(object["@graph"], source)
    : [];
  const types = Array.isArray(object["@type"])
    ? object["@type"].map(String)
    : [String(object["@type"] ?? "")];
  if (!types.some((type) => /Article|BlogPosting|NewsArticle/i.test(type))) {
    return nested;
  }

  const rawUrl = firstString(object.url) ?? firstString(object.mainEntityOfPage);
  const title = firstString(object.headline) ?? firstString(object.name);
  if (!rawUrl || !title) return nested;

  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalizeUrl(rawUrl, source.url);
    if (!getProviderProfile(source).acceptsArticleUrl(new URL(canonicalUrl), source)) {
      return nested;
    }
  } catch {
    return nested;
  }

  return [
    ...nested,
    {
      url: canonicalUrl,
      title: normalizeTextForHash(title),
      author: firstString(object.author),
      publishedAt: validIsoDate(firstString(object.datePublished)),
      description: firstString(object.description),
    },
  ];
}

function closestCard($: CheerioAPI, link: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const card = link.closest("article, li, [class*=card i], [class*=item i]");
  return card.length ? card.first() : link.parent();
}

function discoverFromAnchors(
  $: CheerioAPI,
  source: SourceConfiguration,
): ArticleCandidate[] {
  const profile = getProviderProfile(source);
  const result: ArticleCandidate[] = [];
  const seenElements = new Set<AnyNode>();

  for (const selector of profile.listingLinkSelectors) {
    $(selector).each((_index, element) => {
      if (seenElements.has(element)) return;
      seenElements.add(element);
      const link = $(element);
      const href = link.attr("href");
      if (!href) return;

      try {
        const canonicalUrl = canonicalizeUrl(href, source.url);
        if (!profile.acceptsArticleUrl(new URL(canonicalUrl), source)) return;
        const card = closestCard($, link);
        const title = normalizeTextForHash(
          link.attr("aria-label") ||
            link.find("h2,h3,h4").first().text() ||
            card.find("h2,h3,h4").first().text() ||
            link.text(),
        );
        if (title.length < 3) return;
        const dateText =
          card.find("time[datetime]").first().attr("datetime") ||
          card.find("time").first().text() ||
          card.text();
        result.push({
          url: canonicalUrl,
          title,
          author: null,
          publishedAt: dateFromText(dateText) ?? dateFromUrl(canonicalUrl),
          description: null,
        });
      } catch {
        // Ignore malformed/non-HTTP links on listing pages.
      }
    });
  }
  return result;
}

export function parseArticleIndex(
  source: SourceConfiguration,
  html: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const $ = load(html);
  const candidates = discoverFromAnchors($, source);

  $("script[type='application/ld+json']").each((_index, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      candidates.push(...candidateFromJsonLd(parsed, source));
    } catch {
      // Live pages occasionally contain non-strict JSON-LD; anchors remain usable.
    }
  });

  const deduplicated = new Map<string, ArticleCandidate>();
  for (const candidate of candidates) {
    const existing = deduplicated.get(candidate.url);
    if (!existing || (!existing.publishedAt && candidate.publishedAt)) {
      deduplicated.set(candidate.url, { ...existing, ...candidate });
    }
  }

  const cutoff = context.since.valueOf();
  return [...deduplicated.values()]
    .filter((candidate) => {
      if (!candidate.publishedAt) return true;
      return new Date(candidate.publishedAt).valueOf() >= cutoff;
    })
    .sort((left, right) => {
      const leftDate = left.publishedAt ? new Date(left.publishedAt).valueOf() : 0;
      const rightDate = right.publishedAt ? new Date(right.publishedAt).valueOf() : 0;
      return rightDate - leftDate || left.url.localeCompare(right.url);
    })
    .slice(0, context.limit)
    .map((candidate): DiscoveredItem => ({
      sourceSlug: source.slug,
      identityKey: urlIdentityKey(candidate.url),
      externalId: null,
      canonicalUrl: candidate.url,
      kind: getProviderProfile(source).defaultKind,
      title: candidate.title,
      author: candidate.author,
      publishedAt: candidate.publishedAt,
      discoveryFingerprint: sha256(
        JSON.stringify([candidate.title, candidate.publishedAt, candidate.description]),
      ),
      metadata: {
        description: candidate.description,
        discoveredFrom: source.url,
      },
    }));
}

export class ArticleIndexAdapter implements SourceAdapter {
  async discover(
    source: SourceConfiguration,
    context: DiscoveryContext,
  ): Promise<DiscoveryResult> {
    const isOpenAiNews = source.slug === "openai-news";
    const isQwenResearch = source.slug === "qwen-research";
    const isZaiBlog = source.slug === "zai-blog";
    const surface = await fetchSurface(
      isOpenAiNews
        ? OPENAI_NEWS_RSS_URL
        : isQwenResearch
          ? QWEN_RESEARCH_RETRIEVAL_API
          : isZaiBlog
            ? ZAI_BLOG_SITEMAP
          : source.url,
      {
        accept: isOpenAiNews
          ? "application/rss+xml,application/xml,text/xml"
          : isQwenResearch
            ? "application/json"
            : isZaiBlog
              ? "application/xml,text/xml;q=0.9"
            : "text/html",
        headers: isQwenResearch
          ? { "x-request-id": globalThis.crypto.randomUUID() }
          : undefined,
      },
    );
    const raw = surface.rawBody.toString("utf8");
    const items = isOpenAiNews
      ? parseOpenAiNewsRss(source, raw, context)
      : isQwenResearch
        ? parseQwenResearchRetrieval(source, raw, context)
        : isZaiBlog
          ? parseZaiBlogSitemap(source, raw, context)
        : parseArticleIndex(source, raw, context);
    return { surface, items };
  }

  async fetch(
    source: SourceConfiguration,
    item: DiscoveredItem,
  ): Promise<FetchedContent> {
    if (item.inlineContent) {
      const text = item.inlineContent.extractedText;
      return {
        status: "FETCHED",
        rawContent: item.inlineContent.raw,
        rawFormat: item.inlineContent.rawFormat,
        extractedText: text,
        contentHash: hashExtractedText(text),
        wordCount: countWords(text),
        title: item.title,
        author: item.author,
        publishedAt: item.publishedAt,
        metadata: {
          ...item.metadata,
          fetchedUrl: item.canonicalUrl,
          contentType: "text/html",
        },
      };
    }
    let page;
    try {
      page = await fetchSurface(item.canonicalUrl, { accept: "text/html" });
    } catch (error) {
      if (
        source.slug === "openai-news" &&
        error instanceof HttpStatusError &&
        error.status === 403
      ) {
        return openAiNewsMetadataFallback(item, error.status);
      }
      throw error;
    }
    const html = page.rawBody.toString("utf8");
    const extraction = extractArticle(
      html,
      item.canonicalUrl,
      getProviderProfile(source).articleSelectors,
    );
    const title = extraction.title || item.title;
    const author = extraction.byline || item.author;
    const publishedAt = extraction.publishedAt || item.publishedAt;

    return {
      status: "FETCHED",
      rawContent: page.rawBody,
      rawFormat: "HTML",
      extractedText: extraction.text,
      contentHash: hashExtractedText(extraction.text),
      wordCount: countWords(extraction.text),
      title,
      author,
      publishedAt,
      metadata: {
        ...item.metadata,
        excerpt: extraction.excerpt,
        extractionMethod: extraction.method,
        fetchedUrl: page.url,
        httpStatus: page.httpStatus,
        contentType: page.contentType,
        etag: page.etag,
        lastModified: page.lastModified,
      },
    };
  }
}
