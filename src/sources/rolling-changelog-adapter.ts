import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { marked } from "marked";
import {
  changelogIdentityKey,
  slugifyIdentityPart,
} from "../collection/canonicalize.js";
import {
  hashExtractedText,
  normalizeTextForHash,
} from "../collection/content-hash.js";
import { countWords } from "../collection/extract-article.js";
import { fetchSurface } from "../collection/http.js";
import {
  OPENAI_PRODUCT_RELEASE_NOTES_RSS_URL,
  parseOpenAiProductReleaseNotesRss,
} from "./openai-rss.js";
import { getProviderProfile } from "./provider-selectors.js";
import {
  parseZaiUpdateReleaseNotes,
  ZAI_RELEASE_NOTES_MARKDOWN,
} from "./zai-source.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  DiscoveryResult,
  FetchedContent,
  SourceAdapter,
  SourceConfiguration,
} from "./types.js";

interface Boundary {
  blockIndex: number;
  heading: Element;
  level: number;
  text: string;
  date: string | null;
  version: string | null;
}

const CLAUDE_CODE_RAW_CHANGELOG =
  "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";
const ANTHROPIC_PLATFORM_RELEASE_NOTES_MARKDOWN =
  "https://platform.claude.com/docs/en/release-notes/overview.md";

