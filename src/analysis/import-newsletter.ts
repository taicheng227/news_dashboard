import { renderNewsletter, type NewsletterSource } from "./render-newsletter.js";
import {
  validateNewsletterOutput,
  type DailyNewsletterOutput,
  type NewsletterAssessment,
  type NewsletterEntry,
} from "./validate-output.js";

type Awaitable<T> = T | Promise<T>;

export interface AnalysisRunCandidate extends NewsletterSource {
  snapshotId: string;
}

export interface AnalysisRunCandidateSet {
  editionDate: string;
  candidates: readonly AnalysisRunCandidate[];
}

export interface AtomicNewsletterImportInput {
  analysisRunId: string;
  expectedCandidates: Array<{ itemId: string; snapshotId: string }>;
  editionDate: string;
  title: string;
  dek: string;
  markdown: string;
  html: string;
  assessments: NewsletterAssessment[];
  entries: NewsletterEntry[];
}

export interface ImportedNewsletter {
  id: string;
  newsletterDate: string;
  version: number;
  url?: string;
  [key: string]: unknown;
}

/**
 * Adapter boundary for the database repository. Candidate reads must be
 * authoritative for the named analysis run. The import implementation must
 * verify IDs and snapshot ownership again and commit assessments, newsletter,
 * entries, source relationships, supersession, and run success in one
 * transaction.
 */
export interface AnalysisImportRepository {
  getCandidatesForAnalysisRun(analysisRunId: string): Awaitable<AnalysisRunCandidateSet>;
  importNewsletterAtomically(input: AtomicNewsletterImportInput): Awaitable<ImportedNewsletter>;
  markAnalysisRunFailed(analysisRunId: string, errorMessage: string): Awaitable<void>;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 2_000);
}

async function bestEffortMarkFailed(
  repository: AnalysisImportRepository,
  analysisRunId: string,
  error: unknown,
): Promise<void> {
  try {
    await repository.markAnalysisRunFailed(analysisRunId, errorMessage(error));
  } catch {
    // Preserve the validation/import error. Failure marking is deliberately
    // best-effort and must never mask the original cause.
  }
}

export interface NewsletterImportResult {
  output: DailyNewsletterOutput;
  markdown: string;
  html: string;
  newsletter: ImportedNewsletter;
}

/** Validate, render, and hand one complete payload to the atomic repository write. */
export async function importNewsletterOutput(
  repository: AnalysisImportRepository,
  analysisRunId: string,
  rawOutput: unknown,
): Promise<NewsletterImportResult> {
  try {
    const authoritative = await repository.getCandidatesForAnalysisRun(analysisRunId);
    const output = validateNewsletterOutput(rawOutput, {
      editionDate: authoritative.editionDate,
      candidates: authoritative.candidates,
    });
    const rendered = renderNewsletter(output, authoritative.candidates);

    const newsletter = await repository.importNewsletterAtomically({
      analysisRunId,
      expectedCandidates: authoritative.candidates.map(({ itemId, snapshotId }) => ({
        itemId,
        snapshotId,
      })),
      editionDate: output.editionDate,
      title: output.title,
      dek: output.dek,
      markdown: rendered.markdown,
      html: rendered.html,
      assessments: output.assessments,
      entries: output.entries,
    });

    return {
      output,
      markdown: rendered.markdown,
      html: rendered.html,
      newsletter,
    };
  } catch (error) {
    await bestEffortMarkFailed(repository, analysisRunId, error);
    throw error;
  }
}
