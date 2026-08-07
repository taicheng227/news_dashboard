import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeTextForHash(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashExtractedText(value: string): string {
  return sha256(normalizeTextForHash(value));
}

/** Repository inputs remain raw; this helper is also useful for exports/tests. */
export function gzipRawPayload(value: string | Uint8Array): Buffer {
  return gzipSync(value, { level: 9 });
}

