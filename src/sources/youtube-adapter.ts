import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { canonicalizeUrl, youtubeIdentityKey } from "../collection/canonicalize.js";
import { hashExtractedText, sha256 } from "../collection/content-hash.js";
import { countWords } from "../collection/extract-article.js";
import { fetchSurface, fetchWithRetry } from "../collection/http.js";
import { vttToText } from "../collection/vtt-to-text.js";
import type {
  DiscoveredItem,
  DiscoveryContext,
  DiscoveryResult,
  FetchedContent,
  SourceAdapter,
  SourceConfiguration,
} from "./types.js";

const execFileAsync = promisify(execFile);

interface YoutubeRssEntry {
  "yt:videoId"?: string;
  "yt:channelId"?: string;
  title?: string;
  published?: string;
  updated?: string;
  link?: { "@_href"?: string } | Array<{ "@_href"?: string }>;
  author?: { name?: string };
  "media:group"?: {
    "media:description"?: string;
    "media:thumbnail"?: { "@_url"?: string };
  };
}

interface SubtitleFormat {
  ext?: string;
  url?: string;
  name?: string;
  protocol?: string;
}

interface YtDlpInfo {
  id?: string;
  title?: string;
  webpage_url?: string;
  channel?: string;
  channel_id?: string;
  uploader?: string;
  uploader_id?: string;
  channel_url?: string;
  upload_date?: string;
  timestamp?: number;
  duration?: number;
  description?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  subtitles?: Record<string, SubtitleFormat[]>;
  automatic_captions?: Record<string, SubtitleFormat[]>;
  http_headers?: Record<string, string>;
  entries?: YtDlpInfo[];
}

export interface YtDlpOptions {
  binary?: string;
  timeoutMs?: number;
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePublishedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function youtubeRssUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

export function parseYoutubeRss(
  source: SourceConfiguration,
  xml: string,
  context: DiscoveryContext,
): DiscoveredItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const parsed = parser.parse(xml) as { feed?: { entry?: YoutubeRssEntry | YoutubeRssEntry[] } };
  const entries = arrayify(parsed.feed?.entry);
  const cutoff = context.since.valueOf();

  return entries
    .map((entry): DiscoveredItem | null => {
      const videoId = entry["yt:videoId"]?.trim();
      if (!videoId) return null;
      const publishedAt = parsePublishedAt(entry.published);
      if (
        !context.initialBackfill &&
        publishedAt &&
        new Date(publishedAt).valueOf() < cutoff
      ) {
        return null;
      }
      const linkValue = arrayify(entry.link)[0]?.["@_href"];
      const canonicalUrl = canonicalizeUrl(
        linkValue || `https://www.youtube.com/watch?v=${videoId}`,
      );
      const channel = entry.author?.name?.trim() || source.name;
      const description = entry["media:group"]?.["media:description"] ?? null;
      const thumbnailUrl = entry["media:group"]?.["media:thumbnail"]?.["@_url"] ?? null;
      return {
        sourceSlug: source.slug,
        identityKey: youtubeIdentityKey(videoId),
        externalId: videoId,
        canonicalUrl,
        kind: "VIDEO",
        title: entry.title?.trim() || `YouTube video ${videoId}`,
        author: channel,
        publishedAt,
        discoveryFingerprint: sha256(
          JSON.stringify([entry.title, entry.updated, description]),
        ),
        metadata: {
          channel,
          channelId: entry["yt:channelId"] ?? source.channelId ?? null,
          description,
          thumbnailUrl,
          rssUpdatedAt: parsePublishedAt(entry.updated),
        },
      };
    })
    .filter((entry): entry is DiscoveredItem => entry !== null)
    .sort((left, right) => {
      const leftDate = left.publishedAt ? new Date(left.publishedAt).valueOf() : 0;
      const rightDate = right.publishedAt ? new Date(right.publishedAt).valueOf() : 0;
      return rightDate - leftDate;
    })
    .slice(0, context.limit);
}

export async function runYtDlpJson(
  args: readonly string[],
  options: YtDlpOptions = {},
): Promise<YtDlpInfo> {
  const binary = options.binary ?? process.env.YT_DLP_PATH ?? "yt-dlp";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(binary, [...args], {
        timeout: options.timeoutMs ?? 45_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      });
      const trimmed = stdout.trim();
      if (!trimmed) throw new Error("yt-dlp returned no metadata");
      return JSON.parse(trimmed) as YtDlpInfo;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`yt-dlp metadata extraction failed after one retry: ${detail}`);
}

function languagePriority(language: string): number {
  const lower = language.toLowerCase();
  if (lower === "en") return 0;
  if (lower === "en-us") return 1;
  if (lower === "en-gb") return 2;
  if (/^en(?:[-_]|$)/.test(lower)) return 3;
  return 100;
}

function selectSubtitle(
  info: YtDlpInfo,
): { source: "CREATOR" | "AUTOMATIC"; language: string; format: SubtitleFormat } | null {
  const pools = [
    { source: "CREATOR" as const, tracks: info.subtitles ?? {} },
    { source: "AUTOMATIC" as const, tracks: info.automatic_captions ?? {} },
  ];
  for (const pool of pools) {
    const languages = Object.keys(pool.tracks)
      .filter((language) => languagePriority(language) < 100)
      .sort((left, right) => languagePriority(left) - languagePriority(right));
    for (const language of languages) {
      const formats = pool.tracks[language] ?? [];
      const format =
        formats.find((candidate) => candidate.ext?.toLowerCase() === "vtt" && candidate.url) ??
        formats.find((candidate) => candidate.url?.includes("fmt=vtt"));
      if (format?.url) return { source: pool.source, language, format };
    }
  }
  return null;
}

