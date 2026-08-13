# @deepseek-ai/dsh-web-presentation

[English](README.md) | 中文

这个 Host 插件为 Web 对话生成可选且仅影响展示的标签。它在 Turn 运行时公开 `webPresentation/process-stage`，在收尾 Assistant 消息与 Turn 均完成后公开 `webPresentation/response-headings`。

## 配置

所有上限都必须显式配置：`maxInputBytes`、`maxOutputTokens`、`timeoutMs`、`maxHeadings`、`maxSectionCharacters`、`maxStageEvents`、`maxStageCallsPerTurn` 和 `maxTitleCharacters`。辅助请求使用 Session 当前的提供方与模型，携带 `GenerateOptions.purpose: 'presentation'`；DeepSeek 适配器会为该用途关闭思考。

## 语义

服务从 Session 日志中读取有界事实，将精确的辅助请求记录为 `web/presentation-llm-request`，再通过 Typert Remote 返回短暂标签。它绝不改写 Assistant 消息、System Prompt、请求标头、Tool 结果或模型消息历史。过程结果只能原位替换当前标签，或追加一个后续标签。答案标题结果指向已解析的 Markdown 偏移，且只适用于已完成 Turn 的收尾 Assistant 消息。

调用失败、超时、路由不可用、JSON 无效或输入超限时，服务返回不可用结果。浏览器保留原始标题或本地活动摘要，因此辅助调用不会阻塞 Agent，也不会移除可读内容。

## 模型体验

### 仅影响展示的辅助调用

#### 模型看到的内容

主 Agent 不会看到新增指令或消息。独立的展示请求只看到已记录活动或已完成标题与段落对的有界 JSON 投影、不获得工具，并接收精简的仅 JSON 输出指令。原始 Tool 命令、路径和结果文本均会被省略。

#### Token 影响

少量且有明确上限。每个被接受的运行阶段边界可以使用一次辅助请求，一个 Turn 最多 `maxStageCallsPerTurn` 次；已完成的收尾答案可以再使用一次标题请求。这些 Token 只属于展示调用，绝不进入主 Agent 请求或 Session 派生历史。

#### KV Cache 影响

与主 Agent 前缀相互独立。辅助请求使用自己的 system 文本与消息，不会改变或使对话请求的可复用前缀失效；辅助前缀是否被提供方缓存由提供方决定。

## 已知局限与延后工作

- 精炼要求 Session 仍在线，且当前模型路由可用。Host 重启后重新打开的历史会话会保留原始标题，因为已校验的响应缓存刻意只存在于内存。
- 运行阶段请求按粗粒度流式版本节流并受次数上限约束；很短的 Turn 可能只显示本地回退摘要。
- 服务会省略原始 Tool 结果文本，避免泄露路径或命令输出；当没有模型撰写的描述或 Todo 时，阶段标签可能较不具体。
