import { XMLParser } from "fast-xml-parser";
import {
  canonicalizeUrl,
  changelogIdentityKey,
  slugifyIdentityPart,
  urlIdentityKey,
} from "../collection/canonicalize.js";
import {
  hashExtractedText,
  normalizeTextForHash,
  sha256,
} from "../collection/content-hash.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  SourceConfiguration,
} from "./types.js";

export const ZAI_RELEASE_NOTES_MARKDOWN =
  "https://docs.z.ai/release-notes/new-released.md";
export const ZAI_BLOG_SITEMAP = "https://z.ai/sitemap.xml";

interface SitemapEntry {
  loc?: string;
  lastmod?: string;
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function validDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.valueOf() > Date.now() + 86_400_000
  ) {
    return null;
  }
  return parsed.toISOString();
}

function titleFromBlogUrl(url: URL): string {
  const encodedSlug = url.pathname.split("/").filter(Boolean).at(-1) ?? "post";
  let slug = encodedSlug;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    // Retain the encoded path segment if it is malformed.
  }
  return normalizeTextForHash(
    slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => (part.toLowerCase() === "glm" ? "GLM" : part))
      .join(" "),
  );
}

/** Parse only first-level Z.ai blog post URLs from its official sitemap. */
export function parseZaiBlogSitemap(
  source: SourceConfiguration,
  xml: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const parsed = parser.parse(xml) as {
    urlset?: { url?: SitemapEntry | SitemapEntry[] };
  };
  const items: Array<DiscoveredItem & { sitemapOrder: number }> = [];

  arrayify(parsed.urlset?.url).forEach((entry, sitemapOrder) => {
    if (typeof entry.loc !== "string") return;
    let url: URL;
    try {
      url = new URL(entry.loc);
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "z.ai" ||
      !/^\/blog\/[^/]+\/?$/.test(url.pathname)
    ) {
      return;
    }
    url.search = "";
    url.hash = "";
    const canonicalUrl = canonicalizeUrl(url.href);
    const sitemapLastModified = validDate(entry.lastmod);
    items.push({
      sourceSlug: source.slug,
      identityKey: urlIdentityKey(canonicalUrl),
      externalId: null,
      canonicalUrl,
      kind: "MODEL_RELEASE",
      title: titleFromBlogUrl(new URL(canonicalUrl)),
      author: null,
      // Sitemap lastmod is a change signal, not a publication date. The
      // article fetch supplies the real date when the page exposes one.
      publishedAt: null,
      discoveryFingerprint: sha256(
        JSON.stringify([canonicalUrl, sitemapLastModified]),
      ),
      metadata: {
        discoveredFrom: ZAI_BLOG_SITEMAP,
        collectionSurface: ZAI_BLOG_SITEMAP,
        sitemapLastModified,
        sourceFormat: "XML_SITEMAP",
      },
      sitemapOrder,
    });
  });

  const unique = new Map<string, DiscoveredItem & { sitemapOrder: number }>();
  for (const item of items) unique.set(item.identityKey, item);
  return [...unique.values()]
    .sort((left, right) => {
      const leftDate = left.metadata.sitemapLastModified;
      const rightDate = right.metadata.sitemapLastModified;
      return (
        (typeof rightDate === "string" ? new Date(rightDate).valueOf() : 0) -
          (typeof leftDate === "string" ? new Date(leftDate).valueOf() : 0) ||
        left.sitemapOrder - right.sitemapOrder
      );
    })
    .slice(0, context.limit)
    .map(({ sitemapOrder: _sitemapOrder, ...item }) => item);
}

function componentAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? null;
}

function exactDateLabel(value: string | null): string | null {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    parsed.valueOf() > Date.now() + 86_400_000
  ) {
    return null;
  }
  return parsed.toISOString();
}

function markdownToText(markdown: string): string {
  return normalizeTextForHash(
    markdown
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
      .replace(/[*_~]/g, ""),
  );
}

/** Split the official Mintlify Markdown `<Update>` components into entries. */
export function parseZaiUpdateReleaseNotes(
  source: SourceConfiguration,
  markdown: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const matches = [
    ...markdown.matchAll(/<Update\b([^>]*)>([\s\S]*?)<\/Update\s*>/gi),
  ];
  const items: DiscoveredItem[] = [];

  for (const match of matches) {
    const publishedAt = exactDateLabel(componentAttribute(match[1], "label"));
    const title = normalizeTextForHash(
      componentAttribute(match[1], "description") ?? "",
    );
    if (!publishedAt || title.length < 3) continue;
    if (
      context.initialBackfill &&
      new Date(publishedAt).valueOf() < context.since.valueOf()
    ) {
      continue;
    }

    const rawText = match[0].trim();
    const extractedText = markdownToText(`${title}\n\n${match[2]}`);
    if (extractedText.length < 8) continue;
    const entryDate = publishedAt.slice(0, 10);
    const stableLabel = `${entryDate}:${slugifyIdentityPart(title)}`;
    items.push({
      sourceSlug: source.slug,
      identityKey: changelogIdentityKey(source.slug, stableLabel),
      externalId: null,
      canonicalUrl: source.url,
      kind: "RELEASE_NOTE",
      title,
      author: null,
      publishedAt,
      discoveryFingerprint: hashExtractedText(extractedText),
      metadata: {
        changelogHeading: title,
        version: null,
        entryDate,
        sourceFormat: "MARKDOWN_UPDATE",
        collectionSurface: ZAI_RELEASE_NOTES_MARKDOWN,
      },
      inlineContent: {
        raw: Buffer.from(rawText, "utf8"),
        rawFormat: "TEXT",
        extractedText,
      },
    });
  }

  const unique = new Map<string, DiscoveredItem>();
  for (const item of items) unique.set(item.identityKey, item);
  return [...unique.values()]
    .sort((left, right) => {
      const dateDelta =
        new Date(right.publishedAt ?? 0).valueOf() -
        new Date(left.publishedAt ?? 0).valueOf();
      return dateDelta || left.identityKey.localeCompare(right.identityKey);
    })
    .slice(0, context.limit);
}