function uploadDate(info: YtDlpInfo): string | null {
  if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
    const date = new Date(
      `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}T00:00:00Z`,
    );
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  if (typeof info.timestamp === "number") return new Date(info.timestamp * 1000).toISOString();
  return null;
}

function bestThumbnail(info: YtDlpInfo): string | null {
  if (info.thumbnail) return info.thumbnail;
  return [...(info.thumbnails ?? [])]
    .sort(
      (left, right) =>
        (right.width ?? 0) * (right.height ?? 0) -
        (left.width ?? 0) * (left.height ?? 0),
    )[0]?.url ?? null;
}

function safeTrackHeaders(info: YtDlpInfo): Record<string, string> {
  const allowed = new Set(["accept", "accept-language", "origin", "referer", "user-agent"]);
  return Object.fromEntries(
    Object.entries(info.http_headers ?? {}).filter(
      ([name, value]) => allowed.has(name.toLowerCase()) && typeof value === "string",
    ),
  );
}

export async function resolveYoutubeChannelId(
  channelUrl: string,
  options: YtDlpOptions = {},
): Promise<{ channelId: string; channelName: string | null; channelUrl: string }> {
  const info = await runYtDlpJson(
    [
      "--flat-playlist",
      "--playlist-items",
      "1",
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--no-progress",
      channelUrl,
    ],
    options,
  );
  const channelId =
    info.channel_id ||
    info.entries?.find((entry) => entry.channel_id)?.channel_id ||
    (info.id?.startsWith("UC") ? info.id : null);
  if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) {
    throw new Error(`Could not resolve a stable YouTube channel ID for ${channelUrl}`);
  }
  return {
    channelId,
    channelName: info.channel ?? info.uploader ?? null,
    channelUrl: info.channel_url ?? `https://www.youtube.com/channel/${channelId}`,
  };
}

export class YoutubeChannelAdapter implements SourceAdapter {
  constructor(private readonly ytDlpOptions: YtDlpOptions = {}) {}

  async discover(
    source: SourceConfiguration,
    context: DiscoveryContext,
  ): Promise<DiscoveryResult> {
    if (!source.channelId) {
      throw new Error(
        `YouTube source ${source.slug} has no channelId; run the manual resolver first`,
      );
    }
    const surface = await fetchSurface(youtubeRssUrl(source.channelId), {
      accept: "application/atom+xml, application/xml, text/xml",
    });
    return {
      surface,
      items: parseYoutubeRss(source, surface.rawBody.toString("utf8"), context),
    };
  }

  async fetch(
    _source: SourceConfiguration,
    item: DiscoveredItem,
  ): Promise<FetchedContent> {
    const info = await runYtDlpJson(
      [
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        item.canonicalUrl,
      ],
      this.ytDlpOptions,
    );
    const selected = selectSubtitle(info);
    const metadata = {
      ...item.metadata,
      videoId: info.id ?? item.externalId,
      channel: info.channel ?? info.uploader ?? item.author,
      channelId: info.channel_id ?? null,
      durationSeconds: info.duration ?? null,
      description: info.description ?? item.metadata.description ?? null,
      thumbnailUrl: bestThumbnail(info) ?? item.metadata.thumbnailUrl ?? null,
      webpageUrl: info.webpage_url ?? item.canonicalUrl,
      creatorSubtitleLanguages: Object.keys(info.subtitles ?? {}),
      automaticSubtitleLanguages: Object.keys(info.automatic_captions ?? {}),
      transcriptSource: selected?.source ?? null,
      transcriptLanguage: selected?.language ?? null,
    };
    const common = {
      title: info.title ?? item.title,
      author: info.channel ?? info.uploader ?? item.author,
      publishedAt: uploadDate(info) ?? item.publishedAt,
      metadata,
    };

    if (!selected?.format.url) {
      const metadataPayload = Buffer.from(
        JSON.stringify({
          videoId: metadata.videoId,
          title: common.title,
          channel: common.author,
          publishedAt: common.publishedAt,
          durationSeconds: metadata.durationSeconds,
          description: metadata.description,
          thumbnailUrl: metadata.thumbnailUrl,
          webpageUrl: metadata.webpageUrl,
          transcriptSource: null,
        }),
        "utf8",
      );
      const metadataText = [common.title, metadata.description]
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .join("\n\n");
      return {
        ...common,
        status: "TRANSCRIPT_UNAVAILABLE",
        rawContent: metadataPayload,
        rawFormat: "JSON",
        extractedText: metadataText,
        contentHash: sha256(metadataPayload),
        wordCount: countWords(metadataText),
      };
    }

    const response = await fetchWithRetry(selected.format.url, {
      timeoutMs: 20_000,
      retries: 1,
      headers: safeTrackHeaders(info),
      accept: "text/vtt, text/plain",
    });
    const rawContent = Buffer.from(await response.arrayBuffer());
    const transcript = vttToText(rawContent.toString("utf8"));
    if (!transcript) {
      throw new Error(`Selected ${selected.source.toLowerCase()} subtitle track contained no VTT cues`);
    }

    return {
      ...common,
      status: "FETCHED",
      rawContent,
      rawFormat: "VTT",
      extractedText: transcript,
      contentHash: hashExtractedText(transcript),
      wordCount: countWords(transcript),
    };
  }
}
