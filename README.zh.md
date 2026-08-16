# DeepSeek Harness UX

[English](README.md) | **中文（推荐）**

**让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长任务过程更清楚、更安静、更可信。**

DeepSeek Harness UX 是一个基于 DeepSeek Harness 的非官方社区源码版本。它保留上游的插件架构、Agent Loop、模型提供方、工具、权限、沙箱和主模型请求语义，把主动差异集中在用户长时间观看和操作的 Web 界面。

> 本项目不是 DeepSeek 官方发行版，也不享有上游官方支持。DeepSeek Harness 及相关名称归其权利人所有。

## 为什么做这个版本？

长任务会产生大量有价值的运行证据，但如果每一条事件都以相同的视觉权重出现，用户反而很难回答三个基本问题：它还在工作吗？现在做到哪里了？已经完成了吗？

这个版本把事件流组织成稳定的过程区域，按需保留技术证据，任务完成后把阅读重点还给答案，并让最近会话和产物更容易找到。

## 与官方 DeepSeek Harness 的完整功能差异

下表覆盖这个分支主动维护的全部用户可见差异。生成文件、测试、包元数据、仅仓库使用的工具，以及机械性的源码树差异，不会被包装成产品功能。

对比快照：

- **DeepSeek Harness UX：** 功能源码为 [`35c6172`](https://github.com/ayuanwong/deepseek-harness-ux/commit/35c61722573f1357f0b5b7e2f687094fb6f7b097)，底层基于 2026-08-12 的上游源码快照。
- **官方 DeepSeek Harness：** [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)，即本次于 2026-08-17 审查时采用的 `master` 头部。

| 功能面 | 对比快照中的官方 DeepSeek Harness | DeepSeek Harness UX | 差异性质 |
|---|---|---|---|
| Agent 执行 | 官方 Agent Loop、模型路由、工具、权限策略、沙箱和 Session Log | 保留相同的执行模型；Web 展示不重新定义 Agent 策略 | 刻意不变 |
| 任务运行过程 | 推理、上下文、工具行和中间叙述以普通对话事件展示 | 用一个稳定的过程面板组织整个 Turn，持续显示当前阶段、步骤数和耗时 | 新增 UX |
| 阶段标题 | 使用事件原有的展示文本 | 可选的受限展示模型调用，把 Todo、推理与工具证据提炼成只向前推进的阶段轨迹 | 新增 UX；产生少量受限模型用量 |
| 技术证据 | 事件与工具行直接留在对话流中 | 原始推理、上下文、命令和工具行继续保留在“运行详情”中，按需展开 | 重组 UX，不删除证据 |
| 运行详情滚动 | 原生嵌套滚动可能把滚轮余量继续交给外层对话 | 有高度上限的运行详情独占滚动手势；对话区关闭冲突的原生锚定，避免吸底输入框跳进空白区域 | UX 缺陷修复 |
| 完成与失败 | 历史继续保持普通事件布局 | 正常任务进入 idle 后自动折叠；终止性或未恢复失败保持展开，已恢复的中间错误留在详情中 | 新增 UX |
| 回答标题 | 展示模型原始 Markdown 标题 | 第二次受限的展示模型调用可优化已完成答案的标题；原始 Markdown 仍是复制、历史和模型侧真值 | 新增 UX；产生少量受限模型用量 |
| 对话阅读 | 标准 Markdown 间距和消息操作 | 混合格式答案更紧凑、Turn 分隔更清楚，复制、评价与 Branch 在悬浮或键盘聚焦时显示 | 视觉与交互调整 |
| idle 边界历史修复 | 沿普通历史与实时事件通道更新 | 常驻 Session 从 running 变为 idle 时，只在后台刷新重叠的历史尾部，修复晚到的 `turn/end`，不闪加载态，也不丢已加载旧页 | 恢复能力增强 |
| 会话排序 | Manual 是持久化默认值，Last updated 可选 | 一次迁移后默认使用 **Last updated**，同时保留 Manual | 默认值调整 |
| 未分组会话 | New Session 会继承或指定 Workspace | “未分组”组拥有独立的新建动作，明确创建或复用不继承 Workspace 的空白 Session | 新增 UX |
| 侧边栏内容搜索 | 全文 Session 搜索默认关闭，需要部署显式启用；标题与 Workspace 名称匹配仍可用 | 基础 Bundle 在首次搜索时打开内存 SQLite 索引，因此当前进程默认可搜索对话内容 | 能力／默认值差异 |
| 冷 Session 行 | 对较小的冷存档进行有界的空白状态与最近人工 Prompt 校验，避免陈旧空行和仅因打开而更新时间 | 本快照早于这项上游校验，继续使用此前的冷列表行为 | 尚未包含的上游修复 |
| 产物识别 | 完成 Turn 的产物行来自成功写入类工具提供的位置 | 还会识别答案中被明确声明的常见产物精确路径，包括文档、数据集、图片、音视频、压缩包、数据库和 3D/CAD 文件；普通叙述、网址、命令和代码围栏仍被排除 | 新增 UX |
| 首次模型配置 | 对比快照中的上游先显示带版本的内测提示，再显示条件式 DeepSeek Key 弹窗 | 本快照不显示内测提示；条件式 DeepSeek 步骤会进入完整的“设置 → 模型”配置卡，避免维护第二个密钥编辑器 | 主动简化 |
| 仅 OAuth 的目录提供方 | 无法由当前构建认证的目录提供方会从新增列表隐藏，例如已安装但仅支持 OAuth 的 `openai-codex` 路由 | 本快照仍可能显示该路由，但没有内建 OAuth 登录和持久刷新流程；需要手动提供 Token | 已知快照限制 |
| Codex 与 Claude Code 子代理提供方 | 默认生产 Bundle 不包含，只有显式选择的 Profile 才安装并挂载 | 两个休眠提供方都是基础 Bundle 的依赖；加载它们不会启动对应产品进程，但会安装相关包 | 组合／默认值差异 |
| 全局扩展位 | 提供 `shell.overlay` 与 `sidebar.footer.action`，官方 Cordis UI 用它们承载全局控制 | 本快照早于这些扩展位与全局 Cordis UI | 尚未包含的上游能力 |
| 分发方式 | 官方公开 npm 包，可用 `npx @deepseek-ai/dsh web` 启动 | 只提供源码检出；本仓库不会在 `@deepseek-ai` scope 下发布任何包 | 分发差异 |
| 对比树许可证 | 当前上游源码树使用 MIT | 本分支保留其源码快照采用的 BSD 3-Clause，并保留上游声明 | 快照／法律差异 |

## 当前官方版已有、这里尚未包含的能力

本仓库是源码快照，不是持续 rebase 的补丁，因此不会自动带入后续上游工作。本次审查在两个源码树里找到的已知用户可见差异都已列入表格，包括首次引导、搜索默认值、冷 Session 处理、提供方可用性、扩展位、分发和许可证。后续上游的维护、兼容性、打包与安全修复不会自动合入。如果你更在意持续跟进官方版本，应优先选择上游。

## 展示辅助不会改变答案

可选的展示服务只读取一小段已经记录的过程证据，并且只返回展示元数据。它**不会**修改主模型的 System Prompt、用户消息、工具、推理、原始回答或会话历史。

展示调用可能增加少量 Token 消耗和等待时间。调用失败、超时、路由不可用或返回无效内容时，Agent 不会被阻塞；界面会保留原始标题或使用安全的本地阶段标题。实现细节见 [Web 展示辅助服务](packages/web/web-presentation/README.md)和对应的[设计记录](.agents/notes/implemented/feature/2026-08-13-web-turn-process-presentation.md)。

## 应该选哪个版本？

如果你需要最新的官方源码、npm 分发、当前官方扩展位，或者主要使用 Headless 与 CLI 工作流，选择[官方 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

如果 Web UI 是你的主要工作区，而且你愿意用基于快照的社区版本换取更紧凑的运行过程、稳定的长日志滚动、最近会话默认排序和更广的产物识别，选择 DeepSeek Harness UX。

<a id="run"></a><a id="run-from-source"></a>

## 从源码运行

环境要求：

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

打开 `http://127.0.0.1:3081`，在“设置 → 模型”中添加模型提供方，然后新建 Session。如果 3081 已被占用，可以换成其他端口。

本仓库交付的是完整源码版本，不是能直接安装到干净上游仓库的 Fabric 补丁，也没有单独发布为 npm 插件。

## 隐私

Session Log 默认留在本地。不要提交 `.env`、`.npmrc`、API Key、本地 Session、构建产物或 profile 数据。启用任何非默认遥测模式前，请先阅读上游遥测设置。展示服务使用当前 Session 配置的模型提供方与模型，因此可选提炼运行时会把受限证据投影发送给该提供方。

## 开发

修改包之前，请阅读 [AGENTS.md](AGENTS.md)、[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## 友情链接

| 项目 | 说明 |
|---|---|
| [![dshfind](https://dshfind.com/api/badge/huiliyi37/dsh-tianshu-tui?lang=zh)](https://dshfind.com/zh/plugins/huiliyi37/dsh-tianshu-tui?ref=badge) | DeepSeek Harness 交互式终端 UI 插件，集成 TDD、证据门、视觉和代码智能工作流。 |
| [![dshfind](https://dshfind.com/api/badge/ccch1mneyyy/dsh-TUI?lang=zh)](https://dshfind.com/zh/plugins/ccch1mneyyy/dsh-TUI?ref=badge) | Claude Code 风格的全屏终端 UI，提供实时任务状态、流式思考、回滚和上下文／TPS 指标。 |
| [![dshfind](https://dshfind.com/api/badge/0xsline/awesome-deepseek-harness?lang=zh)](https://dshfind.com/zh/plugins/0xsline/awesome-deepseek-harness?ref=badge) | DSH Find 上整理的 DeepSeek Harness 资源与生态项目。 |

## 许可证与归属

本仓库派生自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并保留其源码快照中的上游声明。本源码树使用 [BSD 3-Clause 许可证](LICENSE)；第三方依赖及许可条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
