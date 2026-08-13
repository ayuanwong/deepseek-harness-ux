/**
 * Frozen service contract of the slash pipeline. Types only. The
 * InputTriggerService implementation publishes this face as `ctx.inputTriggers`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerSource } from '../types.ts'
import type { InputTriggerController } from './controller.ts'

/** The `ctx.inputTriggers` service face. */
export interface InputTriggerServiceContract {
  /** Register one trigger source; effect disposer. Duplicate (trigger, name) throws. */
  registerSource(src: InputTriggerSource): () => void
  /** Resolve the per-session controller for one session scope (lazy; dies with the scope). */
  sessionOf(actx: ClientContext): InputTriggerController
}
