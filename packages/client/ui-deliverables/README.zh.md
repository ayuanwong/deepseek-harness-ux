# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

产出文件与可点击文件引用功能的属主。Node 侧向系统提示词 registry 注册最终回复指引；浏览器侧把已完成轮次末尾的产出文件行注册到 chat 视图的 `conversation.chat.turnTail` slot，并将收尾正文中匹配的行内代码引用转换为链接。正式提供的组合中只有 Web patch 加载本包；从 cordis.yml 中删去这一项会同时移除提示词、文件行与正文链接。

`deliverablesDefinition` 把每个轮次中成功的修改调用折叠进引擎发布的 `DeliverablesTurnData`；`producedForClosing` 结合收尾 Assistant 的 seq 读取这份数据。修改操作按渲染意图而非工具名识别：diff 卡片，或 `kind` 为 `edit` 的通用卡片（即 `str_replace_editor` 的 insert 操作所呈现的形态）；因此新的修改工具只需声明自身行为即可加入。读取、删除和失败的调用不贡献任何条目。对于没有修改位置的常见命令生成产物——PDF、办公文档、表格与数据集、图片与设计文件、音视频、压缩包、电子书、数据库以及 3D／CAD 文件——已结算的收尾正文只要有意声明精确路径就会补入：Markdown 行内代码、Markdown 链接目标，或只包含路径的一行。本地 `file://` 链接目标会还原为 Host 路径。Web URL、shell 命令、围栏代码示例、glob 以及嵌在无关普通叙述中的路径仍会被排除；路径按首见顺序去重。这项补充仅影响展示，不会发起额外模型请求。

`ProducedFiles` 在收尾消息正文与其 IconActions 之间渲染该行：一个低调的标签和一条经过测量的单行文件 lane。它展示能够放下的最大前缀（至多六个标签项；文本为文件名，完整路径作为 `title`），并为本地化后的精确 `+ N 个文件` 宽度预留空间，因此剩余计数始终可见，既不换行也不横向滚动。每个标签项经由属主提供的 `openFile` 打开——与工具行相同的 Host 打开器，chat 视图会把相对路径按会话 cwd 解析。存在隐藏文件时，第二行的**在文件夹中显示**也经由同一属主路径打开会话 workspace；它只在页面使用 loopback 且当前 Host 握手报告 `canOpenPath` 时出现，直接远程 Web 与 headless／容器 Linux Host 默认均省略该操作。设计原理：[workspace 文件链接 Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md)。

收尾正文承载同一份词表。本插件提供供 chat 视图按收尾消息查询的 `chatFileMentions` 服务：`producedFileMentions` 按精确路径解析行内代码 token，或当 token 恰好等于某条产出路径的 basename，且这样的路径仅有一条时解析——两条路径共享同一 basename 时，文本保持不可点击而不作猜测。解析成功的提及保留代码标签，并采用 Markdown 样式表的链接样式：静止时为链接蓝色，悬停时显示下划线，与 URL 提升的行内代码完全一致——完整路径作为其 `title`；提及绝不会渲染在链接内部或流式文本中。决策记录：[行内文件提及 Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md)。

Node 侧注册静态系统提示词段落 `ui:deliverable-file-references`。它要求模型点名成功创建或修改的主要文件，并将这些文件以及正文中提到的其他本轮变更文件写成 Markdown 行内代码：使用文件工具采用的精确路径，或仅在 basename 能唯一指代本轮文件时使用 basename。该提示词只向模型说明渲染器接受的语法；它不约束无关的路径讨论，也不会扩大渲染器的成功修改词表。

## 模型体验

### 可点击文件引用指引

#### 模型看到的内容

一段固定提示词要求模型在最终回复中点名成功创建或修改的主要文件，并将这些文件以及正文中提到的其他本轮变更文件写成采用精确路径或唯一 basename 的 Markdown 行内代码，例如 `out/report.html`。

#### Token 影响

加载本包时增加一段固定提示词；不增加工具 schema、工具结果或按 Turn 变化的上下文。

#### KV Cache 影响

该段落在本包加载期间始终以顺序 190 保持静态，因此留在可复用的提示词前缀中，不会随 Turn 改变。

## 已知限制与暂缓事项

- **提及匹配只认精确路径或唯一 basename。**后缀式提及（`out/index.html` 写作 `index.html` 可解析；`deep/out/index.html` 写作 `out/index.html` 则不行）保持不可点击；等真实的收尾消息形态产生需求后再放宽匹配规则。
- **来自收尾正文的补充不是文件系统事实。**常见产物只要在支持的 Markdown 写法或独立路径行中有意声明精确路径就会显示，不会额外发起 stat 请求；如果模型点名了并未创建的路径，标签项仍可能把不存在的文件交给 Host 打开器。文本与代码输出仍以修改工具的位置为权威依据。
- **原生文件夹交接以 Host 桌面为目标。**经非 loopback 权威访问的浏览器会省略该操作，报告没有原生打开器的部署也一样。若 SSH 转发让远端 Host 看似处于本机 loopback，部署必须为网关设置 `nativeOpen: false`；无界面的 macOS／Windows Host、Windows interop 不可用的 WSL，或 display／opener 探测误报的 Linux 桌面也必须这样配置。识别操作者实际可见的桌面仍属于部署策略。
