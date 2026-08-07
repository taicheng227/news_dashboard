export interface CollectionRunSummary {
  id: number | string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  sourcesChecked: number;
  itemsDiscovered: number;
  itemsCreated: number;
  snapshotsCreated: number;
  errors: unknown[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runRemoteCollection(): Promise<CollectionRunSummary> {
  const baseUrl = required("AI_RADAR_BASE_URL").replace(/\/$/, "");
  const adminToken = required("AI_RADAR_ADMIN_TOKEN");
  const response = await fetch(`${baseUrl}/internal/collection/run`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(20 * 60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Collection request failed (${response.status}): ${text.slice(0, 1_000)}`);
  }
  return JSON.parse(text) as CollectionRunSummary;
}
