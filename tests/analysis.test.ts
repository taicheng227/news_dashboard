import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDailyNewsletter } from "../scripts/run-daily-newsletter.js";
import { writeCandidateBundle } from "../src/analysis/export-candidates.js";
import { renderNewsletter } from "../src/analysis/render-newsletter.js";
import {
  NewsletterValidationError,
  validateNewsletterOutput,
} from "../src/analysis/validate-output.js";

const candidates = [
  { itemId: "item-1", snapshotId: "snapshot-1", title: "Official release", canonicalUrl: "https://example.com/release" },
  { itemId: "item-2", snapshotId: "snapshot-2", title: "Creator analysis", canonicalUrl: "https://youtube.com/watch?v=abc" },
];

function validOutput() {
  return {
    editionDate: "2026-08-07",
    title: "Two useful shifts in AI tooling",
    dek: "A release and one practical workflow worth understanding.",
    quietDay: false,
    assessments: [
      {
        itemId: "item-1",
        snapshotId: "snapshot-1",
        disposition: "INCLUDE",
        importance: 5,
        category: "CODING_AGENT",
        confidence: "HIGH",
        summary: "The official release adds delegated coding work.",
        whyItMatters: "Independent subtasks can now run in parallel.",
        keyPoints: ["Delegation is now built in."],
        caveats: [],
      },
      {
        itemId: "item-2",
        snapshotId: "snapshot-2",
        disposition: "ARCHIVE",
        importance: 2,
        category: "COMMENTARY",
        confidence: "MEDIUM",
        summary: "The video comments on the same release.",
        whyItMatters: "It adds limited practical context.",
        keyPoints: [],
        caveats: ["Creator opinion, not official documentation."],
      },
    ],
    entries: [
      {
        section: "IMPORTANT",
        rank: 1,
        headline: "Coding agents can delegate real subtasks",
        sourceItemIds: ["item-1", "item-2"],
        summary: "The release makes parallel delegated work a first-class workflow.",
        whyItMatters: "It reduces the coordination burden for larger coding tasks.",
        caveats: ["The creator source is commentary."],
      },
    ],
    closing: "You're caught up.",
  };
}

test("schema validation accepts one assessment per exported candidate", () => {
  const output = validateNewsletterOutput(validOutput(), {
    editionDate: "2026-08-07",
    candidates,
  });
  assert.equal(output.assessments.length, 2);
  assert.equal(output.entries.length, 1);
});

test("validation rejects an invented item ID and an omitted candidate", () => {
  const output = validOutput();
  output.assessments[0].itemId = "invented";
  assert.throws(
    () => validateNewsletterOutput(output, { candidates, editionDate: "2026-08-07" }),
    (error: unknown) =>
      error instanceof NewsletterValidationError &&
      error.issues.some((issue) => issue.includes("was not exported")) &&
      error.issues.some((issue) => issue.includes("has no assessment")),
  );
});

test("validation rejects a newsletter entry backed only by archived items", () => {
  const output = validOutput();
  output.entries[0].sourceItemIds = ["item-2"];
  assert.throws(
    () => validateNewsletterOutput(output, { candidates, editionDate: "2026-08-07" }),
    /at least one source assessed as INCLUDE/,
  );
});

test("deterministic renderer escapes model markup, sanitizes HTML, and ends finitely", () => {
  const raw = validOutput();
  raw.entries[0].summary = "<script>alert(1)</script> **not trusted markup**";
  const output = validateNewsletterOutput(raw, { candidates, editionDate: "2026-08-07" });
  const rendered = renderNewsletter(output, candidates);
  assert.ok(rendered.markdown.endsWith("You're caught up."));
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.html, /rel="noopener noreferrer"/);
});

test("candidate export writes a manifest plus one item file per candidate", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ai-radar-analysis-"));
  try {
    const written = await writeCandidateBundle(
      {
        schemaVersion: 1,
        analysisRunId: "run-1",
        editionDate: "2026-08-07",
        windowStart: "2026-08-06T00:00:00Z",
        windowEnd: "2026-08-07T00:00:00Z",
        candidates: candidates.map((candidate, index) => ({
          ...candidate,
          provider: index ? "YOUTUBE" : "OPENAI",
          itemKind: index ? "VIDEO" : "ANNOUNCEMENT",
          author: null,
          publishedAt: "2026-08-06T00:00:00Z",
          description: null,
          contentQuality: "FULL_TEXT",
          previousAssessments: [],
          content: `Permanent content ${index + 1}`,
        })),
      },
      { baseDirectory: temporary },
    );
    const manifest = JSON.parse(await readFile(written.manifestPath, "utf8"));
    assert.equal(manifest.candidates.length, 2);
    assert.equal(manifest.candidates[0].contentFile, "items/item-1.md");
    assert.match(await readFile(path.join(written.directory, "items/item-1.md"), "utf8"), /untrusted source material/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("checked-in JSON Schema is strict at the root and nested records", async () => {
  const schema = JSON.parse(
    await readFile(path.resolve("schemas/daily-newsletter-output.schema.json"), "utf8"),
  );
  const generationSchema = JSON.parse(
    await readFile(
      path.resolve("schemas/daily-newsletter-codex-output.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.assessment.additionalProperties, false);
  assert.equal(schema.$defs.entry.additionalProperties, false);
  assert.equal(schema.properties.entries.maxItems, 8);
  assert.equal(schema.properties.closing.const, "You're caught up.");

  const unsupported = new Set([
    "allOf",
    "not",
    "dependentRequired",
    "dependentSchemas",
    "if",
    "then",
    "else",
    "contains",
    "minContains",
    "maxContains",
    "uniqueItems",
  ]);
  const found: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (unsupported.has(key)) found.push(key);
      visit(nested);
    }
  };
  visit(generationSchema);
  assert.deepEqual(found, []);
  assert.equal(generationSchema.additionalProperties, false);
  assert.equal(generationSchema.$defs.assessment.additionalProperties, false);
  assert.equal(generationSchema.$defs.entry.additionalProperties, false);
});

test(
  "daily runner requires explicit model provenance before contacting the server",
  { concurrency: false },
  async () => {
    const previousModel = process.env.AI_RADAR_MODEL;
    const previousEffort = process.env.AI_RADAR_REASONING_EFFORT;
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("Unexpected network request");
    }) as typeof fetch;

    try {
      delete process.env.AI_RADAR_MODEL;
      process.env.AI_RADAR_REASONING_EFFORT = "high";
      await assert.rejects(
        runDailyNewsletter({
          baseUrl: "https://radar.example",
          adminToken: "test-admin-token-long",
        }),
        /AI_RADAR_MODEL is required/,
      );

      process.env.AI_RADAR_MODEL = "explicit-model";
      delete process.env.AI_RADAR_REASONING_EFFORT;
      await assert.rejects(
        runDailyNewsletter({
          baseUrl: "https://radar.example",
          adminToken: "test-admin-token-long",
        }),
        /AI_RADAR_REASONING_EFFORT is required/,
      );
      assert.equal(fetchCalled, false);
    } finally {
      if (previousModel === undefined) delete process.env.AI_RADAR_MODEL;
      else process.env.AI_RADAR_MODEL = previousModel;
      if (previousEffort === undefined) delete process.env.AI_RADAR_REASONING_EFFORT;
      else process.env.AI_RADAR_REASONING_EFFORT = previousEffort;
      globalThis.fetch = originalFetch;
    }
  },
);
