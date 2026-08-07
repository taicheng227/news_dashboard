import { z } from "zod";

export const DISPOSITIONS = ["INCLUDE", "WATCH", "ARCHIVE"] as const;
export const CATEGORIES = [
  "PRODUCT_RELEASE",
  "MODEL_RELEASE",
  "CODING_AGENT",
  "DEVELOPER_TOOL",
  "AI_APPLICATION",
  "RESEARCH",
  "COMMENTARY",
  "OTHER",
] as const;
export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export const NEWSLETTER_SECTIONS = [
  "IMPORTANT",
  "WORTH_KNOWING",
  "FROM_YOUTUBE",
  "WATCHLIST",
] as const;

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOSING = "You're caught up." as const;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function boundedText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Must contain non-whitespace text");
}

function uniqueTextArray(maxItems: number, maxLength: number) {
  return z
    .array(boundedText(maxLength))
    .max(maxItems)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Duplicate values are not allowed",
          });
        }
        seen.add(value);
      });
    });
}

export const NewsletterAssessmentSchema = z
  .object({
    itemId: boundedText(256),
    snapshotId: boundedText(256),
    disposition: z.enum(DISPOSITIONS),
    importance: z.number().int().min(1).max(5).nullable(),
    category: z.enum(CATEGORIES),
    confidence: z.enum(CONFIDENCE_LEVELS),
    summary: boundedText(1200),
    whyItMatters: boundedText(1200),
    keyPoints: uniqueTextArray(8, 500),
    caveats: uniqueTextArray(5, 500),
  })
  .strict();

export const NewsletterEntrySchema = z
  .object({
    section: z.enum(NEWSLETTER_SECTIONS),
    rank: z.number().int().min(1).max(8),
    headline: boundedText(200),
    sourceItemIds: z
      .array(boundedText(256))
      .min(1)
      .max(8)
      .superRefine((values, context) => {
        const seen = new Set<string>();
        values.forEach((value, index) => {
          if (seen.has(value)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "Source item IDs must be unique within an entry",
            });
          }
          seen.add(value);
        });
      }),
    summary: boundedText(1600),
    whyItMatters: boundedText(1200),
    caveats: uniqueTextArray(5, 500),
  })
  .strict();

const SECTION_LIMITS: Record<(typeof NEWSLETTER_SECTIONS)[number], number> = {
  IMPORTANT: 3,
  WORTH_KNOWING: 5,
  FROM_YOUTUBE: 2,
  WATCHLIST: 8,
};

export const DailyNewsletterOutputSchema = z
  .object({
    editionDate: z.string().refine(isCalendarDate, "Must be a real YYYY-MM-DD date"),
    title: boundedText(160),
    dek: boundedText(500),
    quietDay: z.boolean(),
    assessments: z.array(NewsletterAssessmentSchema),
    entries: z.array(NewsletterEntrySchema).max(8),
    closing: z.literal(CLOSING),
  })
  .strict()
  .superRefine((output, context) => {
    if (output.quietDay !== (output.entries.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["quietDay"],
        message: "quietDay must be true exactly when entries is empty",
      });
    }

    for (const section of NEWSLETTER_SECTIONS) {
      const indexes = output.entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.section === section);
      if (indexes.length > SECTION_LIMITS[section]) {
        context.addIssue({
          code: "custom",
          path: ["entries"],
          message: `${section} may contain at most ${SECTION_LIMITS[section]} entries`,
        });
      }

      const ranks = indexes.map(({ entry }) => entry.rank).sort((a, b) => a - b);
      const expectedRanks = ranks.map((_, index) => index + 1);
      if (ranks.some((rank, index) => rank !== expectedRanks[index])) {
        context.addIssue({
          code: "custom",
          path: ["entries"],
          message: `${section} ranks must be unique and contiguous starting at 1`,
        });
      }
    }
  });

export type NewsletterAssessment = z.infer<typeof NewsletterAssessmentSchema>;
export type NewsletterEntry = z.infer<typeof NewsletterEntrySchema>;
export type DailyNewsletterOutput = z.infer<typeof DailyNewsletterOutputSchema>;
export type NewsletterSection = (typeof NEWSLETTER_SECTIONS)[number];

export interface CandidateValidationReference {
  itemId: string;
  snapshotId: string;
}

export interface NewsletterValidationContext {
  candidates: readonly CandidateValidationReference[];
  editionDate?: string;
}

export class NewsletterValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Newsletter output validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "NewsletterValidationError";
    this.issues = issues;
  }
}

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? "output" : path.map(String).join(".");
}

/**
 * Validate both the static output shape and relationships that JSON Schema
 * cannot express against an authoritative exported candidate set.
 */
export function validateNewsletterOutput(
  input: unknown,
  validationContext: NewsletterValidationContext,
): DailyNewsletterOutput {
  const parsed = DailyNewsletterOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new NewsletterValidationError(
      parsed.error.issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`),
    );
  }

  const output = parsed.data;
  const issues: string[] = [];
  const candidateByItemId = new Map<string, CandidateValidationReference>();

  for (const candidate of validationContext.candidates) {
    const existing = candidateByItemId.get(candidate.itemId);
    if (existing) {
      issues.push(`Candidate bundle contains item ${candidate.itemId} more than once`);
      continue;
    }
    candidateByItemId.set(candidate.itemId, candidate);
  }

  if (validationContext.editionDate && output.editionDate !== validationContext.editionDate) {
    issues.push(
      `editionDate ${output.editionDate} does not match run date ${validationContext.editionDate}`,
    );
  }

  const assessmentByItemId = new Map<string, NewsletterAssessment>();
  output.assessments.forEach((assessment, index) => {
    if (assessmentByItemId.has(assessment.itemId)) {
      issues.push(`assessments.${index}: item ${assessment.itemId} was assessed more than once`);
      return;
    }
    assessmentByItemId.set(assessment.itemId, assessment);

    const candidate = candidateByItemId.get(assessment.itemId);
    if (!candidate) {
      issues.push(`assessments.${index}: item ${assessment.itemId} was not exported for this run`);
    } else if (candidate.snapshotId !== assessment.snapshotId) {
      issues.push(
        `assessments.${index}: snapshot ${assessment.snapshotId} does not belong to exported item ${assessment.itemId}`,
      );
    }
  });

  for (const candidate of validationContext.candidates) {
    if (!assessmentByItemId.has(candidate.itemId)) {
      issues.push(`Exported item ${candidate.itemId} has no assessment`);
    }
  }

  if (output.assessments.length !== validationContext.candidates.length) {
    issues.push(
      `Expected exactly ${validationContext.candidates.length} assessments, received ${output.assessments.length}`,
    );
  }

  output.entries.forEach((entry, entryIndex) => {
    let hasIncludedSource = false;
    for (const itemId of entry.sourceItemIds) {
      if (!candidateByItemId.has(itemId)) {
        issues.push(`entries.${entryIndex}: source item ${itemId} was not exported for this run`);
        continue;
      }
      const assessment = assessmentByItemId.get(itemId);
      if (!assessment) {
        issues.push(`entries.${entryIndex}: source item ${itemId} has no assessment`);
      } else if (assessment.disposition === "INCLUDE") {
        hasIncludedSource = true;
      }
    }

    if (!hasIncludedSource) {
      issues.push(
        `entries.${entryIndex}: an entry must have at least one source assessed as INCLUDE; archived-only and watch-only references are not allowed`,
      );
    }
  });

  if (issues.length > 0) throw new NewsletterValidationError(issues);
  return output;
}

export const NEWSLETTER_CLOSING = CLOSING;
