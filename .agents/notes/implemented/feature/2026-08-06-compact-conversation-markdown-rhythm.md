# Agent Note: Compact conversation Markdown rhythm

Status: implemented

English | [中文](2026-08-06-compact-conversation-markdown-rhythm.zh.md)

## Problem

Assistant replies use readable 16/28 typography, but the reusable Markdown baseline also gives ordinary blocks 16px margins, horizontal rules 32px margins on both sides, and large headings 32px before them. Plain prose remains comfortable; replies that combine headings, lists, quotes, rules, or code surfaces accumulate enough empty space to feel fragmented inside the conversation.

## Decision

`MarkdownText` keeps its deepsuite-compatible metrics as fallbacks and expresses only its block rhythm through inherited component-local custom properties. `AssistantMarkdown` supplies the conversation values: 12px between ordinary blocks, 4px between list items, 24px before and 12px after level-one through level-three headings, and 20px on each side of a horizontal rule. Its own multi-block and settled-action gaps are also 12px. Font sizes, 28px body line height, colors, semantic elements, Markdown source, and interaction behavior remain unchanged.

The override lives on the assistant presentation root, so finalized replies, streaming assistant text, interrupted partials, and assistant-owned expanded Markdown use one rhythm. Other `MarkdownText` consumers inherit no conversation values and retain the reusable primitive's original spacing. The one-pixel rule and all painted properties continue to use shared semantic tokens; only four-pixel-multiple layout values vary by consumer.

This partially supersedes only the default-spacing statement in the [safe assistant Markdown decision](2026-07-23-web-assistant-markdown.md). That note continues to own parsing, untrusted-output policy, semantic rendering, typography tokens, and code-block behavior.

## Alternatives considered

**Reduce the body font size or line height.** Rejected because plain prose was already readable; compressing every line would trade reading comfort for a problem caused by block boundaries.

**Change the reusable Markdown defaults globally.** Rejected because Web answers, plan review, trajectory, and other embedding surfaces may need the established deepsuite rhythm. The conversation owns its denser reading context without silently retuning every consumer.

**Add pair-specific selectors for each adjacent Markdown element.** Rejected because heading, list, paragraph, quote, rule, table, and code combinations create an expanding selector matrix. One inherited rhythm keeps the semantic DOM unchanged and lets normal margin collapsing resolve adjacent blocks.

## Consequences

Mixed-format replies occupy less vertical space and retain clearer section continuity, especially around horizontal rules, while plain paragraphs keep their existing type size and line height. The conversation takes explicit ownership of its content density; the shared primitive gains a small inherited styling seam but no React prop or runtime dependency. A consumer that sets the custom properties can alter spacing, so their fallbacks remain the source of the reusable default.

## Testing

The Markdown component suite continues to pin semantic GFM, TeX, security, and code-block behavior. GUI and assembled Web suites cover the unchanged rendering path. Browser verification checks paragraph/rule/quote content and a separate heading/list/table history at the production viewport; the measured mixed-format sample contracts from 474px to 410px without changing its text or 28px line height.
