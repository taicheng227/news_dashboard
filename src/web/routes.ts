import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { collectSources } from "../collection/collect.js";
import {
  type AnalysisImportRepository,
  type AtomicNewsletterImportInput,
  importNewsletterOutput,
} from "../analysis/import-newsletter.js";
import {
  CollectionAlreadyRunningError,
  RadarRepository,
  RepositoryInvariantError,
} from "../db/repositories.js";
import {
  ASSESSMENT_CATEGORIES,
  CONTENT_KINDS,
  CONFIDENCE_LEVELS,
  DISPOSITIONS,
  NEWSLETTER_SECTIONS,
  SOURCE_PROVIDERS,
  type Newsletter,
  type NewsletterEntryView,
  type NewsletterView,
  type PendingCandidate,
  type SourceItemFilters,
} from "../db/types.js";
import { NewsletterValidationError } from "../analysis/validate-output.js";
import { formatDate, formatDateTime, sectionTitle } from "./presenters.js";

const analysisRunBodySchema = z
  .object({
    modelName: z.string().min(1).max(200).nullable().optional(),
    reasoningEffort: z.string().min(1).max(100).nullable().optional(),
    promptVersion: z.string().min(1).max(100).default("v1"),
  })
  .strict();

const failAnalysisBodySchema = z.object({ error: z.string().min(1).max(2_000) }).strict();
const collectionBodySchema = z
  .object({ trigger: z.enum(["SCHEDULED", "MANUAL"]).optional() })
  .strict();

function dateInKualaLumpur(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: "Invalid request", issues });
}

