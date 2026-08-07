const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref_src",
  "ref_url",
  "source",
]);

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower);
}

export function canonicalizeUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    if (videoId) {
      url.hostname = "www.youtube.com";
      url.pathname = "/watch";
      url.search = "";
      url.searchParams.set("v", videoId);
    }
  }

  if (url.hostname === "youtube.com") {
    url.hostname = "www.youtube.com";
  }

  if (url.hostname.endsWith("youtube.com") && url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    url.search = "";
    if (videoId) url.searchParams.set("v", videoId);
  } else {
    const retained = [...url.searchParams.entries()]
      .filter(([name]) => !isTrackingParameter(name))
      .sort(([leftName, leftValue], [rightName, rightValue]) =>
        leftName === rightName
          ? leftValue.localeCompare(rightValue)
          : leftName.localeCompare(rightName),
      );
    url.search = "";
    for (const [name, value] of retained) url.searchParams.append(name, value);
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
}

export function urlIdentityKey(url: string, base?: string): string {
  return `url:${canonicalizeUrl(url, base)}`;
}

export function youtubeIdentityKey(videoId: string): string {
  return `youtube:${videoId.trim()}`;
}

export function slugifyIdentityPart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "entry";
}

export function changelogIdentityKey(
  sourceSlug: string,
  stableLabel: string,
): string {
  return `changelog:${slugifyIdentityPart(sourceSlug)}:${slugifyIdentityPart(stableLabel)}`;
}

