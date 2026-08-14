# Agent Note: Live process details cannot move the conversation behind them

Status: implemented

English | [中文](2026-08-14-live-process-scroll-containment.zh.md)

## Problem

A Windows recording of a long running turn exposed two scroll owners acting on the same gesture. `Run details` is capped at 230px and scrolls internally, but a large wheel tick could finish that inner movement and continue into the conversation scrollport. At the same time Chromium's native scroll anchoring reacted to technical rows being inserted or replaced while ChatView's own anchor ledger and ResizeObserver also restored the bottom.

The visible failure was not ordinary extra padding. The process rows and composer first travelled upward together, leaving an empty viewport tail, and subsequent live output could snap them back to the bottom. The composer was sticky inside the correct host, but the host had already been moved by two competing position mechanisms.

## Decision

The bounded technical log owns vertical wheel input. A non-passive listener normalizes pixel, line, and page deltas, updates only the log's `scrollTop`, clamps at its two edges, and prevents the browser from handing any remainder to the conversation. Non-scrolling settled details do not intercept the gesture. CSS also declares the live log an `overscroll-behavior-y: none` boundary so touch and compositor-driven paths share the same contract.

The conversation scrollport declares `overflow-anchor: none`. ChatView already owns bottom-follow, paging anchors, reader attribution, and composer-resize correction; native anchoring is therefore a second writer rather than a fallback. The scrollport contains boundary overscroll, and the resident conversation root explicitly accepts flex shrinkage with `min-height: 0` and a 100% height cap so platform min-content differences cannot grow the column past its frame.

The composer remains sticky inside the authoritative conversation scrollport. Moving it to a separate fixed layer was rejected: it would change wheel-over-composer behavior, overlay takeovers, and the established single-scrollport contract while leaving the competing anchor writer unresolved.

## Consequences

- Scrolling a long live technical log never changes the transcript position. To scroll the transcript, the pointer must be outside that bounded log.
- Live row insertion and disclosure resize use only ChatView's position ledger, so the composer stays on the scrollport floor instead of visiting an empty tail.
- Completed details remain ordinary unbounded flow and do not trap wheel input.
- No Agent input, Tool strategy, session event, or model token path changes; this is browser presentation only.

## Testing

`chat-view.client.spec.tsx` drives pixel and page wheel deltas through a scrollable running detail region and verifies that the non-passive listener consumes and clamps them locally.

`chat-scroll-contract.e2e.ts` exercises the assembled browser with a long running technical region. It verifies that the inner region moves while the conversation `scrollTop` does not, the composer bottom remains aligned to the scrollport bottom, native anchoring is disabled, and the document never grows beyond the viewport.
