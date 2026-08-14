# DeepSeek Harness UX

English | [中文](README.zh.md)

**A calmer Web experience for long-running work in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

DeepSeek Harness is already an extensible coding-agent harness. This community edition concentrates on the part people watch and operate while the agent is working: session recovery, progress, multi-turn reading, actions, files, and workspace navigation.

It is not a different agent. It preserves the upstream plugin architecture, agent loop, tools, permissions, sandboxing, and main-model input. The changes are intentionally concentrated in the Web presentation layer.

> This is an unofficial, community-maintained project and not a DeepSeek distribution. DeepSeek Harness and related names belong to their respective owners.

## Why use it?

Long agent tasks produce a lot of useful evidence, but presenting every event at equal visual weight makes it hard to answer three basic questions: Is it still working? What is it doing now? Is it finished?

DeepSeek Harness UX turns that event stream into one stable process surface:

- While a task runs, the current stage and a short trail of completed stages remain visible instead of becoming a wall of logs.
- Technical reasoning, tool calls, questions, and approvals remain available under **Run details**; they are not deleted or disguised as the final answer.
- When the task finishes, the process folds automatically and the result becomes the reading focus.
- Copy, feedback, and Branch actions stay available without permanently occupying every message row.
- Historical sessions, workspaces, and produced files receive explicit loading, recovery, sorting, and opening behavior.

The result is still DeepSeek Harness, but it is easier to trust during a long run and easier to read after the run ends.

## Difference from upstream DeepSeek Harness

| Area | Upstream DeepSeek Harness | DeepSeek Harness UX |
|---|---|---|
| Primary goal | General-purpose agent harness, plugins, tools, runtime, and official Web UI | A community Web UX edition built on the same harness |
| Agent execution | Upstream agent loop, model provider, tools, permissions, and sandbox | Kept aligned with upstream; UX work does not redefine the agent strategy |
| Running-task view | General event and tool presentation | One semantic process surface with visible current progress and expandable technical details |
| Completed work | Conversation and event history remain available | Process history folds automatically so the final result leads |
| Long logs | Browser-native nested scrolling and transcript flow | Bounded details own their scrolling; the composer remains anchored without blank-page jumps |
| Conversation reading | Standard message controls and Markdown rhythm | Hover-only actions, clearer turn separation, tighter long-form typography, and safer answer headings |
| Sessions and workspaces | Upstream session and workspace capabilities | Recovery and retry states, activity indicators, newest-first presentation, and calmer workspace density |
| Deliverables | Upstream produced-file pipeline | Clearer deliverable discovery and opening for common formats, including PDF and Web files |
| Distribution | Official packages and upstream source | Independent source edition; no package is published from this repository under the `@deepseek-ai` scope |

This comparison describes the source baseline used by this repository. Upstream continues to evolve, so some improvements may eventually overlap.

## Display assistance does not change the answer

Some stage labels and answer headings are refined by bounded, auxiliary model calls in the Web presentation service. The service reads a limited slice of already-recorded process evidence and returns presentation metadata only.

These calls do **not** modify the main model's system prompt, user message, tools, reasoning, authored answer, or conversation history. They can add a small amount of presentation-only token use and latency. If the auxiliary path is unavailable, the task continues and the UI uses a local fallback. See [Web presentation](packages/web/web-presentation/README.md) and its [design record](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.md).

## Which version should I choose?

Choose the official DeepSeek Harness when you want the latest supported release, official package distribution, or primarily use headless and CLI workflows.

Choose DeepSeek Harness UX when the Web UI is your main workspace and you regularly run multi-step tasks where progress clarity, session recovery, compact reading, and deliverable access matter.

<a id="run-from-source"></a>

## Run

This community edition runs from source. Requirements:

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

Open `http://127.0.0.1:3081`, then add a model provider under **Settings → Models** and create a session. Replace `3081` if that port is already in use.

This repository currently ships as a complete source edition. It is not yet a drop-in Fabric patch or a separately published npm plugin for a clean upstream checkout.

## Project status

The current edition follows the 2026-08-12 DeepSeek Harness source snapshot plus the UX work documented in this repository. It is suitable for local evaluation and community development, but it does not carry upstream support or compatibility guarantees.

## Privacy

Session logs stay local by default. Do not commit `.env`, `.npmrc`, API keys, local sessions, build output, or profile data. Review the upstream telemetry settings before enabling a non-default telemetry mode.

## Development

Read [AGENTS.md](AGENTS.md), the [development guide](docs/development.md), and [architecture](docs/architecture.md) before changing packages.

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## Community links

- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) — An interactive terminal UI plugin for DeepSeek Harness with TDD, evidence gates, vision, and code intelligence workflows.
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — A Claude Code-style full-screen terminal UI for DSH with live task status, streamed reasoning, rollback, and context/TPS metrics.
- [DSH Find](https://dshfind.com) — A DeepSeek Harness learning and sharing community featuring paper reviews, a plugin directory, and user rankings.

## License and attribution

This repository is derived from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and preserves upstream notices. The project uses the BSD 3-Clause license; third-party dependencies and license terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
