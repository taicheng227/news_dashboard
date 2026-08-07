# AI Radar working agreement

AI Radar is a durable, single-user AI-news archive. Preserve the architecture in the permanent V1 plan:

- one Node.js 22 TypeScript/Fastify monolith;
- one SQLite database on a Railway volume, one web replica;
- fixed official sources plus only the Matt Wolfe and Theo YouTube channels;
- deterministic collection and import, with Codex limited to analysis/editorial output;
- permanent compressed source snapshots and versioned newsletters;
- server-rendered Eta views and a finite “You're caught up.” experience.

Do not add Reddit, arbitrary source discovery, browser automation, Whisper/audio downloads, Postgres, Prisma, Redis, queues, React, embeddings, full-text search, accounts, or AI-generated HTML.

Before handing off changes, run:

```text
npm run check
npm test
npm run build
```

Live source behavior belongs in the manual `npm run collect:smoke` command, never in the deterministic test suite.
