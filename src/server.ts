import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import { Eta } from "eta";
import Fastify, { type FastifyInstance } from "fastify";

import { SOURCES } from "../config/sources.js";
import { closeDatabase, openDatabase, type SqliteDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { RadarRepository } from "./db/repositories.js";
import type { JsonObject, SeedSourceInput } from "./db/types.js";
import { loadEnv, type AppEnv } from "./env.js";
import { createAccessGuard } from "./web/auth.js";
import { registerRoutes } from "./web/routes.js";

export interface BuildAppOptions {
  env?: AppEnv;
  database?: SqliteDatabase;
  logger?: boolean;
}

function configuredSources(): SeedSourceInput[] {
  return SOURCES.map((source) => ({
    slug: source.slug,
    name: source.name,
    provider: source.provider,
    kind: source.kind,
    canonicalUrl: source.url,
    enabled: source.enabled,
    config: ("channelId" in source && source.channelId
      ? { channelId: source.channelId }
      : {}) as JsonObject,
  }));
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const ownsDatabase = !options.database;
  const database = options.database ?? openDatabase(env.DATABASE_PATH);
  migrateDatabase(database, path.resolve("migrations"));
  const repository = new RadarRepository(database);
  repository.seedSources(configuredSources());

  const app = Fastify({ logger: options.logger ?? true });
  app.addHook(
    "preHandler",
    createAccessGuard({
      dashboardUsername: env.DASHBOARD_USERNAME,
      dashboardPassword: env.DASHBOARD_PASSWORD,
      adminToken: env.AI_RADAR_ADMIN_TOKEN,
    }),
  );

  await app.register(fastifyStatic, {
    root: path.resolve("public"),
    prefix: "/assets/",
    decorateReply: false,
  });
  await app.register(fastifyView, {
    engine: { eta: new Eta() },
    root: path.resolve("src/web/views"),
    layout: "layout.eta",
    production: env.NODE_ENV === "production",
  });

  registerRoutes(app, repository);
  app.addHook("onClose", async () => {
    if (ownsDatabase) closeDatabase(database);
  });
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = await buildApp({ env });
  const shutdown = async (signal: string) => {
    app.log.info({ operation: "shutdown", signal }, "Closing AI Radar");
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ host: env.HOST, port: env.PORT });
  return app;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
