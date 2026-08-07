import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import {
  canonicalizeUrl,
  changelogIdentityKey,
  urlIdentityKey,
} from "../collection/canonicalize.js";
import {
  hashExtractedText,
  normalizeTextForHash,
  sha256,
} from "../collection/content-hash.js";
import { countWords } from "../collection/extract-article.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  FetchedContent,
  SourceConfiguration,
} from "./types.js";

export const OPENAI_NEWS_RSS_URL = "https://openai.com/news/rss.xml";
export const OPENAI_PRODUCT_RELEASE_NOTES_RSS_URL =
  "https://openai.com/products/release-notes/rss.xml";

interface RssTextNode {
  "#text"?: string;
}

interface RssItem {
  title?: string | RssTextNode;
  description?: string | RssTextNode;
  link?: string | RssTextNode;
  guid?: string | RssTextNode;
  pubDate?: string | RssTextNode;
  category?: string | RssTextNode | Array<string | RssTextNode>;
  "content:encoded"?: string | RssTextNode;
  "dc:creator"?: string | RssTextNode;
  author?: string | RssTextNode;
}

interface ParsedRss {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[];
    };
  };
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function rssString(value: string | RssTextNode | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (
    value &&
    typeof value === "object" &&
    typeof value["#text"] === "string" &&
    value["#text"].trim()
  ) {
    return value["#text"].trim();
  }
  return null;
}

function plainFeedText(value: string | null): string {
  if (!value) return "";
  const $ = load(`<div data-rss-root>${value}</div>`);
  $("script,style,noscript").remove();
  $("[data-rss-root]")
    .find("br,p,div,li,h1,h2,h3,h4,h5,h6,section,article")
    .each((_index, element) => {
      $(element).append(" ");
    });
  return normalizeTextForHash($("[data-rss-root]").text());
}

function parsePublishedAt(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  if (parsed.valueOf() > Date.now() + 86_400_000) return null;
  return parsed.toISOString();
}

function parseRssItems(xml: string): RssItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const parsed = parser.parse(xml) as ParsedRss;
  if (!parsed.rss?.channel) {
    throw new Error("OpenAI RSS payload did not contain rss.channel");
  }
  return arrayify(parsed.rss.channel.item);
}

function categories(item: RssItem): string[] {
  return arrayify(item.category)
    .map((value) => rssString(value))
    .filter((value): value is string => value !== null);
}

function combinedText(title: string, body: string): string {
  if (!body) return title;
  return body.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())
    ? body
    : normalizeTextForHash(`${title}\n\n${body}`);
}

export function parseOpenAiNewsRss(
  source: SourceConfiguration,
  xml: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const cutoff = context.since.valueOf();
  const items = parseRssItems(xml).flatMap((entry): DiscoveredItem[] => {
    const title = normalizeTextForHash(rssString(entry.title) ?? "");
    const rawLink = rssString(entry.link) ?? rssString(entry.guid);
    if (title.length < 3 || !rawLink) return [];

    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(rawLink, source.url);
      const url = new URL(canonicalUrl);
      if (url.hostname !== new URL(source.url).hostname || !/^\/index\/[^/]+/i.test(url.pathname)) {
        return [];
      }
    } catch {
      return [];
    }

    const publishedAt = parsePublishedAt(rssString(entry.pubDate));
    if (publishedAt && new Date(publishedAt).valueOf() < cutoff) return [];
    const rawDescription = rssString(entry.description);
    const description = plainFeedText(rawDescription);
    const rssCategories = categories(entry);
    const guid = rssString(entry.guid);
    const author = rssString(entry["dc:creator"]) ?? rssString(entry.author);

    return [{
      sourceSlug: source.slug,
      identityKey: urlIdentityKey(canonicalUrl),
      externalId: guid,
      canonicalUrl,
      kind: "ANNOUNCEMENT",
      title,
      author,
      publishedAt,
      discoveryFingerprint: sha256(
        JSON.stringify([title, publishedAt, rawDescription, rssCategories, guid]),
      ),
      metadata: {
        description: description || null,
        discoveredFrom: source.url,
        collectionSurface: OPENAI_NEWS_RSS_URL,
        rssGuid: guid,
        rssLink: rawLink,
        rssCategories,
        rssDescription: rawDescription,
      },
    }];
  });

  return items
    .sort((left, right) => {
      const leftDate = left.publishedAt ? new Date(left.publishedAt).valueOf() : 0;
      const rightDate = right.publishedAt ? new Date(right.publishedAt).valueOf() : 0;
      return rightDate - leftDate || left.identityKey.localeCompare(right.identityKey);
    })
    .slice(0, context.limit);
}

