# DeepSeek Harness UX

[English](README.en.md) | 中文

**让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长任务更容易看懂、更容易跟进。**

DeepSeek Harness UX 是一个非官方社区源码版本。它没有重写 Agent 的工作方式，而是重点改进网页里的任务过程、长回答、会话查找和文件入口。

> 本项目不是 DeepSeek 官方发行版，也不享有上游官方支持。DeepSeek Harness 及相关名称归其权利人所有。

## 你会直接感受到什么

### 1. 会话进行时，思考和工具步骤不会一直刷屏

任务运行时，思考、上下文、命令和工具调用会被收进一个稳定的“过程”区域。你可以直接看到当前做到哪一步、已经运行多久，不必在大量技术消息里寻找进度。

如果启用展示辅助，界面还会用一次很小的模型请求，把 Todo、思考和工具证据整理成更容易理解的阶段名称。这个请求只负责显示，不会改变 Agent 的回答。

### 2. 任务完成后，过程自动折叠，答案回到主视线

正常完成的任务会自动收起思考过程，让最终答案留在最显眼的位置。遇到失败或中断时，过程会继续展开，方便检查问题。

**任务完成后，过程会自动收起：**

![任务完成后，运行过程自动折叠](assets/readme-process-collapsed.png)

**需要检查时，点一下就能重新展开：**

![重新展开运行过程，查看思考与上下文细节](assets/readme-process-expanded.png)

### 3. 长日志可以单独滚动，不会带着整个对话乱跳

展开“运行详情”后，长命令输出和工具日志会在自己的区域里滚动。滚到边缘时不会突然把整个对话带走，底部输入框也不会把页面顶出一大片空白。

### 4. 长回答更适合阅读

回答的段落、标题和不同轮次之间更紧凑。任务结束后，可选的展示辅助还能优化答案标题；复制内容、会话历史和模型看到的原始答案都不会被改写。

任务刚结束时，网页会在后台补齐最后一段历史，避免晚到的结束事件让界面看起来还在运行，也不会闪出新的加载页。

### 5. 以前的会话更容易找

会话默认按最近更新时间排列，也可以切回手动排序。侧边栏可以搜索标题、工作区名称和当前进程中的对话内容；“未分组”区域也能直接新建不属于任何工作区的会话。

### 6. 生成的文件更容易找到

除了工具明确写出的文件，UX 版还会识别答案里清楚列出的文档、表格、数据集、图片、音视频、压缩包、数据库和 3D/CAD 文件路径，把它们显示成可打开的产物入口。普通文字、网址、命令和示例代码不会被误当成文件。

### 7. 模型配置集中在设置页

首次使用时会直接进入“设置 → 模型”的完整配置卡，不再维护另一套简化的密钥弹窗。提供方、模型、API Key 和错误恢复都在同一个地方完成。

## 它没有改变什么

- Agent Loop、模型路由、工具、权限、沙箱和 Session Log 仍沿用 DeepSeek Harness 的执行方式。
- 原始思考、上下文、命令和工具证据没有被删除，只是收进“运行详情”。
- 展示辅助不会修改 System Prompt、用户消息、工具、原始回答或会话历史。
- Session Log 默认仍保存在本地。

## 和官方版本相比，还需要知道这些

- 这是基于上游源码快照维护的社区版本，不会自动获得官方后续的修复、兼容性更新和安全更新。
- 这个快照还没有官方后来加入的部分能力，例如更严格的冷会话校验、隐藏当前无法登录的 OAuth-only 提供方，以及新的全局界面扩展位。
- 当前没有内建的 Codex OAuth 登录和 Token 自动刷新；选择 `openai-codex` 路由时需要手动提供 Token。
- 基础 Bundle 会安装休眠状态的 Codex 和 Claude Code 子代理提供方，但不会因此自动启动对应产品进程。
- 官方版提供 npm 包；这个仓库只提供源码运行，不会向 `@deepseek-ai` scope 发布包。
- 当前官方源码使用 MIT 许可证；这个分支保留其上游快照当时采用的 BSD 3-Clause 许可证和相关声明。

## 应该选哪个版本？

如果你主要在网页里运行长任务，希望过程更清楚、回答更好读、会话和文件更容易找到，可以选择 DeepSeek Harness UX。

如果你更在意最新官方更新、npm 安装、Headless 或 CLI 工作流，应优先选择[官方 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 对比依据

UX 功能源码基于 [`35c6172`](https://github.com/ayuanwong/deepseek-harness-ux/commit/35c61722573f1357f0b5b7e2f687094fb6f7b097)。本说明以 2026-08-17 的官方 [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a) 为对照，只把用户能直接感知的差异写成功能，不把测试、包元数据和机械性源码差异包装成产品能力。

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

打开 `http://127.0.0.1:3081`，在“设置 → 模型”中添加模型提供方，然后新建会话。如果 3081 已被占用，可以换成其他端口。

本仓库交付的是完整源码版本，不是能直接安装到干净上游仓库的补丁，也没有单独发布为 npm 插件。

## 隐私

不要提交 `.env`、`.npmrc`、API Key、本地 Session、构建产物或 profile 数据。启用任何非默认遥测模式前，请先阅读上游遥测设置。展示辅助使用当前 Session 配置的模型提供方，因此启用阶段或标题整理时，会把受限的运行证据发送给该提供方。

## 开发

修改包之前，请阅读 [AGENTS.md](AGENTS.md)、[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

```sh
pnpm run lint
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

## 友情链接

- [![dsh-tianshu-tui](https://img.shields.io/badge/dsh--tianshu--tui-GitHub-5865F2?style=flat-square&logo=github&logoColor=white)](https://github.com/huiliyi37/dsh-tianshu-tui) — 带 TDD、证据检查、视觉和代码智能工作流的交互式终端 UI。
- [![dsh-TUI](https://img.shields.io/badge/dsh--TUI-GitHub-5865F2?style=flat-square&logo=github&logoColor=white)](https://github.com/ccch1mneyyy/dsh-TUI) — Claude Code 风格的全屏终端 UI，支持实时任务状态、流式思考、回滚和上下文指标。
- [![DSH Find](https://img.shields.io/badge/DSH_Find-%E8%B5%84%E6%BA%90%E7%A4%BE%E5%8C%BA-5865F2?style=flat-square)](https://dshfind.com) — DSH Find 上整理的 DeepSeek Harness 资源与生态项目。

## 许可证与归属

本仓库派生自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并保留其源码快照中的上游声明。本源码树使用 [BSD 3-Clause 许可证](LICENSE)；第三方依赖及许可条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
