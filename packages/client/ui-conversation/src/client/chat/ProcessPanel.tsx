import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { IconChevronDownOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import { formatRunDuration } from './message-chrome.ts'
import css from './ProcessPanel.module.css'

const WHEEL_LINE_PX = 16

/**
 * The live technical log is a bounded scrollport while a turn is running.
 * Consume its vertical wheel gesture ourselves so one large Windows wheel
 * tick cannot finish the inner scroll and hand its remainder to the
 * conversation scrollport behind it.
 */
function ProcessTechnicalDetails({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = scrollRef.current
    /* v8 ignore next -- the ref is attached by the component's only render path. */
    if (element === null) return
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (event.deltaY === 0 || element.scrollHeight <= element.clientHeight + 1) return
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1
      const limit = Math.max(0, element.scrollHeight - element.clientHeight)
      event.preventDefault()
      event.stopPropagation()
      element.scrollTop = Math.max(0, Math.min(limit, element.scrollTop + event.deltaY * scale))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [])
  return <div ref={scrollRef} className={css.liveDetails}>{children}</div>
}

/** One concise, presentation-only activity line derived from the existing transcript. */
export interface ProcessLogLine {
  key: string
  text: string | null
  state: 'done' | 'active' | 'warning'
  priority: 0 | 1 | 2 | 3
  /** Permit the display-only sidecar to clarify the currently accepted stage in place. */
  replaceCurrent?: boolean
}

interface ProcessStage {
  key: string
  summary: string
  state: ProcessLogLine['state']
}

function stageIdentity(text: string): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  return normalized === '' ? text : normalized
}

/** Merge the latest projection into the mounted turn's append-only trail. */
function mergeProcessStages(
  previous: readonly ProcessStage[], lines: readonly ProcessLogLine[],
): readonly ProcessStage[] {
  let stages = previous
  const mutable = (): ProcessStage[] => {
    if (stages === previous) stages = previous.map(stage => ({ ...stage }))
    return stages as ProcessStage[]
  }
  for (const line of lines) {
    if (line.text === null) continue
    const keyedIndex = line.replaceCurrent === true
      ? stages.findIndex(stage => stage.key === line.key)
      : -1
    if (keyedIndex !== -1) {
      const keyed = stages[keyedIndex]
      if (keyed === undefined) continue
      const isCurrent = keyedIndex === stages.length - 1
      const summary = isCurrent ? line.text : keyed.summary
      if (summary !== keyed.summary || line.state !== keyed.state) {
        mutable()[keyedIndex] = { ...keyed, summary, state: line.state }
      }
      continue
    }
    const identity = stageIdentity(line.text)
    const revisitedIndex = stages.findIndex(stage => stageIdentity(stage.summary) === identity)
    if (revisitedIndex !== -1) {
      const revisited = stages[revisitedIndex]
      if (revisited === undefined) continue
      if (
        (revisitedIndex === stages.length - 1 || line.state === 'warning')
        && revisited.state !== line.state
      ) mutable()[revisitedIndex] = { ...revisited, state: line.state }
      continue
    }
    const latest = stages.at(-1)
    if (latest?.state === 'active') mutable()[stages.length - 1] = { ...latest, state: 'done' }
    mutable().push({
      key: line.replaceCurrent === true ? line.key : `${line.key}:${identity}`,
      summary: line.text,
      state: line.state,
    })
  }
  return stages
}

function RunningClock({ startTime, t }: {
  startTime: number | null
  t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => { setElapsedMs(Math.max(0, Date.now() - anchor)) }
    const id = window.setInterval(tick, 1_000)
    return () => { window.clearInterval(id) }
  }, [anchor])
  if (elapsedMs < 15_000) return null
  return (
    <>
      <span className={css.separator}>·</span>
      {formatRunDuration(elapsedMs, t)}
    </>
  )
}

/**
 * One stable disclosure for an Agent turn. It stays open while the turn is
 * active and removes its `open` attribute only after the authoritative turn
 * boundary closes. Keeping the same root and detail seat avoids remounting
 * stateful Tool rows when a running call settles.
 */
