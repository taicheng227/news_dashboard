import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import {
  NEWSLETTER_CLOSING,
  NEWSLETTER_SECTIONS,
  type DailyNewsletterOutput,
  type NewsletterEntry,
  type NewsletterSection,
} from "./validate-output.js";

export interface NewsletterSource {
  itemId: string;
  title: string;
  canonicalUrl: string | null;
}

export interface RenderedNewsletter {
  markdown: string;
  html: string;
}

const SECTION_HEADINGS: Record<NewsletterSection, string> = {
  IMPORTANT: "Important",
  WORTH_KNOWING: "Worth Knowing",
  FROM_YOUTUBE: "From YouTube",
  WATCHLIST: "Watchlist",
};

/** Collapse model prose to one line and neutralize every Markdown control rune. */
export function escapeMarkdownInline(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_[\]{}()<>#+.!|~-])/g, "\\$1");
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return null;
  }
}

function renderSources(entry: NewsletterEntry, sourceById: Map<string, NewsletterSource>): string {
  return entry.sourceItemIds
    .map((itemId) => {
      const source = sourceById.get(itemId);
      if (!source) throw new Error(`Cannot render unknown newsletter source ${itemId}`);
      const label = escapeMarkdownInline(source.title);
      const url = safeHttpUrl(source.canonicalUrl);
      return url ? `[${label}](${url})` : `${label} \(stored source\)`;
    })
    .join("; ");
}

function renderEntry(entry: NewsletterEntry, sourceById: Map<string, NewsletterSource>): string[] {
  const lines = [
    `### ${entry.rank}. ${escapeMarkdownInline(entry.headline)}`,
    "",
    escapeMarkdownInline(entry.summary),
    "",
    `**Why it matters:** ${escapeMarkdownInline(entry.whyItMatters)}`,
  ];

  if (entry.caveats.length > 0) {
    lines.push("", "**Caveats:**");
    for (const caveat of entry.caveats) lines.push(`- ${escapeMarkdownInline(caveat)}`);
  }

  lines.push("", `**Sources:** ${renderSources(entry, sourceById)}`, "");
  return lines;
}

function sanitizeRenderedHtml(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false, gfm: false }) as string;
  return sanitizeHtml(rendered, {
    allowedTags: ["h1", "h2", "h3", "p", "blockquote", "strong", "ul", "li", "a", "hr"],
    allowedAttributes: {
      a: ["href", "rel"],
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesAppliedToAttributes: ["href"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          href: attributes.href ?? "",
          rel: "noopener noreferrer",
        },
      }),
    },
  }).trim();
}

/**
 * Render immutable newsletter artifacts from already validated structured data.
 * Model prose is always emitted as escaped inline text and the generated HTML is
 * sanitized before persistence.
 */
export function renderNewsletter(
  output: DailyNewsletterOutput,
  sources: readonly NewsletterSource[],
): RenderedNewsletter {
  const sourceById = new Map(sources.map((source) => [source.itemId, source]));
  const lines: string[] = [
    `# ${escapeMarkdownInline(output.title)}`,
    "",
    `> ${escapeMarkdownInline(output.dek)}`,
    "",
    `**Edition:** ${output.editionDate}`,
  ];

  for (const section of NEWSLETTER_SECTIONS) {
    const entries = output.entries
      .filter((entry) => entry.section === section)
      .sort((left, right) => left.rank - right.rank);
    if (entries.length === 0) continue;
    lines.push("", `## ${SECTION_HEADINGS[section]}`, "");
    entries.forEach((entry) => lines.push(...renderEntry(entry, sourceById)));
    if (lines.at(-1) === "") lines.pop();
  }

  lines.push("", "---", "", NEWSLETTER_CLOSING);
  const markdown = lines.join("\n");
  if (!markdown.endsWith(NEWSLETTER_CLOSING)) {
    throw new Error("Rendered newsletter does not end with the required closing");
  }

  return {
    markdown,
    html: sanitizeRenderedHtml(markdown),
  };
}
