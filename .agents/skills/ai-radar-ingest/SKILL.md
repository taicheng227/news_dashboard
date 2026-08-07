---
name: ai-radar-ingest
description: Discover, evaluate, and ingest high-value AI product releases, model releases, community developments, novel AI tools, and novel AI applications into the AI Radar vault. Use for scheduled AI Radar collection and whenever asked to update, refresh, or ingest AI news and developments.
---

# AI Radar Ingest

## Purpose

Maintain a small, high-signal source archive for the AI Radar.

The goal is NOT to comprehensively archive AI news.

The goal is to find developments that are likely to matter to the user, preserve the useful source material, and discard noise so the user does not need to browse Reddit, announcement feeds, or general AI news manually.

This is a personal information-filtering system, not a general-purpose web crawler.

## Core principle

Optimize for:

**high information value / low information volume**

It is better to miss a minor story than to fill the vault with low-value material.

Do not save something merely because it mentions AI.

Do not create notes for routine, repetitive, speculative, or trivial developments.

---

# 1. Read the interest profile first

Before searching, read:

`config/interests.md`

Treat that file as the authority on:

* companies and projects to watch;
* products and models of interest;
* topics of interest;
* people or signals to monitor;
* relative priorities;
* material to ignore.

Do not hardcode changing user interests into this skill when they belong in `interests.md`.

The skill defines **how to research and ingest**.

`interests.md` defines **what the user cares about**.

---

# 2. Research must be current

This workflow is specifically for current AI developments.

Use live/current web research rather than relying on model memory for:

* releases;
* feature availability;
* product behaviour;
* pricing;
* rate limits;
* model availability;
* changelogs;
* recent Reddit discussion;
* recent tools and projects.

Pay attention to both:

1. when a page was published; and
2. when the underlying event actually happened.

Prefer the newest primary information when sources conflict.

---

# 3. Run four discovery passes

Perform four conceptually separate passes.

Do not turn these into four elaborate software pipelines. They are simply research passes within one ingest workflow.

## Pass A — OpenAI and Anthropic products

Check for meaningful new developments relating to:

### OpenAI

Prioritize:

* Codex
* ChatGPT
* OpenAI model releases
* agent functionality
* Codex CLI
* Codex app
* subagents
* tool use
* context management
* memory
* reasoning behaviour
* model availability
* pricing
* credits
* rate limits
* usage limits
* important bugs or regressions

Prefer official OpenAI sources.

### Anthropic

Prioritize:

* Claude
* Claude Code
* Anthropic model releases
* agents
* subagents
* tool use
* context management
* memory
* reasoning behaviour
* model availability
* pricing
* rate limits
* usage limits
* important bugs or regressions

Prefer official Anthropic sources.

### Capture rule

A release is worth capturing when it materially changes:

* what the product can do;
* how a user interacts with it;
* which model is available;
* how much it costs;
* how much it can be used;
* how agents behave;
* an important workflow;
* a material limitation or regression.

Do not save every minor documentation or cosmetic change.

---

# 4. Pass B — Open and open-weight model radar

Actively check for significant developments involving the model families listed as high priority in `config/interests.md`.

The initial watchlist includes:

* DeepSeek
* Kimi / Moonshot AI
* GLM / Z.ai
* Qwen / Alibaba

Prioritize:

* major new model releases;
* coding models;
* reasoning models;
* agentic models;
* tool-use capabilities;
* important multimodal capabilities;
* meaningful context-window changes;
* major inference improvements;
* significant price/access changes;
* licensing changes;
* strong benchmark results with credible methodology.

Prefer, where available:

1. the project's official announcement;
2. official documentation;
3. official GitHub repository;
4. official model card or repository;
5. primary technical report.

News coverage may be used to discover a development, but try to resolve the story to its primary source before ingesting it.

Do not create five source notes because five news sites covered the same model release.

Capture the underlying event.

---

# 5. Pass C — Reddit community benchmark

Monitor only:

* r/codex
* r/ClaudeCode

Reddit has two purposes in AI Radar:

1. discovering important community findings;
2. measuring community experience and reaction.

It is NOT authoritative product documentation.

## Post threshold

Only persist a Reddit post if:

`score >= 50`

The collector/research process may inspect posts below this threshold to determine whether they qualify.

Do not permanently store them.

## Comment threshold

For a qualifying post, preserve only comments where:

`score >= 20`

Do not archive the entire comment tree.

## Recency

