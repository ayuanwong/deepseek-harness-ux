# DeepSeek Harness UX

[English](README.md) | 中文

**让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长任务过程更清楚、更安静、更可信。**

DeepSeek Harness 本身已经是一套可扩展的 Coding Agent Harness。这个社区版本集中优化用户真正长时间面对和操作的部分：历史会话恢复、任务进度、多轮阅读、消息操作、产物和工作区导航。

它不是另一个 Agent。上游的插件架构、Agent Loop、工具、权限、沙箱和主模型输入都保留下来，改动刻意集中在 Web 展示与交互层。

> 本项目由社区独立维护，不是 DeepSeek 官方发行版。DeepSeek Harness 及相关名称归其权利人所有。

## 它有什么用？

长任务会产生大量有价值的运行证据，但如果每一条事件都以相同的视觉权重出现，用户反而很难回答三个最基本的问题：它还在工作吗？现在做到哪里了？已经完成了吗？

DeepSeek Harness UX 把事件流组织成一个稳定的过程区域：

- 任务运行时持续展示当前阶段和少量已完成阶段，不再让日志铺满整段对话。
- 技术推理、工具调用、提问和权限审批仍可在“运行详情”中查看；它们没有被删除，也不会冒充最终结果。
- 任务完成后，过程自动折叠，让最终结果成为阅读重点。
- 复制、评价和 Branch 等操作继续保留，但不会长期占据每一条消息。
- 历史会话、工作区和产物拥有明确的加载、恢复、排序与打开行为。

最终得到的仍然是 DeepSeek Harness，只是长任务运行时更容易建立信任，任务结束后也更容易阅读。

## 和原版 DeepSeek Harness 有什么区别？

| 方面 | 原版 DeepSeek Harness | DeepSeek Harness UX |
|---|---|---|
| 核心目标 | 通用 Agent Harness、插件、工具、运行时和官方 Web UI | 建立在同一 Harness 上的社区 Web 交互体验版本 |
| Agent 执行 | 上游 Agent Loop、模型提供方、工具、权限与沙箱 | 与上游保持一致，UX 优化不重新定义 Agent 策略 |
| 任务运行过程 | 通用的事件与工具展示 | 一个有语义的过程区域，当前进度持续可见，技术细节按需展开 |
| 任务完成以后 | 对话和事件历史继续可查 | 过程自动折叠，最终结果成为视觉重点 |
| 长运行日志 | 浏览器原生嵌套滚动与对话流 | 详情区域独立滚动，输入框保持吸底，不会跳进大段空白 |
| 对话阅读 | 标准消息操作与 Markdown 排版 | 操作按钮悬浮显示、轮次分隔更清楚、长文更紧凑、回答标题更克制 |
| 会话与工作区 | 上游会话和工作区能力 | 增加恢复与重试状态、运行指示、新会话优先排序和更克制的工作区密度 |
| 产物 | 上游产物管线 | 常见格式更容易被识别和打开，包括 PDF 与 Web 文件 |
| 交付方式 | 官方包与上游源码 | 独立源码版本；本仓库不会在 `@deepseek-ai` scope 下发布包 |

这份对比描述的是本仓库采用的源码基线。上游仍在持续演进，部分体验优化未来可能出现重叠。

## 展示辅助不会改变模型结果

部分阶段标题和回答标题会由 Web 展示服务通过受限的辅助模型调用进行提炼。服务只读取一小段已经记录的过程证据，并且只返回展示元数据。

这些调用**不会**修改主模型的 System Prompt、用户消息、工具、推理、原始回答或会话历史。它可能增加少量只用于展示的 Token 和等待时间；辅助链路不可用时，主任务仍会继续，界面使用本地兜底文案。实现细节见 [Web 展示辅助服务](packages/web/web-presentation/README.md)和对应的[设计记录](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.md)。

## 应该选哪个版本？

如果你需要最新的官方支持版本、官方包分发，或者主要使用 Headless 与 CLI 工作流，选择官方 DeepSeek Harness。

如果 Web UI 是你的主要工作区，而且经常执行多步骤任务，重视过程是否清楚、历史能否恢复、对话是否好读以及产物是否容易打开，选择 DeepSeek Harness UX。

<a id="run-from-source"></a>

## 运行

本社区版本从源码运行，环境要求：

- Node.js `^22.19` 或 `>=24`
- pnpm 11
- 兼容 DeepSeek 的 API Key

```sh
git clone https://github.com/ayuanwong/deepseek-harness-ux.git
cd deepseek-harness-ux
pnpm install
pnpm run build
pnpm run dsh -- web --port 3081
```

打开 `http://127.0.0.1:3081`，在“设置 → 模型”中添加模型提供方，然后新建会话。如果 3081 已被占用，可以替换成其他端口。

本仓库目前交付的是完整源码版本，还不是能够直接安装到干净上游仓库的 Fabric 补丁，也没有单独发布为 npm 插件。

## 项目状态

当前版本基于 DeepSeek Harness 2026-08-12 源码快照，并加入本仓库记录的 UX 优化。它适合本地试用与社区开发，但不提供上游官方支持或兼容性承诺。

## 隐私

Session Log 默认留在本地。不要提交 `.env`、`.npmrc`、API Key、本地会话、构建产物或 profile 数据。启用任何非默认遥测模式前，请先阅读上游遥测设置。

## 开发

修改包之前，请阅读 [AGENTS.md](AGENTS.md)、[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## 许可证与归属

本仓库派生自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并保留上游声明。项目使用 BSD 3-Clause 许可证；第三方依赖及许可条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
