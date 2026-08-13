# Agent Note: inline-code file mentions open the file they name

Status: implemented

English | [中文](2026-08-07-web-inline-file-mentions.zh.md)

> Scope: guiding final responses to name primary output files as inline code, then linking those tokens to the turn's produced-file list. Not in scope: recognizing paths in plain prose and mentions in streaming or mid-turn messages.

## Problem

The produced-files row lists a turn's output, but the closing message usually also *names* the file in prose — as inline code, like `` `deepseek-homepage.html` `` — and that mention was inert text. The reader's eye lands on the sentence first; the affordance sat one row below it. The model was not told that this exact inline-code spelling activates the Web file opener, so producing the useful reference depended on habit.

## Decision

**A prose mention links only when it matches the produced-file list.** `producedFileMentions` resolves an inline-code token by exact path, or by being exactly the basename of exactly one produced path. A basename two paths share stays inert rather than guessing. The list is grounded primarily in mutation `locations`; the [produced-files decision](2026-07-31-web-workspace-file-links.md) also permits intentional common-artifact paths from the settled closing answer when they appear in inline code, a Markdown link destination, or a path-only line. PDF and similar command-generated outputs therefore share the same chip and prose interaction without another model request.

**The renderer owns no vocabulary, and the provider is the deliverables plugin.** `MarkdownText` takes an optional `MarkdownFileMentions` resolver and consults it for inline-code tokens — after URL promotion, which wins, and never inside an anchor, where a button cannot nest. What names a file is decided behind the optional `chatFileMentions` service ui-conversation reaches via `ctx.get`: ui-deliverables provides it beside its turn-tail chain entry, so one cordis.yml line composes the row and the prose links in or out together, and ui-primitives gains no session concepts. Mentions apply to settled renders only — the streaming cache must not bake in handlers that could go stale, and the vocabulary is not final until the turn closes. The consumer memoizes the resolver on the closing seq rather than the growing transcript, so a settled message's cached parse survives stream appends.

**The provider also owns the model guidance for its accepted syntax.** The ui-deliverables Node half registers a static `ui:deliverable-file-references` section that asks the model to mention primary files from successful creation or modification calls in its final response and to write those and any other changed-file references as Markdown inline code, using the exact file-tool path or a basename only when it is unique within the Turn. The guidance deliberately says nothing about unrelated local-path formats. The shipped Web patch is the only composition that loads ui-deliverables, so the guidance exists exactly where the renderer exists; removing the package removes both. Mutation locations keep text and code outputs independent of prose; common command-generated artifacts require the exact closing reference because their tools publish no mutation location.

## Alternatives considered

- **Path-shaped regex over all prose** — links `package.json` mentioned abstractly and examples that were never written. Exact inline code, a closed set of common artifact extensions, and fenced-code, URL, command, and glob rejection constrain the fallback to deliberate output references.
- **Linking suffix matches (`out/index.html` mentioned as `index.html` in a subdirectory listing)** — deferred; exact path and unique basename cover the observed closing-message shapes, and a wider matcher can loosen later without breaking the seam.
- **Resolving in ui-primitives against a passed path list** — puts matching policy in the generic renderer, where other consumers would inherit it unasked. The resolver contract keeps policy with the owner.
- **Threading the vocabulary through the turn-tail chain** — the chain is a render dispatch below the message; mentions decorate markdown inside it, which only data reaching MarkdownText can do. The optional service is that data path, and its absence is the off state.
- **Registering the guidance in dsh-web-app** — makes the app bundle describe a feature-specific rendering syntax and allows the renderer and its prompt to drift or be composed independently. The feature package's existing Node half gives one cordis.yml row joint ownership.
- **Adding a post-turn model step to identify the output** — adds latency and another generation even though the final response already has the necessary file-tool history. One static prompt paragraph stays in the reusable prefix and asks the existing final generation to emit the accepted spelling.

## Consequences

The mention and the row are two affordances for one path (full path as `title` on both); the mention itself wears the markdown sheet's anchor language — link-blue at rest, hover underline — because an at-rest underline collides with monospace descenders inside the code chip. The prompt section is constant for the package mount and therefore remains cacheable across Turns. The keyless shipped-Web composition snapshot pins the exact model-visible paragraph, while `apps/web/tests/produced-file-mentions.e2e.ts` pins the assembled rendering with a built write-turn seed: unique basename links, ambiguous and unknown text/code tokens stay inert. Common command-generated artifacts named as exact inline code are included without an existence check; a mistaken closing path can therefore yield a chip the Host cannot open. Mentions in mid-turn narration stay inert because the vocabulary attaches to the closing message only. The window-prepend edge — a window that starts mid-turn later gaining earlier same-turn writes — leaves a mutation-backed mention unlinked until remount, never wrongly linked.
