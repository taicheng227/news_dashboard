import { sha256 } from "./content-hash.js";
import type { SurfacePayload } from "../sources/types.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 AI-Radar/1.0";

export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`HTTP ${status} while fetching ${url}`);
    this.name = "HttpStatusError";
  }
}

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: HeadersInit;
  accept?: string;
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || error instanceof DOMException;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            `Fetch timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
            "TimeoutError",
          ),
        ),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const headers = new Headers(options.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT);
      if (options.accept && !headers.has("accept")) headers.set("accept", options.accept);
      if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9");

      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1_000);
        throw new HttpStatusError(url, response.status, body);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

export async function fetchSurface(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<SurfacePayload> {
  const response = await fetchWithRetry(url, options);
  const rawBody = Buffer.from(await response.arrayBuffer());
  return {
    url: response.url || url,
    fetchedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    rawBody,
    contentHash: sha256(rawBody),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}
