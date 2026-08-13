# @deepseek-ai/dsh-web-presentation

English | [中文](README.zh.md)

This Host plugin generates optional, display-only labels for the Web conversation. It exposes `webPresentation/process-stage` while a Turn is open and `webPresentation/response-headings` after the closing Assistant message and Turn are complete.

## Configuration

All limits are required: `maxInputBytes`, `maxOutputTokens`, `timeoutMs`, `maxHeadings`, `maxSectionCharacters`, `maxStageEvents`, `maxStageCallsPerTurn`, and `maxTitleCharacters`. The auxiliary request uses the Session's current provider and model, carries `GenerateOptions.purpose: 'presentation'`, and DeepSeek adapters disable thinking for that purpose.

## Semantics

The service reads bounded facts from the Session log, records the exact auxiliary request as `web/presentation-llm-request`, and returns transient labels through Typert Remote. It never rewrites an Assistant message, System Prompt, request header, Tool result, or derived model history. Process results may replace only the current label or append a later label. Answer-heading results address parsed Markdown offsets and apply only to the closing finalized Assistant message.

Failures, timeouts, unavailable routes, invalid JSON, and over-limit inputs return an unavailable result. The browser keeps the authored heading or local activity summary, so the auxiliary call never blocks the Agent or removes readable content.

## Model Experience

### Display-only presentation calls

#### What the model sees

The main Agent sees no added instruction or message. A separate presentation request sees a bounded JSON projection of logged activity or finalized heading/section pairs, no tools, and a concise JSON-only instruction. Raw Tool commands, paths, and result text are omitted.

#### Token effect

Small and bounded. Each accepted running-stage boundary may use one auxiliary request up to `maxStageCallsPerTurn`; one completed closing answer may use one additional heading request. These tokens belong only to the presentation call and never enter the main Agent request or Session-derived history.

#### KV Cache effect

Independent from the main Agent prefix. The auxiliary request uses its own system text and messages, so it cannot change or invalidate the conversation request's reusable prefix; whether the provider caches the auxiliary prefix is provider-owned.

## Known Limitations and Deferred Work

- Refinements require a live Session and its currently configured model route. Historical sessions reopened after Host restart keep the authored headings because the validated response cache is intentionally transient.
- Running-stage requests are throttled over coarse stream revisions and capped; very short turns may show only the local fallback summary.
- The service omits raw Tool result text to avoid leaking paths or command output, so a stage label can be less specific when no model-authored description or Todo is available.
