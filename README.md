# AI Radar

AI Radar is a small, filesystem-first news workflow for official OpenAI and Anthropic updates, high-signal Reddit discussions, and explicitly selected YouTube transcripts. It produces one short daily brief and a finite static dashboard—no database, feed, account system, or background service.

## What stays private

`AI_Radar/` is the dedicated Obsidian vault and is ignored by Git. Only `website/` is rendered for publication. Set `AI_RADAR_VAULT` if you want the vault outside this repository:

```powershell
$env:AI_RADAR_VAULT = 'D:\Notes\AI_Radar'
```

## First run

Requirements: Node.js 22+, an authenticated `codex` CLI, and optionally `yt-dlp` for YouTube captions.

Copy `.env.example` to `.env` and fill only the values you use. Every local command loads this file automatically; it is ignored by Git.

```powershell
npm run setup
npm test
npm run daily
```

The daily command collects sources, asks the local Codex CLI for a concise brief, renders `website/index.html`, and updates `AI_Radar/system/state.json`. A failure from one external source is reported while the remaining sources continue.

Useful commands:

```powershell
npm run collect
npm run youtube -- "https://www.youtube.com/watch?v=..."
npm run synthesize -- --dry-run
npm run render
npm run start
```

Edit `AI_Radar/config/interests.md` to change ranking preferences and `AI_Radar/config/sources.md` to enable or disable sources. On its first run, page-based changelogs are captured as a current snapshot; later runs only save them when their normalized content changes. Feed items default to a seven-day first-run lookback.

Reddit commonly rejects anonymous JSON requests. For reliable read-only collection, create a personal Reddit `script` application and set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` in your scheduled task environment. If they are absent, AI Radar tries Reddit's public endpoint and reports a non-blocking warning when Reddit refuses it.

## Publishing through GitHub and Railway

For the strongest privacy boundary, clone a separate empty GitHub repository and point `AI_RADAR_PUBLISH_DIR` at it. The publisher copies an explicit allowlist: the generated `website/`, the static server, and Railway's two configuration files. It never copies the vault or source collector.

Initialize the public folder as a Git repository, add its GitHub remote, set the environment variable, and run:

```powershell
npm run publish
```

If `AI_RADAR_PUBLISH_DIR` is not set, the current repository is used. The publish command stages only the public site plus the minimal files Railway needs. It refuses to continue if anything under `AI_Radar/` is tracked or staged. Connect the public GitHub repository to Railway; `railway.json` serves only the generated `website/` directory.

To publish at the end of the daily run after the manual flow is proven:

```powershell
npm run daily -- --publish
```

## Scheduling

After one successful manual run, install the included 7:00 PM Windows scheduled task:

```powershell
npm run schedule:install -- -Publish
```

Omit `-Publish` while testing, or choose a different 24-hour time with `npm run schedule:install -- -Time 08:30 -Publish`. The machine must be awake, online, and signed in to Codex. If publishing fails, the previous Railway deployment remains online and `lastSuccessfulRun` is not advanced, so the next run can try again.

## Privacy check

Before every commit, `npm run publish` checks that no vault path is tracked. Avoid changing `.gitignore` to include the vault. The renderer reads individual Markdown files and writes only `website/index.html`; it never copies a source directory.
