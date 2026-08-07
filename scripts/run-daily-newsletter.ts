import { spawn } from "node:child_process";
import { access, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type RemoteCandidate,
  writeCandidateBundle,
} from "../src/analysis/export-candidates.js";
import { validateNewsletterOutput } from "../src/analysis/validate-output.js";

interface AnalysisRunCreated {
  runId: string;
}

interface DailyRunnerOptions {
  baseUrl?: string;
  adminToken?: string;
  codexBinary?: string;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 2_000);
}

class RadarApiClient {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly adminToken: string,
  ) {
    this.baseUrl = new URL(baseUrl);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:") {
      throw new Error("AI_RADAR_BASE_URL must use HTTP or HTTPS");
    }
  }

  private resolve(endpoint: string): URL {
    const url = new URL(endpoint, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new Error(`Refusing to send AI Radar credentials to another origin: ${url.origin}`);
    }
    return url;
  }

  async request(endpoint: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.adminToken}`);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(this.resolve(endpoint), { ...init, headers });
    if (!response.ok) {
      const details = (await response.text()).replace(/\s+/g, " ").slice(0, 600);
      throw new Error(
        `AI Radar request ${init.method ?? "GET"} ${new URL(endpoint, this.baseUrl).pathname} failed (${response.status})${details ? `: ${details}` : ""}`,
      );
    }
    return response;
  }

  async json(endpoint: string, init: RequestInit = {}): Promise<unknown> {
    return (await this.request(endpoint, init)).json();
  }

  async candidateContent(candidate: RemoteCandidate): Promise<string> {
    if (candidate.content !== undefined) return candidate.content;
    if (!candidate.contentUrl) throw new Error(`Candidate ${candidate.itemId} has no content URL`);
    const response = await this.request(candidate.contentUrl);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return response.text();

    const payload = (await response.json()) as Record<string, unknown>;
    for (const key of ["content", "text", "extractedText"]) {
      if (typeof payload[key] === "string") return payload[key] as string;
    }
    throw new Error(`Content response for candidate ${candidate.itemId} did not contain text`);
  }

  async markFailed(runId: string, error: unknown): Promise<void> {
    try {
      await this.request(`/internal/analysis-runs/${encodeURIComponent(runId)}/fail`, {
        method: "POST",
        body: JSON.stringify({ error: sanitizeError(error) }),
      });
    } catch (markError) {
      console.error(`Could not mark analysis run ${runId} failed: ${sanitizeError(markError)}`);
    }
  }
}

function parseCreatedRun(input: unknown): AnalysisRunCreated {
  if (!input || typeof input !== "object") throw new Error("Analysis-run response was not an object");
  const record = input as Record<string, unknown>;
  const runId = typeof record.runId === "string" ? record.runId : record.id;
  if (typeof runId !== "string" || !runId) {
    throw new Error("Analysis-run response did not include runId");
  }
  return { runId };
}

async function preservePreviousOutput(outputPath: string): Promise<void> {
  try {
    await access(outputPath);
  } catch {
    return;
  }
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(outputPath, path.join(path.dirname(outputPath), `output.previous-${suffix}.json`));
}

async function runCodex(binary: string, args: string[]): Promise<void> {
  const childEnvironment = { ...process.env };
  for (const key of Object.keys(childEnvironment)) {
    if (
      /^(AI_RADAR_|DASHBOARD_|RAILWAY_)/i.test(key) ||
      key.toUpperCase() === "DATABASE_PATH"
    ) {
      delete childEnvironment[key];
    }
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: repositoryRoot,
      // The outer runner owns API credentials. Never pass importer or database
      // credentials into the Codex child process.
      env: childEnvironment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`codex exec failed (${signal ? `signal ${signal}` : `exit ${code}`})`));
    });
  });
}

function findPublishedUrl(payload: unknown, api: RadarApiClient): string {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = record.newsletter && typeof record.newsletter === "object"
    ? (record.newsletter as Record<string, unknown>)
    : {};
  const value = [record.newsletterUrl, record.url, nested.url, record.path, nested.path].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );
  if (!value) throw new Error("Newsletter import succeeded but returned no published URL");
  return new URL(value, api.baseUrl).toString();
}

export async function runDailyNewsletter(options: DailyRunnerOptions = {}): Promise<string> {
  const baseUrl = options.baseUrl ?? required(process.env.AI_RADAR_BASE_URL, "AI_RADAR_BASE_URL");
  const adminToken = options.adminToken ?? required(process.env.AI_RADAR_ADMIN_TOKEN, "AI_RADAR_ADMIN_TOKEN");
  const api = new RadarApiClient(baseUrl, adminToken);

  const promptVersion = process.env.AI_RADAR_PROMPT_VERSION || "v1";
  // Make the effective Codex configuration explicit so analysis_run records
  // the model and effort that were actually sent, rather than an unknowable
  // user-config default.
  const modelName = required(process.env.AI_RADAR_MODEL, "AI_RADAR_MODEL");
  const reasoningEffort = required(
    process.env.AI_RADAR_REASONING_EFFORT,
    "AI_RADAR_REASONING_EFFORT",
  );
  const createPayload: Record<string, string> = {
    promptVersion,
    modelName,
    reasoningEffort,
  };

  const created = parseCreatedRun(
    await api.json("/internal/analysis-runs", {
      method: "POST",
      body: JSON.stringify(createPayload),
    }),
  );

  try {
    const remoteManifest = await api.json(
      `/internal/analysis-runs/${encodeURIComponent(created.runId)}/candidates`,
    );
    const bundle = await writeCandidateBundle(remoteManifest, {
      baseDirectory: path.join(repositoryRoot, "tmp", "brief-run"),
      loadContent: (candidate) => api.candidateContent(candidate),
    });
    if (bundle.manifest.analysisRunId !== created.runId) {
      throw new Error("Candidate manifest analysisRunId did not match the created run");
    }

    const outputPath = path.join(bundle.directory, "output.json");
    await preservePreviousOutput(outputPath);
    // Codex structured outputs support a strict JSON Schema subset. The
    // generation schema mirrors the canonical contract without unsupported
    // cross-item and conditional keywords; validateNewsletterOutput enforces
    // those complete relational constraints before any import is attempted.
    const schemaPath = path.join(
      repositoryRoot,
      "schemas",
      "daily-newsletter-codex-output.schema.json",
    );
    const dailyPrompt = await readFile(
      path.join(repositoryRoot, "prompts", "daily-newsletter.md"),
      "utf8",
    );
    const relativeManifestPath = path.relative(repositoryRoot, bundle.manifestPath).split(path.sep).join("/");
    const prompt = [
      "$ai-radar-newsletter",
      "",
      dailyPrompt.trim(),
      "",
      `Generate the daily AI Radar newsletter from \`${relativeManifestPath}\`.`,
    ].join("\n");

    // `--search` is a top-level Codex flag in current CLI releases, so it must
    // precede the `exec` subcommand.
    const codexArgs = ["--search"];
    codexArgs.push("--model", modelName);
    codexArgs.push(
      "--config",
      `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    );
    codexArgs.push(
      "exec",
      "--sandbox",
      "workspace-write",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    );
    codexArgs.push(prompt);
    await runCodex(options.codexBinary ?? process.env.CODEX_BINARY ?? "codex", codexArgs);

    let rawOutput: unknown;
    try {
      rawOutput = JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      throw new Error(`Codex output was not valid JSON; retained at ${outputPath}: ${sanitizeError(error)}`);
    }

    const output = validateNewsletterOutput(rawOutput, {
      editionDate: bundle.manifest.editionDate,
      candidates: bundle.manifest.candidates,
    });
    const imported = await api.json(
      `/internal/analysis-runs/${encodeURIComponent(created.runId)}/import`,
      {
        method: "POST",
        body: JSON.stringify(output),
      },
    );
    const publishedUrl = findPublishedUrl(imported, api);
    console.log(publishedUrl);
    return publishedUrl;
  } catch (error) {
    await api.markFailed(created.runId, error);
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runDailyNewsletter().catch((error) => {
    console.error(sanitizeError(error));
    process.exitCode = 1;
  });
}