Inspect approximately the previous 48 hours on each daily run.

This allows a post that was initially below the threshold to qualify on the following day.

Do not build complicated lifecycle tracking unless the simple 48-hour lookback proves inadequate.

## Capture scores as snapshots

Record:

* `score_at_capture`
* `captured`

Do not assume the score is permanent.

The score represents community endorsement at the time AI Radar captured the discussion.

## Community interpretation

For worthwhile discussions, look for:

* community consensus;
* independent confirmations;
* contradictory experiences;
* reported failures;
* bugs;
* workarounds;
* limitations;
* unusual rate-limit behaviour;
* strong complaints;
* important caveats;
* unresolved questions.

Do NOT reduce community discussion to fake-precision sentiment such as:

`73% positive`

Prefer useful qualitative conclusions.

Example:

* Several highly rated users independently confirm the behaviour.
* Experiences are mixed and appear environment-dependent.
* The community broadly dislikes the new limit.
* A workaround appears to work for multiple users.
* The original claim is popular but several high-rated comments dispute it.

---

# 6. Special watch — Codex rate limits

Treat Codex usage limits as a first-class monitoring topic.

Look for:

* unusual rate-limit depletion;
* changes in weekly or rolling limits;
* temporary usage increases;
* credits or pricing changes;
* complaints that usage is draining faster than expected;
* reset behaviour;
* usage-accounting bugs;
* official acknowledgement of limit problems;
* official or staff announcements of resets.

Also watch for relevant direct public statements from:

* Tibo / Thibault Sottiaux;
* other identifiable OpenAI staff speaking directly about Codex usage limits.

Use this evidence ladder:

### CONFIRMED

Direct statement from OpenAI or an identifiable OpenAI representative.

### STRONG SIGNAL

OpenAI acknowledges or investigates an issue, but the predicted consequence has not yet been announced.

### COMMUNITY ISSUE

Multiple credible/high-signal users independently describe the same behaviour.

### SPECULATION

Users predict something such as another rate-limit reset without supporting confirmation.

Never turn:

"Tibo might reset limits"

into:

"Tibo will reset limits."

Preserve uncertainty.

---

# 7. Pass D — novel tools and novel applications

This pass exists to find things the user did not already know to search for.

Search broadly for genuinely interesting new:

* AI developer tools;
* coding-agent tools;
* agent orchestration tools;
* MCP tools;
* research tools;
* knowledge-management tools;
* open-source AI applications;
* personal AI workflows;
* AI-assisted learning workflows;
* second-brain systems;
* human/AI collaboration patterns;
* unusual applications of existing models.

The user cares about both:

### New tools

A new product or open-source project enables something useful.

### New applications

Someone discovers or demonstrates an interesting way of using existing AI systems, even if no new model has been released.

Examples of the *kind* of novelty worth detecting include:

* a Graphify-like tool that creates a useful new developer workflow;
* a Karpathy-like demonstration of an unusual second-brain or knowledge workflow;
* a new practical way of coordinating coding agents;
* a clever research or learning system built from existing models.

These examples describe the desired level of novelty. Do not search only for those names.

## Discovery quality filter

Capture a discovery when at least one of these is true:

1. It enables a genuinely new or substantially better workflow.
2. There is a concrete working product, repository, demo, or implementation.
3. A credible practitioner demonstrates a novel use.
4. There is strong independent community interest.
5. It is unusually relevant to `config/interests.md`.

Do not ingest:

* ordinary chatbot wrappers;
* generic AI directories;
* SEO listicles;
* affiliate "best AI tools" pages;
* trivial prompt collections;
* products whose only novelty is marketing language.

Whenever possible, resolve discoveries to:

* the project's own website;
* its GitHub repository;
* the creator's original post;
* the original demonstration.

---

# 8. Evidence hierarchy

When evaluating factual claims, generally prefer:

1. Official announcement or documentation
2. Direct statement from the responsible company/person
3. Primary repository, model card, paper, or technical artifact
4. Multiple credible firsthand community reports
5. High-quality secondary reporting
6. General community speculation

Popularity does not override authoritative evidence.

A highly upvoted Reddit post can show that a claim or problem matters to users.

It does not automatically prove the claim is technically correct.

---

# 9. Decide whether to ingest

Before creating a note, ask:

1. Is this materially new?
2. Is it relevant to `config/interests.md`?
3. Does it teach the user something useful?
4. Is there a reasonably trustworthy source?
5. Is it already represented in the vault?