function inputHash(candidates: readonly PendingCandidate[]): string {
  const stable = candidates
    .map((candidate) => ({
      itemId: candidate.itemId,
      snapshotId: candidate.snapshotId,
      contentHash: candidate.contentHash,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function candidateDto(runId: string, candidate: PendingCandidate) {
  return {
    itemId: candidate.itemId,
    snapshotId: candidate.snapshotId,
    provider: candidate.provider,
    itemKind: candidate.itemKind,
    title: candidate.title,
    author: candidate.author,
    publishedAt: candidate.publishedAt,
    canonicalUrl: candidate.canonicalUrl,
    description: candidate.description,
    contentQuality: candidate.contentQuality,
    previousAssessments: candidate.previousAssessments,
    contentUrl: `/internal/items/${encodeURIComponent(candidate.itemId)}/snapshots/${encodeURIComponent(candidate.snapshotId)}/content?analysisRunId=${encodeURIComponent(runId)}`,
  };
}

function entryTemplate(entry: NewsletterEntryView) {
  return {
    section: entry.section,
    rank: entry.rank,
    headline: entry.headline,
    summary: entry.summary,
    why_it_matters: entry.whyItMatters,
    caveats: entry.caveats,
    sources: entry.sources.map((source) => ({
      item_id: source.itemId,
      title: source.title,
      canonical_url: source.canonicalUrl,
      provider: source.provider,
    })),
  };
}

function newsletterTemplate(view: NewsletterView) {
  return {
    newsletter: {
      id: view.newsletter.id,
      newsletter_date: view.newsletter.newsletterDate,
      version: view.newsletter.version,
      title: view.newsletter.title,
      dek: view.newsletter.dek,
      html: view.newsletter.html,
      published_at: view.newsletter.publishedAt,
    },
    entries: view.entries.map(entryTemplate),
    stats: {
      assessed: view.assessmentCount,
      archived: view.archivedCount,
    },
  };
}

function archiveTemplate(newsletter: Newsletter, entryCount: number) {
  return {
    id: newsletter.id,
    newsletter_date: newsletter.newsletterDate,
    version: newsletter.version,
    title: newsletter.title,
    dek: newsletter.dek,
    published_at: newsletter.publishedAt,
    entry_count: entryCount,
  };
}

class RepositoryAnalysisAdapter implements AnalysisImportRepository {
  constructor(private readonly repository: RadarRepository) {}

  getCandidatesForAnalysisRun(analysisRunId: string) {
    const run = this.repository.getAnalysisRun(analysisRunId);
    if (!run) throw new RepositoryInvariantError(`Unknown analysis run ${analysisRunId}.`);
    const candidates = this.repository.listAnalysisRunCandidates(analysisRunId);
    return {
      editionDate: dateInKualaLumpur(run.windowEnd),
      candidates: candidates.map((candidate) => ({
        itemId: candidate.itemId,
        snapshotId: candidate.snapshotId,
        title: candidate.title,
        canonicalUrl: candidate.canonicalUrl,
      })),
    };
  }

  importNewsletterAtomically(input: AtomicNewsletterImportInput) {
    const view = this.repository.importNewsletter({
      analysisRunId: input.analysisRunId,
      expectedCandidates: input.expectedCandidates,
      editionDate: input.editionDate,
      title: input.title,
      dek: input.dek,
      markdown: input.markdown,
      html: input.html,
      status: "PUBLISHED",
      assessments: input.assessments,
      entries: input.entries,
    });
    return {
      id: view.newsletter.id,
      newsletterDate: view.newsletter.newsletterDate,
      version: view.newsletter.version,
      url: `/newsletters/${view.newsletter.newsletterDate}/versions/${view.newsletter.version}`,
    };
  }

  markAnalysisRunFailed(analysisRunId: string, errorMessage: string) {
    this.repository.markAnalysisRunFailed(analysisRunId, errorMessage);
  }
}

export function registerRoutes(app: FastifyInstance, repository: RadarRepository): void {
  const analysisAdapter = new RepositoryAnalysisAdapter(repository);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/", async (_request, reply) => {
    const latest = repository.getLatestPublishedNewsletter();
    const template = latest ? newsletterTemplate(latest) : null;
    const entries = template?.entries ?? [];
    return reply.view("home.eta", {
      pageTitle: "Latest",
      newsletter: template?.newsletter ?? null,
      stats: template?.stats ?? { assessed: 0, archived: 0 },
      sections: NEWSLETTER_SECTIONS.map((section) => ({
        section,
        title: sectionTitle(section),
        entries: entries.filter((entry) => entry.section === section),
      })),
      formatDate,
      formatDateTime,
    });
  });

  app.get("/archive", async (_request, reply) => {
    const newsletters = repository.listNewsletterArchive().map((newsletter) => {
      const entryCount = repository.getNewsletterById(newsletter.id)?.entries.length ?? 0;
      return archiveTemplate(newsletter, entryCount);
    });
    return reply.view("archive.eta", {
      pageTitle: "Archive",
      newsletters,
      formatDate,
    });
  });

  app.get<{ Params: { date: string } }>("/newsletters/:date", async (request, reply) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.params.date)) return reply.code(404).send("Not found");
    const view = repository.getNewsletterByDate(request.params.date);
    if (!view) return reply.code(404).send("Newsletter not found");
    const template = newsletterTemplate(view);
    return reply.view("newsletter.eta", {
      pageTitle: template.newsletter.title,
      newsletter: template.newsletter,
      versions: repository.listNewsletterVersions(request.params.date).map((version) => ({
        version: version.version,
      })),
      formatDateTime,
    });
  });

  app.get<{ Params: { date: string; version: string } }>(
    "/newsletters/:date/versions/:version",
    async (request, reply) => {
      const version = Number(request.params.version);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(request.params.date) || !Number.isInteger(version) || version < 1) {
        return reply.code(404).send("Not found");
      }
      const view = repository.getNewsletterByDate(request.params.date, version);
      if (!view) return reply.code(404).send("Newsletter version not found");
      const template = newsletterTemplate(view);
      return reply.view("newsletter.eta", {
        pageTitle: `${template.newsletter.title} · v${version}`,
        newsletter: template.newsletter,
        versions: repository.listNewsletterVersions(request.params.date).map((edition) => ({
          version: edition.version,
        })),
        formatDateTime,
      });
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>("/sources", async (request, reply) => {
    const provider = request.query.provider;
    const kind = request.query.kind;
    const disposition = request.query.disposition;
    const since = request.query.since ?? "";
    const pageText = request.query.page ?? "1";
    if (provider && !SOURCE_PROVIDERS.includes(provider as never)) return badRequest(reply, "Unknown provider");
    if (kind && !CONTENT_KINDS.includes(kind as never)) return badRequest(reply, "Unknown item type");
    if (disposition && !DISPOSITIONS.includes(disposition as never)) return badRequest(reply, "Unknown disposition");
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return badRequest(reply, "Invalid since date");
    if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(Number(pageText)) || Number(pageText) < 1) {
      return badRequest(reply, "Invalid page");
    }
    const page = Number(pageText);
    const pageSize = 100;
    const filters: SourceItemFilters = {
      provider: provider as SourceItemFilters["provider"],
      kind: kind as SourceItemFilters["kind"],
      disposition: disposition as SourceItemFilters["disposition"],
      publishedFrom: since ? `${since}T00:00:00.000Z` : undefined,
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    };
    const sourceItems = repository.listSourceItems(filters);
    const hasNext = sourceItems.length > pageSize;
    const items = sourceItems.slice(0, pageSize).map((item) => ({
      item_id: item.itemId,
      title: item.title,
      provider: item.provider,
      kind: item.itemKind,
      published_at: item.publishedAt,
      canonical_url: item.canonicalUrl,
      captured_at: item.capturedAt,
      disposition: item.disposition,
      assessment_summary: item.assessmentSummary,
      content_status: item.contentStatus,
    }));
    const pageUrl = (targetPage: number) => {
      const parameters = new URLSearchParams();
      if (provider) parameters.set("provider", provider);
      if (kind) parameters.set("kind", kind);
      if (disposition) parameters.set("disposition", disposition);
      if (since) parameters.set("since", since);
      if (targetPage > 1) parameters.set("page", String(targetPage));
      const query = parameters.toString();
      return query ? `/sources?${query}` : "/sources";
    };
    return reply.view("sources.eta", {
      pageTitle: "Sources",
      items,
      filters: {
        providers: SOURCE_PROVIDERS,
        kinds: CONTENT_KINDS,
        dispositions: DISPOSITIONS,
      },
      query: { provider: provider ?? "", kind: kind ?? "", disposition: disposition ?? "", since },
      pagination: {
        page,
        previousUrl: page > 1 ? pageUrl(page - 1) : null,
        nextUrl: hasNext ? pageUrl(page + 1) : null,
      },
      formatDate,
    });
  });

  app.get("/status", async (_request, reply) => {
    const status = repository.getStatusSummary();
    return reply.view("status.eta", {
      pageTitle: "Status",
      status: {
        latestSuccessfulCollection: status.latestSuccessfulCollectionRun
          ? { completed_at: status.latestSuccessfulCollectionRun.completedAt }
          : null,
        latestProblemCollection: status.latestProblemCollectionRun
          ? { completed_at: status.latestProblemCollectionRun.completedAt }
          : null,
        pendingCandidates: status.pendingCandidateCount,
        latestAnalysisRun: status.latestAnalysisRun
          ? {
              status: status.latestAnalysisRun.status,
              started_at: status.latestAnalysisRun.startedAt,
              completed_at: status.latestAnalysisRun.completedAt,
            }
          : null,
        latestNewsletter: status.latestNewsletter
          ? {
              newsletter_date: status.latestNewsletter.newsletterDate,
              version: status.latestNewsletter.version,
            }
          : null,
        sources: repository.listSources().map((source) => ({
          name: source.name,
          last_success_at: source.lastSuccessAt,
          last_checked_at: source.lastCheckedAt,
          last_error: source.lastError,
        })),
      },
      formatDateTime,
    });
  });

  app.post("/internal/collection/run", async (request, reply) => {
    const parsed = collectionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, parsed.error.flatten());
    try {
      const summary = await collectSources(repository, {
        trigger: parsed.data.trigger ?? "SCHEDULED",
      });
      return { id: summary.runId, ...summary };
    } catch (error) {
      if (error instanceof CollectionAlreadyRunningError) {
        return reply.code(409).send({
          error: "Collection already running",
          activeRunId: error.activeRunId,
          expiresAt: error.expiresAt,
        });
      }
      throw error;
    }
  });

  app.post("/internal/analysis-runs", async (request, reply) => {
    const parsed = analysisRunBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, parsed.error.flatten());
    const windowEnd = new Date().toISOString();
    const latestNewsletter = repository.getLatestPublishedNewsletter()?.newsletter;
    const run = repository.createAnalysisRun({
      windowStart: latestNewsletter?.publishedAt ?? "1970-01-01T00:00:00.000Z",
      windowEnd,
      modelName: parsed.data.modelName,
      reasoningEffort: parsed.data.reasoningEffort,
      promptVersion: parsed.data.promptVersion,
    });
    const candidates = repository.listAnalysisRunCandidates(run.id);
    repository.updateAnalysisRunInputHash(run.id, inputHash(candidates));
    app.log.info(
      { operation: "analysis.create", runId: run.id, candidateCount: candidates.length },
      "Analysis run created",
    );
    return reply.code(201).send({
      runId: run.id,
      candidateCount: candidates.length,
      candidatesUrl: `/internal/analysis-runs/${run.id}/candidates`,
    });
  });

  app.get<{ Params: { id: string } }>(
    "/internal/analysis-runs/:id/candidates",
    async (request, reply) => {
      const run = repository.getAnalysisRun(request.params.id);
      if (!run) return reply.code(404).send({ error: "Analysis run not found" });
      const candidates = repository.listAnalysisRunCandidates(run.id);
      app.log.info(
        { operation: "analysis.export", runId: run.id, candidateCount: candidates.length },
        "Analysis candidates exported",
      );
      return {
        schemaVersion: 1,
        analysisRunId: run.id,
        editionDate: dateInKualaLumpur(run.windowEnd),
        windowStart: run.windowStart,
        windowEnd: run.windowEnd,
        candidates: candidates.map((candidate) => candidateDto(run.id, candidate)),
      };
    },
  );

  app.get<{
    Params: { itemId: string; snapshotId: string };
    Querystring: { analysisRunId?: string };
  }>(
    "/internal/items/:itemId/snapshots/:snapshotId/content",
    async (request, reply) => {
      if (request.query.analysisRunId) {
        const allowed = repository
          .listAnalysisRunCandidates(request.query.analysisRunId)
          .some(
            (candidate) =>
              candidate.itemId === request.params.itemId &&
              candidate.snapshotId === request.params.snapshotId,
          );
        if (!allowed) return reply.code(404).send({ error: "Candidate snapshot not found" });
      }
      const content = repository.getContentSnapshotText(
        request.params.itemId,
        request.params.snapshotId,
      );
      if (content === null) return reply.code(404).send({ error: "Snapshot content not found" });
      return { content };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/internal/analysis-runs/:id/import",
    async (request, reply) => {
      try {
        const result = await importNewsletterOutput(
          analysisAdapter,
          request.params.id,
          request.body,
        );
        app.log.info(
          {
            operation: "newsletter.publish",
            runId: request.params.id,
            newsletterId: result.newsletter.id,
            newsletterDate: result.newsletter.newsletterDate,
            version: result.newsletter.version,
          },
          "Newsletter imported and published",
        );
        return reply.code(201).send({
          newsletter: result.newsletter,
          newsletterUrl: result.newsletter.url,
        });
      } catch (error) {
        if (error instanceof NewsletterValidationError || error instanceof RepositoryInvariantError) {
          return reply.code(400).send({
            error: error.message,
            issues: error instanceof NewsletterValidationError ? error.issues : undefined,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/internal/analysis-runs/:id/fail",
    async (request, reply) => {
      const parsed = failAnalysisBodySchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.flatten());
      try {
        const run = repository.markAnalysisRunFailed(request.params.id, parsed.data.error);
        app.log.warn(
          { operation: "analysis.fail", runId: run.id },
          "Analysis run marked failed",
        );
        return { runId: run.id, status: run.status };
      } catch (error) {
        if (error instanceof RepositoryInvariantError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get("/internal/status", async () => {
    const status = repository.getStatusSummary();
    return {
      latestCollectionRun: status.latestCollectionRun,
      latestNewsletter: status.latestNewsletter,
      pendingCandidates: status.pendingCandidateCount,
      sourceFailures: status.sourceFailures,
      latestAnalysisRun: status.latestAnalysisRun,
    };
  });

  // Keep these checked into the route module so API enum drift is caught at build time.
  void ASSESSMENT_CATEGORIES;
  void CONFIDENCE_LEVELS;
}
