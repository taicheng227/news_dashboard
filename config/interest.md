# AI Radar — Interests

This file defines what AI Radar should consider interesting and important.

It is an editorial preference file, not an exhaustive taxonomy.

The ingest workflow should use these priorities as guidance rather than treating them as rigid mathematical rules.

---

# Primary objective

I want AI Radar to help me understand:

1. meaningful new capabilities in AI products;
2. important new model releases;
3. how real users experience those products;
4. important limitations such as rate limits;
5. genuinely useful new AI tools;
6. genuinely novel applications of AI.

I want enough information to remain well informed without needing to browse Reddit or continuously follow AI news myself.

Prioritize signal over volume.

---

# 1. OpenAI — VERY HIGH PRIORITY

I want to deeply understand meaningful developments from OpenAI.

Particularly important:

* Codex
* ChatGPT
* new OpenAI models
* coding models
* reasoning models
* agent functionality
* subagents
* Codex CLI
* Codex app
* tool use
* web/research capabilities
* context management
* compaction
* memory
* model routing
* reasoning behaviour
* integrations
* developer workflows
* pricing
* credits
* rate limits
* usage limits
* important bugs
* important regressions

For meaningful product releases, do not merely tell me that something launched.

I want to understand:

* what changed;
* what was possible before;
* what is possible now;
* important limitations;
* why the change might matter in practice.

Minor cosmetic UI changes are low priority unless they materially change a workflow.

---

# 2. Anthropic — VERY HIGH PRIORITY

I want similar coverage for:

* Claude
* Claude Code
* new Anthropic models
* coding capabilities
* reasoning capabilities
* agent functionality
* subagents
* tool use
* context management
* memory
* developer workflows
* pricing
* rate limits
* usage limits
* important bugs
* important regressions

I am particularly interested in meaningful comparisons between Claude Code and Codex where a new feature materially changes how either product can be used.

Avoid turning every development into a forced OpenAI-versus-Anthropic comparison.

Compare them when the comparison is actually informative.

---

# 3. Open and open-weight models — HIGH PRIORITY

Actively follow significant developments from:

## DeepSeek

## Kimi / Moonshot AI

## GLM / Z.ai

## Qwen / Alibaba

I particularly care about:

* major new model generations;
* coding models;
* reasoning models;
* agentic capabilities;
* tool use;
* multimodal models;
* context-window improvements;
* major inference-efficiency improvements;
* meaningful price changes;
* local/self-hosted usability;
* licensing and availability;
* strong benchmarks with credible methodology.

I do NOT need to know about:

* routine commits;
* every fine-tune;
* every small model variant;
* insignificant benchmark movement;
* minor repository maintenance.

The important question is:

**Does this release materially change what these models can do or how useful they are?**

---

# 4. Codex rate limits — VERY HIGH PRIORITY

I care substantially about Codex usage limits.

Track:

* limit increases;
* limit reductions;
* weekly limits;
* rolling limits;
* unexpected usage depletion;
* changes to usage accounting;
* temporary usage promotions;
* credits;
* pricing;
* rate-limit resets;
* bugs affecting limits;
* community complaints about limits;
* official responses to those complaints.

I specifically want to know how actual users feel about the limits.

Use high-value Reddit discussion as a community benchmark.

Useful conclusions include:

* users broadly appear comfortable with the current limits;
* heavy users are increasingly frustrated;
* multiple users report unexpectedly rapid depletion;
* experiences appear highly workload-dependent;
* complaints increased after a particular change.

Avoid fake-precision sentiment percentages.

---

# 5. Tibo / rate-limit reset watch — VERY HIGH PRIORITY

Watch for relevant public statements from:

* Tibo / Thibault Sottiaux
* other identifiable OpenAI staff discussing Codex limits

I particularly care about indications that:

* usage accounting is broken;
* OpenAI is investigating unexpected depletion;
* limits will be temporarily increased;
* limits may be reset;
* limits have been reset.

Always distinguish:

## CONFIRMED

There is a direct official/staff statement supporting the claim.

## STRONG SIGNAL

There is direct evidence of a relevant problem or investigation, but the expected consequence has not been announced.

## COMMUNITY ISSUE

Multiple credible users independently report the same problem.

## SPECULATION

Users predict what OpenAI or Tibo might do without supporting confirmation.

Do not present speculation about a future reset as an announced reset.

---

# 6. Reddit community intelligence — HIGH PRIORITY

The primary communities I want monitored are:

* r/codex
* r/ClaudeCode

Reddit is valuable because it shows:

* real-world user experience;
* community discoveries;
* emerging bugs;
* workarounds;
* limitations;
* unusual behaviour;
* reactions to pricing and limits;
* workflows that are not yet well documented.

I do NOT want AI Radar to reproduce Reddit as a feed.

Use the configured popularity thresholds to aggressively reduce volume.

For significant posts, focus on what the high-value comments collectively tell us.

I care about:

* independent confirmations;
* disagreement;
* caveats;
* reproducibility;
* workarounds;
* community frustration;
* community enthusiasm;
* emerging consensus.

Popularity is a community signal, not proof of technical correctness.

---

# 7. Novel AI tools — HIGH PRIORITY

I want to discover genuinely useful new AI tools and projects.

Especially interesting:

