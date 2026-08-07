# AI Radar sources

The collector reads this table. Keep each value on one line. `page` sources are saved only when their normalized content changes; `rss` sources save individual recent items.

| enabled | name | provider | type | url | keywords |
| --- | --- | --- | --- | --- | --- |
| yes | OpenAI news | openai | rss | https://openai.com/news/rss.xml | codex, chatgpt, model, agent, gpt |
| yes | ChatGPT and Codex changelog | openai | page | https://developers.openai.com/codex/changelog | codex, chatgpt |
| no | ChatGPT Help Center release notes (often blocks automation) | openai | page | https://help.openai.com/en/articles/6825453-chatgpt-release-notes | chatgpt, codex, model |
| yes | Anthropic newsroom | anthropic | page | https://www.anthropic.com/news | claude, code, model, agent |
| yes | Claude platform release notes | anthropic | page | https://platform.claude.com/docs/en/release-notes/overview | claude, code, model, agent |
| yes | Claude Code changelog | anthropic | page | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | claude code |

## Reddit

- r/codex
- r/ClaudeCode
- Inspect the previous 48 hours.
- Keep posts at score 50 or higher.
- Within kept posts, keep comments at score 20 or higher.

## YouTube

YouTube is opt-in. Save a video with `npm run youtube -- <url>` or clip a transcript manually into `sources/youtube/`.