export function ProcessPanel({
  state, count, runMs, startTime, title, lines, trailSource = 'local', result, resultKind, children, t,
}: {
  state: 'running' | 'done' | 'warning'
  count: number
  runMs?: number | undefined
  startTime?: number | null | undefined
  title?: string | null | undefined
  lines?: readonly ProcessLogLine[] | undefined
  /** Reset only the semantic trail when its source switches from fallback to sidecar. */
  trailSource?: 'local' | 'refined' | undefined
  /** User-facing mid-turn narration that must remain readable while work is paused for input. */
  result?: ReactNode | undefined
  /** Candidate answer stays visually separate; later activity promotes it to an intermediate result in place. */
  resultKind?: 'candidate' | 'intermediate' | undefined
  children: ReactNode
  t: ChatViewSlotProps['t']
}) {
  const running = state === 'running'
  const showSemantic = state !== 'done'
  const activity = lines ?? []
  const [stageTrail, setStageTrail] = useState<readonly ProcessStage[]>(
    () => mergeProcessStages([], activity),
  )
  const trailSourceRef = useRef(trailSource)
  // A streaming reasoning block can replace its own latest sentence, so the
  // current snapshot alone cannot preserve forward progress. Commit accepted
  // sentences before paint; repeated older sentences update in place.
  useLayoutEffect(() => {
    if (trailSourceRef.current !== trailSource) {
      trailSourceRef.current = trailSource
      setStageTrail(mergeProcessStages([], activity))
      return
    }
    // Sidecar lines carry the complete accepted semantic timeline plus any
    // newer explicit Tool/Todo fact. Rebuild that small timeline so a refined
    // title replaces its provisional local wording instead of duplicating it.
    if (trailSource === 'refined') {
      setStageTrail(mergeProcessStages([], activity))
      return
    }
    setStageTrail(previous => mergeProcessStages(previous, activity))
  }, [activity, trailSource])
  const visibleStages = stageTrail.slice(-4)
  const current = visibleStages.at(-1)
  const earlier = visibleStages.slice(0, -1)
  const hasResult = result !== null && result !== undefined
  const focusTitle = current?.summary ?? title ?? null
  const keepRunningOpen = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (running && !event.currentTarget.open) event.currentTarget.open = true
  }

  return (
    <details
      className={`${css.panel} ${running ? css.running : css.settled}`}
      data-process-panel={state}
      open={running || state === 'warning' || undefined}
      onToggle={keepRunningOpen}
    >
      <summary className={css.summary} data-process-disclosure="">
        <IconChevronDownOutline14 className={css.chevron} />
        <span className={css.statusLine} role={running ? 'status' : undefined} aria-live={running ? 'polite' : undefined}>
          <span className={running ? css.signature : css.title}>
            {running ? 'Deep diving...' : t(state === 'warning' ? 'chat.process.warning' : 'chat.process')}
          </span>
          <span className={css.meta} aria-hidden={running || undefined}>
            <span className={css.separator}>·</span>
            {t(count === 1 ? 'chat.process.steps.one' : 'chat.process.steps.other', { n: count })}
            {running && startTime !== undefined && <RunningClock startTime={startTime} t={t} />}
            {!running && runMs !== undefined && (
              <>
                <span className={css.separator}>·</span>
                {formatRunDuration(runMs, t)}
              </>
            )}
          </span>
        </span>
        <span className={css.rule} aria-hidden />
      </summary>
      <div className={css.body}>
        {showSemantic && (
          <div className={css.semantic}>
            {earlier.length > 0 && (
              <ol className={css.stageTrail} aria-label={t('chat.process.previousStages')}>
                {earlier.map(stage => (
                  <li key={stage.key} className={css.stageRow}>
                    <StateDot state={stage.state === 'warning' ? 'warning' : 'done'} size={8} />
                    <span className={css.stageSummary}>{stage.summary}</span>
                  </li>
                ))}
              </ol>
            )}
            {focusTitle !== null && (
              <div
                className={css.stageFocus}
                role="log"
                aria-label={t('chat.activity.log')}
                aria-live="polite"
                aria-atomic="true"
              >
                <div className={css.focusLine}>
                  <StateDot
                    state={current?.state === 'warning' ? 'warning' : 'ongoing'}
                    size={8}
                  />
                  {current?.state === 'warning' && (
                    <span className={a11yCss.visuallyHidden}>{t('chat.process.warning')}</span>
                  )}
                  <div className={css.runningTitle} data-process-stage-title="">{focusTitle}</div>
                </div>
              </div>
            )}
            {hasResult && (
              <div
                className={`${css.stageResult} ${resultKind === 'intermediate' ? css.intermediateResult : css.answerCandidate}`}
                data-process-result=""
                data-process-result-kind={resultKind ?? 'candidate'}
                role={resultKind === 'intermediate' ? 'region' : undefined}
                aria-label={resultKind === 'intermediate' ? t('chat.process.result') : undefined}
              >
                {resultKind === 'intermediate' && (
                  <div className={css.resultLabel}>{t('chat.process.result')}</div>
                )}
                <div className={css.resultBody}>{result}</div>
              </div>
            )}
          </div>
        )}
        {children !== null && children !== undefined && (
          <details
            key="technical-details"
            className={css.liveDisclosure}
            data-process-live-disclosure=""
            open={running ? undefined : true}
          >
            <summary className={css.liveSummary}>
              <IconChevronDownOutline14 className={css.liveChevron} />
              <span>{t('chat.process.details')}</span>
            </summary>
            <ProcessTechnicalDetails>{children}</ProcessTechnicalDetails>
          </details>
        )}
      </div>
    </details>
  )
}
