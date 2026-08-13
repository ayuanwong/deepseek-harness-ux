/**
 * Client-safe request and result vocabulary for Web-only presentation summaries.
 * @module @deepseek-ai/dsh-web-presentation/types
 */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Address one finalized assistant answer whose rendered headings may be refined. */
export interface ResponseHeadingPresentationRequest {
  /** Live Session that owns the finalized answer. */
  readonly sessionId: SessionId
  /** Stable id of the finalized assistant message. */
  readonly messageId: MessageId
}

/** One display-only replacement for a parsed Markdown heading. */
export interface ResponseHeadingReplacement {
  /** Zero-based text-block ordinal inside the assistant message. */
  readonly textBlock: number
  /** Source offset of the heading node inside that text block. */
  readonly offset: number
  /** Plain-text title rendered in place of the authored heading children. */
  readonly title: string
}

/** Successful heading refinement, or a no-op/fallback-safe refusal. */
export type ResponseHeadingPresentationResult =
  | {
    readonly kind: 'refined'
    readonly replacements: readonly ResponseHeadingReplacement[]
  }
  | { readonly kind: 'unchanged' }
  | {
    readonly kind: 'unavailable'
    readonly reason:
      | 'session-not-live'
      | 'message-not-found'
      | 'turn-not-closed'
      | 'not-closing-message'
      | 'route-unavailable'
      | 'input-too-large'
      | 'generation-failed'
  }

/** Ask for one calm, semantic update to the current running-stage trail. */
export interface ProcessStagePresentationRequest {
  /** Live Session whose log is the only activity source. */
  readonly sessionId: SessionId
  /** Open Turn being presented. */
  readonly turn: number
  /** Latest source cursor already considered by the browser. */
  readonly afterSeq: number
  /** Append-only titles already accepted by the presentation state machine. */
  readonly acceptedStages: readonly string[]
}

/** A semantic stage update, source no-op, or fallback-safe refusal. */
export type ProcessStagePresentationResult =
  | {
    readonly kind: 'stage'
    /** Latest exact source event represented by this decision. */
    readonly cursor: number
    /** Replace the active stage wording or append a genuinely later phase. */
    readonly action: 'replace-current' | 'append'
    /** Concise natural-language presentation title. */
    readonly title: string
  }
  | {
    readonly kind: 'unchanged'
    /** Latest source event inspected, even when no call was needed. */
    readonly cursor: number
  }
  | {
    readonly kind: 'unavailable'
    readonly reason:
      | 'session-not-live'
      | 'turn-not-found'
      | 'turn-not-open'
      | 'route-unavailable'
      | 'invalid-request'
      | 'input-too-large'
      | 'call-budget-reached'
      | 'generation-failed'
    /** Latest inspected source cursor, when one exists. */
    readonly cursor?: number
  }