const MONTH_PATTERN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function parseHeadingDate(text: string): string | null {
  const clean = text.replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1").trim();
  const matches = [
    clean.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/)?.[0],
    clean.match(new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2},?\\s+20\\d{2}\\b`, "i"))?.[0],
    clean.match(new RegExp(`\\b\\d{1,2}\\s+${MONTH_PATTERN}\\s+20\\d{2}\\b`, "i"))?.[0],
    clean.match(/\b20\d{2}年\s*\d{1,2}月\s*\d{1,2}日\b/)?.[0],
  ];

  for (const match of matches) {
    if (!match) continue;
    const eastAsian = match.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    const candidate = eastAsian
      ? `${eastAsian[1]}-${eastAsian[2].padStart(2, "0")}-${eastAsian[3].padStart(2, "0")}T00:00:00Z`
      : match;
    const parsed = new Date(candidate);
    // Human-readable date-only strings are parsed in the process timezone.
    // Rebuild their calendar components at UTC midnight so local development
    // and Railway persist the same release date.
    const timestamp = eastAsian || /^20\d{2}-\d{1,2}-\d{1,2}$/.test(candidate)
      ? parsed.valueOf()
      : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (!Number.isNaN(timestamp) && timestamp <= Date.now() + 86_400_000) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
}

function parseVersion(text: string): string | null {
  const match = text.match(
    /(?:^|\b)(?:version\s+|release\s+|v)?(\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)(?:\b|$)/i,
  );
  return match?.[1] ?? null;
}

function headingLevel(element: Element): number {
  return Number(element.name.slice(1));
}

function isHeading(node: AnyNode): node is Element {
  return node.type === "tag" && /^h[1-4]$/i.test(node.name);
}

function chooseRoot($: CheerioAPI, source: SourceConfiguration) {
  for (const selector of getProviderProfile(source).changelogRootSelectors) {
    const candidate = $(selector).first();
    if (candidate.length) return candidate;
  }
  return $("body").first();
}

function serializeBlocks(
  $: CheerioAPI,
  blocks: AnyNode[],
  start: number,
  end: number,
): Buffer {
  const html = blocks
    .slice(start, end)
    .map((block) => $.html(block))
    .join("\n");
  return Buffer.from(`<section>${html}</section>`, "utf8");
}

function blockText($: CheerioAPI, blocks: AnyNode[], start: number, end: number): string {
  const lines: string[] = [];
  for (const block of blocks.slice(start, end)) {
    const text = normalizeTextForHash($(block).text());
    if (!text || lines.at(-1) === text) continue;
    lines.push(text);
  }
  return normalizeTextForHash(lines.join("\n\n"));
}

function firstStrongLabel(
  $: CheerioAPI,
  blocks: AnyNode[],
  start: number,
  end: number,
): string | null {
  for (const block of blocks.slice(start, end)) {
    const label = normalizeTextForHash($(block).find("strong,b").first().text());
    if (label.length >= 3 && label.length <= 120) return label;
  }
  return null;
}

function previousDate(boundaries: Boundary[], index: number): string | null {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (boundaries[cursor]?.date) return boundaries[cursor].date;
  }
  return null;
}

function dateFromBlocks(
  $: CheerioAPI,
  blocks: AnyNode[],
  start: number,
  end: number,
): string | null {
  for (const block of blocks.slice(start, end)) {
    const element = $(block);
    const datetime = element.find("time[datetime]").first().attr("datetime");
    if (datetime) {
      const parsed = new Date(datetime);
      if (
        !Number.isNaN(parsed.valueOf()) &&
        parsed.valueOf() <= Date.now() + 86_400_000
      ) {
        return parsed.toISOString();
      }
    }
    const fromText = parseHeadingDate(element.text());
    if (fromText) return fromText;
  }
  return null;
}

function markdownToText(markdown: string): string {
  return normalizeTextForHash(
    markdown
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_~]/g, ""),
  );
}

export function parseMarkdownChangelog(
  source: SourceConfiguration,
  markdown: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const matches = [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)];
  return matches
    .map((match, index): DiscoveredItem | null => {
      const heading = normalizeTextForHash(match[1]);
      const version = parseVersion(heading);
      if (!version) return null;
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? markdown.length;
      const rawText = markdown.slice(start, end).trim();
      const extractedText = markdownToText(rawText);
      if (!extractedText) return null;
      return {
        sourceSlug: source.slug,
        identityKey: changelogIdentityKey(source.slug, version),
        externalId: version,
        canonicalUrl: source.url,
        kind: "RELEASE_NOTE",
        title: `${source.name} ${version}`,
        author: null,
        publishedAt: null,
        discoveryFingerprint: hashExtractedText(extractedText),
        metadata: {
          changelogHeading: heading,
          version,
          entryDate: null,
          sourceFormat: "MARKDOWN",
        },
        inlineContent: {
          raw: Buffer.from(rawText, "utf8"),
          rawFormat: "TEXT",
          extractedText,
        },
      };
    })
    .filter((item): item is DiscoveredItem => item !== null)
    // The upstream version-only changelog has no trustworthy publication
    // dates. Its newest-first ordering plus the V1 cap is the deterministic
    // bounded fallback.
    .slice(0, context.limit);
}

/** Parse a dated Markdown release-note surface through the same boundary logic
 * used for server-rendered changelogs. The configured source remains the
 * canonical identity even when its official collection representation moved.
 */
export function parseDatedMarkdownReleaseNotes(
  source: SourceConfiguration,
  markdown: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const rendered = marked.parse(markdown, { async: false, gfm: true });
  if (typeof rendered !== "string") {
    throw new Error(`Markdown rendering unexpectedly became asynchronous for ${source.slug}`);
  }
  return parseRollingChangelog(source, `<main>${rendered}</main>`, context).map(
    (item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        sourceFormat: "MARKDOWN",
        collectionSurface: ANTHROPIC_PLATFORM_RELEASE_NOTES_MARKDOWN,
      },
    }),
  );
}

export function parseRollingChangelog(
  source: SourceConfiguration,
  html: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const $ = load(html);
  const root = chooseRoot($, source).clone();
  root
    .find(
      "script,style,noscript,nav,footer,[aria-label*=cookie i],[class*=cookie i],[hidden],[aria-hidden=true]",
    )
    .remove();

  const blocks = root.find("h1,h2,h3,h4,p,li,pre,table").toArray();
  const boundaries: Boundary[] = [];
  blocks.forEach((block, blockIndex) => {
    if (!isHeading(block) || block.name.toLowerCase() === "h1") return;
    const text = normalizeTextForHash($(block).text());
    const date = parseHeadingDate(text);
    const version = parseVersion(text);
    if (!date && !version) return;
    boundaries.push({
      blockIndex,
      heading: block,
      level: headingLevel(block),
      text,
      date,
      version,
    });
  });

  const items: DiscoveredItem[] = [];
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
    const boundary = boundaries[boundaryIndex];
    const nextBoundary = boundaries[boundaryIndex + 1];
    const end = nextBoundary?.blockIndex ?? blocks.length;
    const datedAt =
      boundary.date ??
      dateFromBlocks($, blocks, boundary.blockIndex + 1, end) ??
      previousDate(boundaries, boundaryIndex - 1);
    // The 30-day boundary constrains the first import. On later runs we
    // reconcile a bounded set from the evolving page so edits to older entries
    // are not hidden merely because their original publication date is old.
    if (
      context.initialBackfill &&
      datedAt &&
      new Date(datedAt).valueOf() < context.since.valueOf()
    ) {
      continue;
    }

    const childHeadings = blocks
      .slice(boundary.blockIndex + 1, end)
      .map((block, offset) => ({ block, index: boundary.blockIndex + 1 + offset }))
      .filter(
        ({ block }) =>
          isHeading(block) && headingLevel(block) > boundary.level,
      );

    // A version is the stable discrete item. Keep all of its feature/fix
    // subsections together; otherwise each child shares the same identity and
    // the final Map dedupe would retain only the last subsection.
    const sections = boundary.version
      ? [
          {
            start: boundary.blockIndex,
            end,
            title: boundary.text,
          },
        ]
      : childHeadings.length
      ? childHeadings.map(({ block, index }, childIndex) => ({
          start: index,
          end: childHeadings[childIndex + 1]?.index ?? end,
          title: normalizeTextForHash($(block).text()),
        }))
      : [
          {
            start: boundary.blockIndex,
            end,
            title:
              boundary.text ||
              firstStrongLabel($, blocks, boundary.blockIndex + 1, end) ||
              "Release note",
          },
        ];

    for (const section of sections) {
      // A dated parent immediately followed by a version heading is structural
      // context, not a release-note item of its own.
      if (
        section.start === boundary.blockIndex &&
        section.end <= boundary.blockIndex + 1 &&
        nextBoundary &&
        nextBoundary.level > boundary.level
      ) {
        continue;
      }
      const text = blockText($, blocks, section.start, section.end);
      if (text.length < 8) continue;
      const strongLabel = firstStrongLabel($, blocks, section.start, section.end);
      const displayTitle =
        childHeadings.length || boundary.version
          ? section.title
          : strongLabel
            ? `${boundary.text}: ${strongLabel}`
            : boundary.text;
      const stableLabel = boundary.version
        ? boundary.version
        : `${datedAt?.slice(0, 10) ?? boundary.text}:${slugifyIdentityPart(displayTitle)}`;
      const raw = serializeBlocks($, blocks, section.start, section.end);
      const contentHash = hashExtractedText(text);
      items.push({
        sourceSlug: source.slug,
        identityKey: changelogIdentityKey(source.slug, stableLabel),
        externalId: boundary.version,
        canonicalUrl: source.url,
        kind: "RELEASE_NOTE",
        title: displayTitle,
        author: null,
        publishedAt: datedAt,
        discoveryFingerprint: contentHash,
        metadata: {
          changelogHeading: boundary.text,
          version: boundary.version,
          entryDate: datedAt?.slice(0, 10) ?? null,
        },
        inlineContent: {
          raw,
          rawFormat: "HTML",
          extractedText: text,
        },
      });
    }
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

export class RollingChangelogAdapter implements SourceAdapter {
  async discover(
    source: SourceConfiguration,
    context: DiscoveryContext,
  ): Promise<DiscoveryResult> {
    const isClaudeCodeMarkdown = source.slug === "anthropic-claude-code-changelog";
    const isAnthropicPlatformMarkdown =
      source.slug === "anthropic-platform-release-notes";
    const isOpenAiProductRss = source.slug === "openai-product-release-notes";
    const isZaiReleaseNotes = source.slug === "zai-release-notes";
    const collectionUrl = isOpenAiProductRss
      ? OPENAI_PRODUCT_RELEASE_NOTES_RSS_URL
      : isClaudeCodeMarkdown
        ? CLAUDE_CODE_RAW_CHANGELOG
        : isAnthropicPlatformMarkdown
          ? ANTHROPIC_PLATFORM_RELEASE_NOTES_MARKDOWN
          : isZaiReleaseNotes
            ? ZAI_RELEASE_NOTES_MARKDOWN
          : source.url;
    const surface = await fetchSurface(
      collectionUrl,
      {
        accept:
          isOpenAiProductRss
            ? "application/rss+xml,application/xml,text/xml"
            : isClaudeCodeMarkdown ||
                isAnthropicPlatformMarkdown ||
                isZaiReleaseNotes
            ? "text/markdown,text/plain;q=0.9"
            : "text/html",
      },
    );
    return {
      surface,
      items: isOpenAiProductRss
        ? parseOpenAiProductReleaseNotesRss(
            source,
            surface.rawBody.toString("utf8"),
            context,
          )
        : isClaudeCodeMarkdown
        ? parseMarkdownChangelog(
            source,
            surface.rawBody.toString("utf8"),
            context,
          )
        : isAnthropicPlatformMarkdown
          ? parseDatedMarkdownReleaseNotes(
              source,
              surface.rawBody.toString("utf8"),
              context,
            )
        : isZaiReleaseNotes
          ? parseZaiUpdateReleaseNotes(
              source,
              surface.rawBody.toString("utf8"),
              context,
            )
        : parseRollingChangelog(
            source,
            surface.rawBody.toString("utf8"),
            context,
          ),
    };
  }

  async fetch(
    _source: SourceConfiguration,
    item: DiscoveredItem,
  ): Promise<FetchedContent> {
    if (!item.inlineContent) {
      throw new Error(`Rolling entry ${item.identityKey} has no inline content`);
    }
    const text = item.inlineContent.extractedText;
    return {
      status: "FETCHED",
      rawContent: item.inlineContent.raw,
      rawFormat: item.inlineContent.rawFormat,
      extractedText: text,
      contentHash: hashExtractedText(text),
      wordCount: countWords(text),
      metadata: item.metadata,
    };
  }
}
