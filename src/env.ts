import path from "node:path";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_PATH: z.string().min(1).default("./data/ai-radar.sqlite"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DASHBOARD_USERNAME: z.string().min(1).optional(),
    DASHBOARD_PASSWORD: z.string().min(12).optional(),
    AI_RADAR_ADMIN_TOKEN: z.string().min(16),
    AI_RADAR_BASE_URL: z.string().url().optional(),
    AI_RADAR_BACKUP_DIR: z.string().min(1).optional(),
    AI_RADAR_BACKUP_RETENTION: z.coerce.number().int().min(1).max(100).default(7),
  })
  .superRefine((values, context) => {
    if (Boolean(values.DASHBOARD_USERNAME) === Boolean(values.DASHBOARD_PASSWORD)) return;
    context.addIssue({
      code: "custom",
      path: ["DASHBOARD_USERNAME"],
      message: "DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set together",
    });
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const values = { ...input };
  if (values.NODE_ENV === "test") {
    values.DASHBOARD_USERNAME ||= "test-user";
    values.DASHBOARD_PASSWORD ||= "test-password-long";
    values.AI_RADAR_ADMIN_TOKEN ||= "test-admin-token-long";
  }
  const parsed = envSchema.safeParse(values);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid AI Radar environment: ${summary}`);
  }
  return {
    ...parsed.data,
    DATABASE_PATH: path.resolve(parsed.data.DATABASE_PATH),
    AI_RADAR_BACKUP_DIR: path.resolve(
      parsed.data.AI_RADAR_BACKUP_DIR ??
        path.join(path.dirname(parsed.data.DATABASE_PATH), "manual-backups"),
    ),
  };
}