If the answers do not justify a permanent source note, skip it.

There is no requirement to create a minimum number of notes per run.

A successful daily ingest may legitimately create zero notes.

---

# 10. Deduplication

Keep deduplication simple.

Before creating a source note, search the relevant source directory for:

* canonical URL;
* Reddit ID;
* YouTube video ID;
* obvious existing coverage of the same release/event.

If the same source is already captured, normally skip it.

If an existing event has materially new information, either:

* update the existing note if appropriate; or
* create a clearly related follow-up note.

Do not build a generalized deduplication engine.

---

# 11. Storage locations

Store captured material under the following folders.

## OpenAI

`sources/official/openai/`

## Anthropic

`sources/official/anthropic/`

## Open models

`sources/models/deepseek/`

`sources/models/kimi/`

`sources/models/glm/`

`sources/models/qwen/`

If another model family is later added to `interests.md`, create a simple matching folder only when needed.

## Reddit

`sources/reddit/codex/`

`sources/reddit/claudecode/`

## Novel discoveries

Tools:

`sources/discovery/tools/`

Applications/workflows:

`sources/discovery/applications/`

## YouTube

`sources/youtube/`

---

# 12. Source-note format

Use plain Markdown with lightweight YAML frontmatter.

Do not invent a large schema.

For ordinary source notes, use approximately:

```yaml
---
type: ai-source
source_type: official
provider: openai
url: https://...
published: YYYY-MM-DD
captured: YYYY-MM-DDTHH:MM:SS+08:00
topics:
  - codex
  - agents
---
```

Then:

```markdown
# Source title

## What the source says

Preserve the useful source material or concise faithful extraction needed to understand the development.

## Source

Canonical source URL.
```

Do not save navigation menus, cookie text, unrelated page furniture, or large amounts of irrelevant page content.

---

# 13. Reddit note format

Store one qualifying Reddit post and its qualifying comments together.

Example:

```yaml
---
type: ai-source
source_type: reddit
subreddit: codex
reddit_id: abc123
url: https://reddit.com/...
published: YYYY-MM-DD
captured: YYYY-MM-DDTHH:MM:SS+08:00
score_at_capture: 184
post_threshold: 50
comment_threshold: 20
topics:
  - codex
  - rate-limits
---
```

Then:

```markdown
# Post title

## Post

Relevant post content.

## Community benchmark

### +96

Qualifying comment.

### +54

Qualifying comment.

### +27

Qualifying comment.

## Capture notes

Any short factual note needed to understand the capture.
```

Do not create separate files for individual comments.

---

# 14. Do not synthesize the newsletter here

This is the **ingest skill**.

Its job is:

`internet → high-value source archive`

Do not turn every captured source into a polished newsletter article during ingest.

Preserve sufficient evidence for the later briefing/synthesis workflow.

A separate briefing skill should handle:

`source archive → explanation → prioritization → daily brief`

This separation keeps the archive useful and prevents premature summarization.

---

# 15. End-of-run report

At the end of each ingest run, report concisely:

* number of new source notes created;
* which major categories produced new material;
* number of qualifying Reddit posts captured;
* important collection failures, if any;
* whether any particularly high-priority item was found.

Also record enough state for the next scheduled run if the project uses `system/state.json`.

Do not produce a lengthy report if nothing happened.

Example:

`Ingest complete: 4 new sources — 1 OpenAI release, 1 Qwen release, and 2 qualifying r/codex discussions. No Anthropic changes. No collection failures.`

---

# 16. Failure behaviour

Keep failures simple.

If one source cannot be accessed:

* record the failure;
* continue researching the remaining sources where practical.

Do not build complicated retry infrastructure.

Do not invent missing data.

Do not silently convert failed research into "no news."

Distinguish:

`checked, nothing meaningful found`

from:

`could not reliably check source`

---

# 17. Simplicity requirement

DO NOT OVERENGINEER THIS WORKFLOW.

This is a personal information-filtering system.

Do not introduce:

* databases;
* Prisma;
* queues;
* workers;
* elaborate source contracts;
* generalized crawler frameworks;
* embeddings;
* vector databases;
* complicated scoring algorithms;
* dozens of source adapters;
* exhaustive test suites;
* elaborate retry systems;
* hypothetical edge-case machinery.

Use straightforward web research, filesystem operations, Markdown, and small helper scripts only where they remove genuine repetitive work.

Solve observed problems, not imagined future ones.
