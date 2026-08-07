import { Readability } from "@mozilla/readability";
import JSDOMParser from "@mozilla/readability/JSDOMParser.js";
import { load, type CheerioAPI } from "cheerio";
import { normalizeTextForHash } from "./content-hash.js";

export interface ArticleExtraction {
  title: string | null;
  byline: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  text: string;
  method: "READABILITY" | "SELECTOR" | "CHEERIO";
}

const CHROME_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "nav",
  "footer",
  "header[role=banner]",
  "[role=navigation]",
  "[aria-label*=cookie i]",
  "[class*=cookie i]",
  "[id*=cookie i]",
  "[class*=related i]",
  "[data-testid*=related i]",
  "[class*=newsletter i]",
  "[class*=social-share i]",
].join(",");

function cleanDocument(html: string): CheerioAPI {
  const $ = load(html);
  $(CHROME_SELECTORS).remove();
  $("[hidden], [aria-hidden=true]").remove();
  return $;
}

function readabilityMarkup($: CheerioAPI): string {
  // Mozilla's bundled lightweight parser expects XML-style void elements.
  // Cheerio has already repaired the live HTML, so this small serialization
  // adjustment avoids parser diagnostics without introducing a second DOM.
  return $.html().replace(
    /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^<>]*?)?>/gi,
    (tag) => (tag.endsWith("/>") ? tag : `${tag.slice(0, -1)}/>`),
  );
}

function textFromSelector($: CheerioAPI, selector: string): string {
  const root = $(selector).first().clone();
  root.find(CHROME_SELECTORS).remove();
  return normalizeTextForHash(root.text());
}

function metadataFromCheerio($: CheerioAPI): Omit<ArticleExtraction, "text" | "method"> {
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    null;
  const byline =
    $("meta[name='author']").attr("content")?.trim() ||
    $("[rel=author]").first().text().trim() ||
    null;
  const dateValue =
    $("meta[property='article:published_time']").attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    null;
  const parsedDate = dateValue ? new Date(dateValue) : null;
  const excerpt =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    null;

  return {
    title,
    byline,
    publishedAt:
      parsedDate && !Number.isNaN(parsedDate.valueOf())
        ? parsedDate.toISOString()
        : null,
    excerpt,
  };
}

/**
 * Readability gets first refusal. Cheerio serializes malformed live HTML into
 * the well-formed input expected by Mozilla's bundled lightweight DOM parser.
 */
export function extractArticle(
  html: string,
  url: string,
  preferredSelectors: readonly string[] = [],
): ArticleExtraction {
  const $ = cleanDocument(html);
  const metadata = metadataFromCheerio($);
  const serialized = readabilityMarkup($);

  try {
    const document = new JSDOMParser().parse(serialized);
    const readable = new Readability(document as never, {
      charThreshold: 160,
      keepClasses: false,
    }).parse();
    const readableText = normalizeTextForHash(readable?.textContent ?? "");
    if (readableText.length >= 160) {
      return {
        title: readable?.title?.trim() || metadata.title,
        byline: readable?.byline?.trim() || metadata.byline,
        publishedAt: readable?.publishedTime || metadata.publishedAt,
        excerpt: readable?.excerpt?.trim() || metadata.excerpt,
        text: readableText,
        method: "READABILITY",
      };
    }
  } catch {
    // A small selector/Cheerio fallback is intentionally sufficient for V1.
  }

  for (const selector of preferredSelectors) {
    const text = textFromSelector($, selector);
    if (text.length >= 120) return { ...metadata, text, method: "SELECTOR" };
  }

  const fallback =
    textFromSelector($, "article") ||
    textFromSelector($, "main") ||
    normalizeTextForHash($("body").text());

  if (!fallback) throw new Error(`No meaningful article text extracted from ${url}`);
  return { ...metadata, text: fallback, method: "CHEERIO" };
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
