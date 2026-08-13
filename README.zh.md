# DeepSeek Harness UX

[English](README.md) | 中文

这是一个基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立社区 Web 交互体验版本。在保持上游插件架构和 Agent 执行策略不变的前提下，重点优化历史会话恢复、任务运行过程、对话阅读密度、消息操作、产物展示和工作区导航。

> 本项目是非官方社区项目，不是 DeepSeek 官方发行版。DeepSeek Harness 及相关名称归其权利人所有。

## 体验优化重点

- 更快、更稳健的历史会话恢复，并提供清晰的失败与重试状态。
- 任务运行时保持一个稳定、易读的过程区域；详情随时可查，任务完成后自动折叠。
- 通过受限的辅助模型调用，动态优化阶段摘要和答案标题。该调用只影响展示，不改变主模型提示词、工具、原始回答或会话历史。
- 更紧凑的多轮对话阅读节奏；复制、Branch 等操作默认隐藏，悬浮时显示。
- 更清晰的工作区与产物展示，覆盖常见文档格式。

实现细节与限制见 [Web 展示辅助服务](packages/web/web-presentation/README.zh.md) 和对应的 [Agent Note](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.zh.md)。

## 从源码运行

需要 Node.js `^22.19` 或 `>=24`、pnpm 11，以及兼容 DeepSeek 的 API Key。

```sh
git clone https://github.com/ayuanwong/deepseek-harness-ux.git
cd deepseek-harness-ux
pnpm install
pnpm run build
pnpm run dsh -- web --port 3081
```

打开 `http://127.0.0.1:3081`，然后在**设置 → 模型**中添加模型提供方。

本社区版本不会以 `@deepseek-ai` npm scope 发布任何包，建议直接从源码运行。

## 隐私

Session Log 默认留在本地。不要提交 `.env`、`.npmrc`、API Key、本地会话、构建产物或 profile 数据。启用任何非默认遥测模式前，请先阅读上游遥测设置。

## 开发

修改包之前，请阅读 [AGENTS.md](AGENTS.md)、[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

常用检查：

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## 上游与归属

本仓库基于 2026 年的 DeepSeek Harness 源码快照并包含社区 UX 修改。上游项目：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

## 许可证

[BSD 3-Clause](LICENSE)。上游快照中的版权声明和许可条款均予以保留。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
