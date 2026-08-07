# AI Radar

AI Radar is a durable personal AI-news archive and finite daily newsletter. A single TypeScript/Fastify service collects a fixed set of official AI sources and two YouTube channels into SQLite. A separate trusted Codex runner assesses only new or materially changed content and imports a structured, permanent newsletter.

The application intentionally has no Reddit ingestion, arbitrary news aggregation, accounts, infinite feed, browser automation, audio transcription, generalized crawler framework, or model-generated HTML.

## Architecture

- **Railway web service:** owns the only SQLite database, deterministic collection/import endpoints, server-rendered dashboard, source history, and newsletter archive.
- **Railway persistent volume:** mounted at `/data`; production uses `/data/ai-radar.sqlite`.
- **Railway cron trigger:** calls the authenticated collection endpoint once per day and exits. It never mounts the database.
- **Trusted Codex runner:** receives only `AI_RADAR_BASE_URL` and `AI_RADAR_ADMIN_TOKEN`, exports candidates, runs `codex exec` with the checked-in output schema, validates locally, and submits one atomic import.

If collection or Codex fails, pending candidates remain pending and the most recent published newsletter stays online.

## Requirements

- Node.js 22+
- `yt-dlp` on the web-service host for YouTube metadata and English subtitles
- an authenticated `codex` CLI only on the trusted machine that runs the newsletter

## Local setup

Copy `.env.example` to `.env` and replace every placeholder secret. The dashboard password and internal admin token must be different.

```powershell
npm install
npm run db:migrate
npm run check
npm test
npm run dev
```

Open `http://127.0.0.1:3000/health` without authentication. All dashboard pages use HTTP Basic authentication. Every `/internal/*` endpoint instead requires `Authorization: Bearer $AI_RADAR_ADMIN_TOKEN`.

Useful commands:

```powershell
npm run collect:local       # collect directly into the local database
npm run collect             # call the protected collection endpoint
npm run collect:smoke       # manual real-source adapter smoke test
npm run youtube:resolve     # resolve configured handles to stable channel IDs
npm run newsletter:daily    # trusted export → Codex → validate → import flow
npm run db:backup           # consistent SQLite online backup
npm run build
npm start
```

The deterministic test suite uses static fixtures and does not call live websites.

## Collection behavior

The fixed registry is in `config/sources.ts` and covers OpenAI, Anthropic, Kimi, Qwen, Z.ai, Matt Wolfe, and Theo. First collection is limited to 30 days and 50 official items per source, plus the latest 10 videos per channel. Later runs use a 48-hour overlap.

Registry URLs remain the canonical source identities even where the live site is client-rendered or has moved. The adapters use narrow first-party representations where available: OpenAI RSS, Anthropic Markdown, Qwen's official retrieval API, Z.ai's sitemap and release-note Markdown, and the two YouTube channel feeds. An empty valid surface (currently possible for the Z.ai blog sitemap) is a successful check. If an official endpoint rejects ordinary server-side access—for example, an HTTP 403 from the Product Release Notes RSS—the source is reported as failed and the overall collection becomes `PARTIAL`; the collector does not add browser or anti-bot workarounds.

Article indexes retain changed listing snapshots and permanent compressed article HTML plus extracted text. Rolling changelogs are split into stable dated/versioned items; an edited entry creates a new snapshot and becomes a fresh candidate. YouTube discovery uses channel RSS, while `yt-dlp` retrieves metadata and English human-provided captions before falling back to English automatic captions. No video or audio is downloaded.

One failing source produces a `PARTIAL` run while the remaining sources continue. A database-backed expiring lock prevents overlapping collection runs.

## Daily newsletter

Run collection first, then on the trusted Codex machine:

```powershell
$env:AI_RADAR_BASE_URL = 'https://your-web-service.example'
$env:AI_RADAR_ADMIN_TOKEN = 'your-separate-admin-token'
$env:AI_RADAR_MODEL = 'your-chosen-codex-model'
$env:AI_RADAR_REASONING_EFFORT = 'your-chosen-effort'
npm run newsletter:daily
```

The runner requires an explicit model and reasoning effort so the analysis record matches the configuration actually sent to Codex. It writes each bundle beneath `tmp/brief-run/<analysis-run-id>/`, invokes the `ai-radar-newsletter` skill with `--search` and the Codex-compatible `schemas/daily-newsletter-codex-output.schema.json`, preserves invalid output for diagnosis, then enforces the stricter `schemas/daily-newsletter-output.schema.json` contract locally before the server imports the edition transactionally. The spawned Codex process receives no AI Radar, dashboard, Railway, or database secrets.

Regenerating an edition date creates a higher version and marks the former edition `SUPERSEDED`; it never overwrites history. Quiet days still publish an edition. Every edition ends with “You're caught up.”

## Railway deployment

Create one project with:

1. A web service using `railway.json` and one volume mounted at `/data`.
2. A second service from the same repository with its Railway **Config File Path** set to `/railway.cron.json`; it needs only `AI_RADAR_BASE_URL` and `AI_RADAR_ADMIN_TOKEN` and must not have a volume.
3. Exactly one web-service replica. A SQLite volume must never be shared by concurrent writers.

Set on the web service:

```text
DATABASE_PATH=/data/ai-radar.sqlite
PORT=3000
HOST=0.0.0.0
AI_RADAR_ADMIN_TOKEN=...
```

The browser-facing dashboard is public when `DASHBOARD_USERNAME` and
`DASHBOARD_PASSWORD` are omitted. Set both variables to enable HTTP Basic
authentication. Internal routes always require `AI_RADAR_ADMIN_TOKEN`.

The Docker image contains Node.js 22 and `yt-dlp`. Startup runs numbered migrations before Fastify listens, `/health` is the Railway health check, and SIGTERM closes SQLite cleanly.

The cron configuration defaults to `0 9 * * *` (09:00 UTC / 17:00 Asia/Kuala_Lumpur). Railway cron schedules are UTC. Schedule the trusted Codex runner separately around `0 10 * * *` (10:00 UTC / 18:00 Asia/Kuala_Lumpur).

## Backups and restoration

Enable automated daily volume backups in Railway’s volume **Backups** settings. They are the primary recovery mechanism.

For a consistent manual backup, set `AI_RADAR_BACKUP_DIR` (production defaults to `/data/manual-backups`) and run:

```powershell
npm run db:backup
```

The command uses SQLite’s online backup API and retains `AI_RADAR_BACKUP_RETENTION` files (default seven); it never copies a live WAL database byte-for-byte.

To restore manually:

1. Stop the web service so no process has the database open.
2. Preserve the current `/data/ai-radar.sqlite`, `-wal`, and `-shm` files under a dated recovery directory.
3. Put the selected backup at `/data/ai-radar.sqlite`; do not restore stale `-wal` or `-shm` companions.
4. Start one web replica. Startup applies any missing numbered migrations.
5. Check `/health`, then sign in to `/status`.
6. Compare `SELECT count(*) FROM newsletter;` and `SELECT count(*) FROM content_item;` with the pre-restore counts or the status page.

Railway volume restores are staged as a replacement volume; review the staged change before deploying it.

## Operational safeguards

- Do not expose raw HTML or full transcripts through public pages.
- Do not log secrets, raw pages, or full transcripts.
- Do not give the Codex runner Railway credentials or database access.
- Do not configure more than one web replica.
- Do not reset or rebuild the database during image builds or deployments.
