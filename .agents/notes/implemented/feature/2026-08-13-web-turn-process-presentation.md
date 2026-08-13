# Agent Note: Web turn process presentation

Status: implemented

English | [中文](2026-08-13-web-turn-process-presentation.zh.md)

## Problem

The conversation flow rendered reasoning, context, interim Assistant narration, and Tool rows as equal transcript items. During a turn this fragmented one job into several loose blocks, exposed raw `Think` copy, and left large gaps before the final answer. Collapsing all of that while the turn was still active removed the only useful reassurance that work was progressing. Narration placed before a question could also appear once as loose prose and then jump into a process container, even though the user needed that explanation to answer.

## Decision

ChatView adds a presentation-only turn grouping over the existing stable keyed Conversation Nodes. A running turn has one stable, open `ProcessPanel` before its final answer. The panel retains the `Deep diving...` signature, step count, elapsed time, and a compact semantic activity trail. A safe task-object classification supplies an immediate non-empty title without copying the request, while a bounded auxiliary call may refine newly logged Todo, streamed reasoning, and Tool activity into a concrete label. Answer text is deliberately excluded so streaming prose, constraints, and field labels cannot become fake stages. The client throttles continuous streams into coarse activity revisions, then accepts only an in-place rewrite of the current stage or an appended later stage, so repeated older wording cannot become current again. Prefix-growing variants are forced to replace the current stage even if an auxiliary response incorrectly asks to append them. Explicit Todo and model-authored Tool descriptions can advance the local title immediately; raw streamed reasoning never becomes a visible headline before refinement because its newest sentence is commonly incomplete and replaced. Generic status copy, direct query echoes, commands, paths, bare Tool names, first-person narration, and answer metadata are rejected as headlines. Raw context, reasoning, command, and Tool renderers remain available under a nested, default-collapsed `Run details` disclosure.

Visible Assistant prose starts in one stable candidate-answer seat below the live stage instead of inside its blue rail. If later Tool or interaction activity appears, the same seat is promoted in place to a labeled stage result; it never first paints as loose output and then jumps into another container. This keeps a pre-question explanation readable while a question or approval owns the composer without mistaking a streaming final answer for an intermediate result. The same keyed process parent survives running-call to settled-node handoffs and remains as the collapsed summary for every turn that was observed open, including the second and later turns whose detail nodes settle away before the closing answer arrives. Only an authoritative closed turn may settle and collapse the outer disclosure; the closing Assistant answer stays a first-class message outside it. A completed one-line answer that was never observed running and has no supporting activity gets no empty process disclosure.

The same auxiliary service may replace headings only in the browser rendering of a completed closing Assistant message. It parses Markdown offsets, sends bounded heading-and-section records after `turn/end`, and leaves the authored blocks as the copy, branch, replay, and model-history source.

Every auxiliary input is reconstructed from the existing Session log and recorded as `web/presentation-llm-request` before dispatch. The event is log-only, so `deriveMessages()` is unchanged. The call uses `purpose: 'presentation'`, no tools, bounded tokens and time, and disabled DeepSeek thinking. It never changes the Agent System Prompt, request headers, messages, Tool execution, or the closing answer; failure retains the original display.

## Alternatives considered

**Inject display guidance into the Agent System Prompt.** Rejected because it changes the model input and can alter the answer it is meant only to label.

**Use only local string heuristics.** Rejected as the sole source because they cannot consistently name task-specific phases or improve rhetorical answer headings. They remain the zero-latency fallback.

**Keep every raw row visible during work.** Rejected because technical activity then competes with the semantic stage and recreates the fragmented layout.

**Collapse the entire process during work.** Rejected because it hides progress before a result exists. Only technical detail is collapsed while a turn runs.

## Consequences

Active work reads as one calm, forward-moving process with meaningful progress and optional detail; completed work returns attention to the answer without destroying its inspectable history. Browser replay fixes the question-wait edge case: the explanation occurs once in the running stage result, the outer process stays open until the turn ends, and it is collapsed beside the final answer after settlement. Component tests hold the same DOM parent across Tool lifecycle updates, preserve the second turn's collapsed process after settlement, reject an older semantic sentence becoming current again, and prove heading replacement leaves authored Markdown intact.

Presentation calls add bounded provider usage and can finish after the underlying content is already visible. They are non-blocking and failure-safe, but deployments still pay that optional display cost. Their exact request is durable for audit; their result is transient and may be recomputed after restart.

This note supersedes only the transcript-placement wording in [Steer a queued Web message into the active turn](2026-07-30-web-queue-steer-action.md): pending steering now follows the stable turn process group rather than a standalone running-status row. That note remains authoritative for queue, steering, and lifecycle semantics.
