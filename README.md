# DeepSeek Harness UX

English | [中文](README.zh.md)

An independent, community-maintained Web UX edition of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It keeps the upstream plugin architecture and agent execution strategy while refining the browser experience around session recovery, running-task progress, conversation density, actions, deliverables, and workspace navigation.

> This is an unofficial community project and is not an official DeepSeek distribution. DeepSeek Harness and related names belong to their respective owners.

## UX focus

- Faster, resilient historical-session recovery with clear retry states.
- One stable, readable process surface while a task is running; details remain available and completed work folds automatically.
- Dynamic, display-only stage summaries and answer-heading refinements through bounded auxiliary model calls. These calls do not alter the main model's prompt, tools, authored answer, or conversation history.
- Compact multi-turn reading rhythm with hover-only message actions and clearer turn separation.
- More legible workspace and deliverable presentation, including common document formats.

Implementation details and limitations are documented in [Web presentation](packages/web/web-presentation/README.md) and the relevant [Agent Note](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.md).

## Run from source

Requirements: Node.js `^22.19` or `>=24`, pnpm 11, and a DeepSeek-compatible API key.

```sh
git clone https://github.com/ayuanwong/deepseek-harness-ux.git
cd deepseek-harness-ux
pnpm install
pnpm run build
pnpm run dsh -- web --port 3081
```

Open `http://127.0.0.1:3081`, then add a model provider under **Settings → Models**.

No package from this repository is published under the `@deepseek-ai` npm scope. Source execution is the supported path for this community edition.

## Privacy

Session logs stay local by default. Do not commit `.env`, `.npmrc`, API keys, local sessions, build output, or profile data. Review the upstream telemetry settings before enabling any non-default telemetry mode.

## Development

Read [AGENTS.md](AGENTS.md), [development guide](docs/development.md), and [architecture](docs/architecture.md) before changing packages.

Common checks:

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## Upstream and attribution

This repository is based on a 2026 DeepSeek Harness source snapshot and includes community UX modifications. Upstream project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

## License

[BSD 3-Clause](LICENSE). Copyright notices and license terms from the upstream snapshot are preserved. Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
