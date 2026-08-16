# DeepSeek Harness UX

**[中文说明（推荐）](README.zh.md)** | English

**A calmer Web experience for long-running work in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

DeepSeek Harness UX is an unofficial community source edition based on DeepSeek Harness. It keeps the upstream plugin architecture, Agent loop, model providers, tools, permissions, sandbox, and main-model request semantics, while concentrating its deliberate changes in the Web surfaces people watch and operate during long tasks.

> This is not a DeepSeek distribution and does not receive upstream support. DeepSeek Harness and related names belong to their respective owners.

## Why this edition exists

Long-running Agent work produces valuable evidence, but presenting every event at equal visual weight makes three basic questions difficult to answer: Is it still working? What is it doing now? Is it finished?

This edition turns that event stream into a stable process surface, keeps technical evidence available on demand, returns reading focus to the answer after completion, and makes recent sessions and produced files easier to reach.

## Complete functional differences from official DeepSeek Harness

The comparison below covers every intentionally maintained, user-visible difference in this fork. It does not count generated files, tests, package metadata, repository-only tooling, or mechanical source-tree drift as product features.

Comparison snapshots:

- **DeepSeek Harness UX:** functional source at [`35c6172`](https://github.com/ayuanwong/deepseek-harness-ux/commit/35c61722573f1357f0b5b7e2f687094fb6f7b097), based on the 2026-08-12 upstream source snapshot.
- **Official DeepSeek Harness:** [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a), the `master` head used for this review on 2026-08-17.

| Area | Official DeepSeek Harness at the comparison snapshot | DeepSeek Harness UX | Nature of the difference |
|---|---|---|---|
| Agent execution | Official Agent loop, model routes, tools, permission policy, sandbox, and session log | The same execution model is retained; Web presentation does not redefine Agent strategy | Intentionally unchanged |
| Running-turn presentation | Reasoning, context, Tool rows, and intermediate narration are presented as ordinary conversation events | One stable process panel groups the Turn, keeps the current stage visible, and exposes step count and elapsed time | UX addition |
| Stage labels | Uses the authored event presentation | A bounded, optional presentation-only model call may refine Todo, reasoning, and Tool evidence into a forward-only stage trail | UX addition; extra bounded model usage |
| Technical evidence | Event and Tool rows remain directly in the conversation flow | Raw reasoning, context, commands, and Tool rows remain inspectable under **Run details** | UX restructuring, no evidence deletion |
| Live-detail scrolling | Native nested scrolling can hand wheel movement back to the transcript | The bounded live detail log owns its scroll gesture; the transcript disables competing native anchoring so the sticky composer does not jump into blank space | UX bug fix |
| Turn completion and failure | Conversation history remains in its ordinary event layout | A successful process folds when work becomes idle; terminal or unrecovered failure stays expanded, while recovered intermediate errors stay in details | UX addition |
| Answer headings | Shows the model-authored Markdown headings | A second bounded presentation-only call may refine headings for the finalized closing answer; the authored Markdown remains the copy, history, and model source | UX addition; extra bounded model usage |
| Conversation reading | Standard Markdown spacing and message controls | Tighter mixed-format answer rhythm, clearer Turn separation, and Copy, feedback, and Branch actions shown on hover or keyboard focus | Visual and interaction change |
| Idle-edge history repair | Follows the ordinary history and live-event lanes | When a resident Session changes from running to idle, the browser refreshes only the overlapping history tail in the background, repairing a delayed `turn/end` without flashing the loader or dropping older pages | Recovery improvement |
| Session ordering | Manual ordering is the persisted default; Last updated is optional | **Last updated** becomes the one-time migrated default, while Manual remains available | Default change |
| Ungrouped Session creation | New Session inherits or targets a Workspace path | The Ungrouped group has its own create action that explicitly creates or reuses a blank Session without inheriting a Workspace | UX addition |
| Sidebar content search | Full-text Session search ships opt-in and is disabled in the default bundle; title and Workspace matching remain available | The base bundle opens an in-memory SQLite index on first search, so conversation-content results are available by default for the current process | Capability/default difference |
| Cold Session rows | Small cold artifacts receive bounded blankness and last-human-prompt verification, avoiding stale empty rows and pickup-time recency | This snapshot predates that upstream verification and retains the earlier cold-list behavior | Upstream fix not included |
| Produced files | The finished-turn row is driven by successful mutation-tool locations | It also recognizes exact, intentionally declared common artifact paths in the closing answer, including documents, datasets, images, media, archives, databases, and 3D/CAD files; arbitrary prose, URLs, commands, and fenced examples remain excluded | UX addition |
| First-run model setup | The reviewed upstream snapshot has a versioned internal-testing notice followed by an inline conditional DeepSeek credential dialog | This snapshot omits the internal-testing notice and routes the conditional DeepSeek step to the full **Settings → Models** setup card, avoiding a second secret editor | Deliberate simplification |
| OAuth-only catalog providers | Providers that this build cannot authenticate, such as the installed `openai-codex` OAuth-only route, are withheld from the add-provider picker | This snapshot can still offer that route even though it has no built-in OAuth login or durable refresh flow; a manually supplied token is required | Known snapshot limitation |
| Codex and Claude Code subagent providers | Excluded from the default production bundle and installed only by Profiles that explicitly opt in | Both dormant providers are dependencies of the base bundle; loading them starts no product process, but the packages are installed | Composition/default difference |
| Frame-wide extension surfaces | Provides `shell.overlay` and `sidebar.footer.action`; the official Cordis UI uses them for global controls | This snapshot predates those seats and the global Cordis UI | Upstream capability not included |
| Distribution | Official public npm packages; the Web UI can start with `npx @deepseek-ai/dsh web` | Source checkout only; this repository publishes nothing under the `@deepseek-ai` scope | Distribution difference |
| License of the compared trees | Current upstream tree uses MIT | This fork retains the BSD 3-Clause license of its source snapshot and preserves upstream notices | Snapshot/legal difference |

## Current upstream capabilities not included here

Because this repository is a source snapshot rather than a continuously rebased patch, it does not automatically include later upstream work. The known user-facing deltas found in the reviewed trees are called out in the table, including onboarding, search defaults, cold Session handling, provider availability, extension seats, distribution, and licensing. Later upstream maintenance, compatibility, packaging, and security fixes are not automatically merged. Choose upstream when staying current with official releases matters more than the UX changes listed here.

## Display assistance does not change the answer

The optional presentation service reads a bounded slice of already-recorded process evidence and returns display metadata only. It does **not** modify the main model's System Prompt, user message, tools, reasoning, authored answer, or conversation history.

Presentation calls may add a small amount of token use and latency. Failure, timeout, an unavailable route, or invalid output never blocks the Agent; the browser keeps the authored heading or a safe local stage label. See [Web presentation](packages/web/web-presentation/README.md) and its [design record](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.md).

## Which version should I choose?

Choose the [official DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) when you want the newest supported source, npm distribution, current official extension surfaces, or primarily use headless and CLI workflows.

Choose DeepSeek Harness UX when the Web UI is your main workspace and you value a compact live-process surface, stable long-log scrolling, recent-session defaults, and broader produced-file discovery enough to accept a snapshot-based community edition.

<a id="run"></a><a id="run-from-source"></a>

## Run from source

Requirements:

- Node.js `^22.19` or `>=24`
- pnpm 11
- A DeepSeek-compatible API key

```sh
git clone https://github.com/ayuanwong/deepseek-harness-ux.git
cd deepseek-harness-ux
pnpm install
pnpm run build
pnpm run dsh -- web --port 3081
```

Open `http://127.0.0.1:3081`, add a model provider under **Settings → Models**, then create a Session. Replace `3081` if the port is already in use.

This repository is a complete source edition. It is not a drop-in Fabric patch or a separately published npm plugin for a clean upstream checkout.

## Privacy

Session logs stay local by default. Do not commit `.env`, `.npmrc`, API keys, local Sessions, build output, or profile data. Review upstream telemetry settings before enabling a non-default telemetry mode. Presentation requests use the Session's configured provider and model, so their bounded evidence projection is sent to that provider when the optional refinement runs.

## Development

Read [AGENTS.md](AGENTS.md), the [development guide](docs/development.md), and [architecture](docs/architecture.md) before changing packages.

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## Community links

| Project | Description |
|---|---|
| [![dshfind](https://dshfind.com/api/badge/huiliyi37/dsh-tianshu-tui?lang=zh)](https://dshfind.com/zh/plugins/huiliyi37/dsh-tianshu-tui?ref=badge) | Interactive terminal UI plugin with TDD, evidence gates, vision, and code-intelligence workflows. |
| [![dshfind](https://dshfind.com/api/badge/ccch1mneyyy/dsh-TUI?lang=zh)](https://dshfind.com/zh/plugins/ccch1mneyyy/dsh-TUI?ref=badge) | Claude Code-style full-screen terminal UI with live task status, streamed reasoning, rollback, and context/TPS metrics. |
| [![dshfind](https://dshfind.com/api/badge/0xsline/awesome-deepseek-harness?lang=zh)](https://dshfind.com/zh/plugins/0xsline/awesome-deepseek-harness?ref=badge) | Curated DeepSeek Harness resources and ecosystem projects on DSH Find. |

## License and attribution

This repository is derived from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and preserves the notices of its source snapshot. This tree uses the [BSD 3-Clause license](LICENSE); third-party dependencies and license terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
