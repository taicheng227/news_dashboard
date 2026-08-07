import { load } from "cheerio";
import { normalizeTextForHash } from "./content-hash.js";

export interface VttToTextOptions {
  /** Start a new timestamped block at approximately this cadence. */
  timestampIntervalSeconds?: number;
  /** A silence this long is also treated as a useful paragraph boundary. */
  paragraphGapSeconds?: number;
}

interface Cue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function stripCueMarkup(value: string): string {
  const withoutInlineTimes = value.replace(
    /<(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}>/g,
    "",
  );
  const $ = load(`<div>${withoutInlineTimes}</div>`, null, false);
  return normalizeTextForHash($("div").text().replace(/\u200b/g, ""));
}

export function parseVtt(vtt: string): Cue[] {
  const normalized = vtt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(
      /^\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/,
    );
    if (!timing) continue;
    const startSeconds = parseTimestamp(timing[1]);
    const endSeconds = parseTimestamp(timing[2]);
    if (startSeconds === null || endSeconds === null) continue;

    const uniqueLines: string[] = [];
    for (const line of lines.slice(timingIndex + 1)) {
      const clean = stripCueMarkup(line);
      if (!clean || uniqueLines.at(-1) === clean) continue;
      const previous = uniqueLines.at(-1);
      if (previous && clean.startsWith(`${previous} `)) {
        uniqueLines[uniqueLines.length - 1] = clean;
        continue;
      }
      if (previous && previous.startsWith(`${clean} `)) continue;
      uniqueLines.push(clean);
    }
    const text = normalizeTextForHash(uniqueLines.join(" "));
    if (text) cues.push({ startSeconds, endSeconds, text });
  }
  return cues;
}

function words(value: string): string[] {
  return value.split(/\s+/u).filter(Boolean);
}

function normalizedToken(value: string): string {
  return value.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Return only words not already present in the rolling-caption tail. */
function rollingDelta(previous: string[], incomingText: string): string[] {
  const incoming = words(incomingText);
  if (!incoming.length) return [];
  const prior = previous.map(normalizedToken);
  const next = incoming.map(normalizedToken);
  const maxOverlap = Math.min(prior.length, next.length, 80);

  for (let size = maxOverlap; size > 0; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (prior[prior.length - size + index] !== next[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return incoming.slice(size);
  }

  // A shorter cue is often a rollback of the current rolling caption.
  if (next.length <= prior.length) {
    const tail = prior.slice(-Math.min(prior.length, 80)).join(" ");
    if (tail.includes(next.join(" "))) return [];
  }
  return incoming;
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function vttToText(
  vtt: string,
  options: VttToTextOptions = {},
): string {
  const cues = parseVtt(vtt);
  if (!cues.length) return "";

  const timestampInterval = options.timestampIntervalSeconds ?? 60;
  const paragraphGap = options.paragraphGapSeconds ?? 4;
  const output: string[] = [];
  let paragraph: string[] = [];
  let recentWords: string[] = [];
  let lastCueEnd = cues[0].startSeconds;
  let nextTimestampAt = cues[0].startSeconds;

  const flush = () => {
    if (!paragraph.length) return;
    output.push(paragraph.join(" ").replace(/\s+([,.;!?])/g, "$1").trim());
    paragraph = [];
  };

  for (const cue of cues) {
    const delta = rollingDelta(recentWords, cue.text);
    const cueWords = words(cue.text);
    if (delta.length) {
      const timestampDue = cue.startSeconds >= nextTimestampAt;
      const gap = cue.startSeconds - lastCueEnd;
      if (timestampDue || gap >= paragraphGap) flush();
      if (timestampDue) {
        output.push(`[${formatTimestamp(cue.startSeconds)}]`);
        nextTimestampAt = cue.startSeconds + timestampInterval;
      }
      paragraph.push(delta.join(" "));
    }
    recentWords = [...recentWords, ...delta].slice(-120);
    // If overlap detection found no delta, retaining the cue itself improves the
    // next comparison after a caption window resets.
    if (!recentWords.length) recentWords = cueWords.slice(-120);
    lastCueEnd = Math.max(lastCueEnd, cue.endSeconds);
  }
  flush();

  return output.join("\n\n").trim();
}