export function openAiNewsMetadataFallback(
  item: DiscoveredItem,
  httpStatus: number,
): FetchedContent {
  const description =
    typeof item.metadata.description === "string" ? item.metadata.description : "";
  const extractedText = combinedText(item.title, description);
  const payload = Buffer.from(
    JSON.stringify({
      title: item.title,
      description: description || null,
      canonicalUrl: item.canonicalUrl,
      guid: item.metadata.rssGuid ?? item.externalId,
      categories: item.metadata.rssCategories ?? [],
      publishedAt: item.publishedAt,
    }),
    "utf8",
  );
  return {
    status: "FETCHED",
    rawContent: payload,
    rawFormat: "JSON",
    extractedText,
    contentHash: hashExtractedText(extractedText),
    wordCount: countWords(extractedText),
    title: item.title,
    author: item.author,
    publishedAt: item.publishedAt,
    metadata: {
      ...item.metadata,
      contentQuality: "METADATA_ONLY",
      extractionMethod: "RSS_METADATA_FALLBACK",
      linkedArticleHttpStatus: httpStatus,
      fetchedUrl: item.canonicalUrl,
    },
  };
}

export function parseOpenAiProductReleaseNotesRss(
  source: SourceConfiguration,
  xml: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const items = parseRssItems(xml).flatMap((entry): DiscoveredItem[] => {
    const title = normalizeTextForHash(rssString(entry.title) ?? "");
    if (title.length < 3) return [];
    const publishedAt = parsePublishedAt(rssString(entry.pubDate));
    if (
      context.initialBackfill &&
      publishedAt &&
      new Date(publishedAt).valueOf() < context.since.valueOf()
    ) {
      return [];
    }

    const rawDescription = rssString(entry.description);
    const rawContent = rssString(entry["content:encoded"]) ?? rawDescription ?? title;
    const body = plainFeedText(rawContent);
    const extractedText = combinedText(title, body);
    const guid = rssString(entry.guid);
    const link = rssString(entry.link);
    const rssCategories = categories(entry);
    const stableLabel = `${publishedAt?.slice(0, 10) ?? "undated"}:${title}`;
    const rawFormat = /<[a-z][\s\S]*>/i.test(rawContent) ? "HTML" : "TEXT";

    return [{
      sourceSlug: source.slug,
      identityKey: changelogIdentityKey(source.slug, stableLabel),
      externalId: guid,
      // Product release-note entries remain children of the configured rolling
      // surface even when the feed advertises an item-specific link.
      canonicalUrl: source.url,
      kind: "RELEASE_NOTE",
      title,
      author: rssString(entry["dc:creator"]) ?? rssString(entry.author),
      publishedAt,
      discoveryFingerprint: hashExtractedText(extractedText),
      metadata: {
        description: plainFeedText(rawDescription) || null,
        entryDate: publishedAt?.slice(0, 10) ?? null,
        sourceFormat: "RSS",
        discoveredFrom: source.url,
        collectionSurface: OPENAI_PRODUCT_RELEASE_NOTES_RSS_URL,
        rssGuid: guid,
        rssLink: link,
        rssCategories,
      },
      inlineContent: {
        raw: Buffer.from(rawContent, "utf8"),
        rawFormat,
        extractedText,
      },
    }];
  });

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