* coding-agent tools;
* agent orchestration tools;
* MCP tools;
* developer tools;
* knowledge-management tools;
* research tools;
* AI search/retrieval tools;
* useful open-source applications;
* tools that expose new ways of interacting with models.

A tool is interesting when it enables a workflow that was previously difficult, cumbersome, or unavailable.

Graphify is an example of the *kind* of tool I want the radar to be capable of discovering: a tool whose usefulness comes from enabling a distinctive workflow.

Do not interpret this as "only find tools similar to Graphify."

I want genuinely novel useful tools broadly.

Low-value examples include:

* another generic chatbot wrapper;
* simple prompt libraries;
* AI directories;
* affiliate products;
* products differentiated mainly by marketing.

---

# 8. Novel applications of AI — HIGH PRIORITY

I care about novel applications even when no new model or tool has been released.

Look for people discovering interesting ways to use existing AI systems.

Examples of areas of interest:

* second-brain systems;
* personal knowledge management;
* research workflows;
* AI-assisted learning;
* autonomous or semi-autonomous agents;
* coding workflows;
* multi-agent workflows;
* unusual uses of subagents;
* long-running agent systems;
* AI-assisted information filtering;
* human/AI collaboration;
* personal automation;
* creative uses of existing model capabilities.

Karpathy demonstrating an interesting second-brain workflow is an example of the *kind* of development worth surfacing.

The important characteristic is:

**someone has demonstrated a genuinely interesting application or workflow that I may not have thought of myself.**

A novel application can be highly important even if it uses an existing model.

---

# 9. Agentic coding — VERY HIGH PRIORITY

I am particularly interested in developments affecting agentic software development.

Prioritize:

* new coding-agent capabilities;
* subagent orchestration;
* multi-agent systems;
* agent delegation;
* context management for coding agents;
* long-running coding tasks;
* parallel agents;
* agent review workflows;
* planning and execution improvements;
* new techniques for maintaining context across large projects;
* useful comparisons between coding agents;
* practical reports of what works and fails.

This category is more important than generic AI coding-assistant news.

---

# 10. Models generally — MEDIUM TO HIGH PRIORITY

Surface significant releases from other model providers when they materially affect the frontier or introduce something genuinely interesting.

Examples might include:

* a major new frontier model;
* a model with unusually strong coding capability;
* an important new reasoning technique;
* a dramatic efficiency improvement;
* a novel agentic capability.

Do not turn AI Radar into a comprehensive model-release database.

If a release does not meaningfully change the landscape, it can be ignored.

---

# 11. Research — MEDIUM PRIORITY

Surface research when it has plausible practical significance for:

* agents;
* reasoning;
* coding;
* context;
* memory;
* inference;
* knowledge systems;
* AI-assisted work.

I am less interested in tracking every new AI paper.

Prefer research that:

* changes how systems can be built;
* explains an important model behaviour;
* demonstrates a substantial new capability;
* has clear practical implications.

---

# 12. YouTube / long-form content — CURATED

Do not automatically ingest every upload from AI-related channels.

YouTube is a curated source.

Videos should normally enter AI Radar because:

* I manually clipped them;
* I explicitly supplied the URL;
* or the ingest workflow found an unusually high-value primary demonstration and has a strong reason to retain it.

For captured videos, prioritize:

* technical explanation;
* product demonstration;
* substantive interviews;
* novel workflows;
* research explanation;
* firsthand builder experience.

Deprioritize:

* generic AI news recaps;
* clickbait;
* reaction videos without substantive information;
* repetitive speculation.

---

# 13. Lower-priority material

Usually deprioritize:

* generic AI business news;
* funding rounds without technical significance;
* routine partnerships;
* enterprise adoption announcements;
* minor UI changes;
* generic productivity advice;
* generic prompting advice;
* image-generation trends unless technically significant;
* company drama unrelated to products or models.

These can become important if they have a clear practical consequence for something in the high-priority categories.

---

# 14. Ignore

Normally ignore:

* memes;
* ragebait;
* engagement farming;
* generic "AGI tomorrow" speculation;
* generic "AI is dead" speculation;
* SEO listicles;
* affiliate content;
* repetitive beginner questions;
* unsupported benchmark screenshots;
* duplicated reporting of an already captured event;
* trivial chatbot wrappers;
* vague product announcements without a concrete working capability.

---

# 15. What makes something worth interrupting me for?

The strongest AI Radar items usually answer "yes" to one or more of these:

### Capability

Can an AI system now do something materially useful that it could not do before?

### Workflow

Has someone discovered a substantially better way of using existing AI?

### Model

Has a model release materially changed capability, cost, speed, openness, or accessibility?

### Product

Has Codex, ChatGPT, Claude, or Claude Code materially changed?

### Community reality

Are real users discovering behaviour, limitations, bugs, or workflows that official documentation does not yet explain well?

### Cost or limits

Has pricing, credit usage, or rate limiting materially changed?

### Novelty

Is this something I am unlikely to discover simply by checking the normal announcement pages?

### Personal usefulness

Could this plausibly change how I use AI, code, learn, research, or manage knowledge?

If none apply, the item probably does not need to enter AI Radar.

---

# 16. Editorial philosophy

AI Radar should make me feel comfortable closing the dashboard.

It should not make me feel that there is always another item to inspect.

Prefer:

**5 meaningful developments**

over:

**50 technically relevant links**

The objective is not maximum coverage.

The objective is:

**Stay highly informed while consuming dramatically less information.**
