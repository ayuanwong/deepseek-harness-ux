// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatNodeStore, ConversationTimelineSnapshot, QueuedMessage,
} from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ProcessGroup } from './ProcessGroup.tsx'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

function nodeTurn(node: ChatNode): number | null {
  return node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn.turn
    : null
}

function contentText(content: QueuedMessage['content']): string | null {
  const text = content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  return text === '' ? null : text
}

/** Active request strings are presentation filters only; they never become
 * prompt input and never trigger another model call. */
function currentTaskQueries(
  order: readonly string[], nodeStore: ChatNodeStore, pendingSteering: readonly QueuedMessage[],
): readonly string[] {
  const queries: string[] = []
  const add = (value: string | null): void => {
    if (value !== null && !queries.includes(value)) queries.push(value)
  }
  for (let index = pendingSteering.length - 1; index >= 0; index -= 1) {
    const item = pendingSteering[index]
    if (item !== undefined) add(item.text ?? contentText(item.content))
  }
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const key = order[index]
    const node = key === undefined ? undefined : nodeStore.get(key) as ChatNode | undefined
    if (node?.kind === 'steering') add(contentText(node.data.content))
    if (node?.kind === 'user') {
      add(contentText(node.data.content))
      break
    }
  }
  return queries
}

interface VisiblePresentationItem {
  readonly kind: 'node'
  readonly key: string
  readonly nodeKey: string
}

interface ProcessPresentationItem {
  readonly kind: 'process'
  readonly key: string
  readonly turn: number | null
  readonly nodeKeys: readonly string[]
  readonly closingKey?: string | undefined
  readonly live: boolean
  readonly anchorKey: string
}

type PresentationItem = VisiblePresentationItem | ProcessPresentationItem

interface PendingProcessGroup {
  turn: number
  nodeKeys: string[]
  closingKey?: string
}

/** Find the authoritative closing Assistant for every retained completed turn. */
function closingByTurn(
  order: readonly string[],
  nodeStore: ChatNodeStore,
): ReadonlyMap<number, string> {
  const closingSeqs = new Map<number, number>()
  for (const key of order) {
    const node = nodeStore.get(key) as ChatNode | undefined
    if (node?.kind !== 'turn-tail' || node.data.closing === null) continue
    closingSeqs.set(node.data.turn, node.data.closing.finalNode.seq)
  }
  const closing = new Map<number, string>()
  for (const key of order) {
    const node = nodeStore.get(key) as ChatNode | undefined
    if (node?.kind !== 'assistant-step' || node.data.finalNode === undefined) continue
    if (closingSeqs.get(node.data.turn) === node.data.finalNode.seq) closing.set(node.data.turn, key)
  }
  return closing
}

function latestOpenTurn(timeline: ConversationTimelineSnapshot): number | null {
  for (let index = timeline.turnOrder.length - 1; index >= 0; index -= 1) {
    const number = timeline.turnOrder[index]
    if (number !== undefined && timeline.turns.get(number)?.status === 'open') return number
  }
  return null
}

/**
 * Presentation-only grouping over the stable final Node order. The Node store,
 * turn data, Tool lifecycles and execution strategy remain untouched.
 */
function presentChatNodes(
  order: readonly string[],
  nodeStore: ChatNodeStore,
  timeline: ConversationTimelineSnapshot,
  seenOpenTurns: ReadonlySet<number>,
  rememberedNodeTurns: ReadonlyMap<string, number>,
  running: boolean,
): PresentationItem[] {
  const closing = closingByTurn(order, nodeStore)
  const presented: PresentationItem[] = []
  // Keep the accumulator in an object because `flush` mutates it from a
  // closure; this also keeps control-flow narrowing truthful across loops.
  const state: { pending: PendingProcessGroup | null } = { pending: null }
  const shouldGroup = (turn: number): boolean => (
    timeline.turns.get(turn)?.status === 'closed' || seenOpenTurns.has(turn)
  )
  const flush = (): void => {
    if (state.pending === null) return
    const group = state.pending
    state.pending = null
    const status = timeline.turns.get(group.turn)?.status
    const live = status !== 'closed' && seenOpenTurns.has(group.turn)
    // A completed one-line answer with no reasoning, Tool or supporting
    // narration needs no empty process disclosure.
    if (group.nodeKeys.length > 0 || live || seenOpenTurns.has(group.turn)) {
      presented.push({
        kind: 'process', key: `process:${group.turn}`, turn: group.turn,
        nodeKeys: group.nodeKeys, closingKey: group.closingKey, live,
        // The process wrapper owns its own navigation identity. Reusing a
        // child Tool/Assistant key here creates duplicate scroll anchors and
        // makes long-history restoration land on whichever duplicate wins.
        anchorKey: `process:${group.turn}`,
      })
    }
    if (group.closingKey !== undefined) {
      presented.push({ kind: 'node', key: group.closingKey, nodeKey: group.closingKey })
    }
  }

  for (const key of order) {
    const node = nodeStore.get(key) as ChatNode | undefined
    if (node === undefined) continue
    const turn = nodeTurn(node) ?? rememberedNodeTurns.get(node.key) ?? null
    if (turn === null || !shouldGroup(turn) || node.kind === 'user' || node.kind === 'steering') {
      flush()
      presented.push({ kind: 'node', key, nodeKey: key })
      continue
    }
    if (state.pending?.turn !== turn) {
      flush()
      state.pending = { turn, nodeKeys: [] }
    }
    if (node.kind === 'turn-tail') {
      flush()
      presented.push({ kind: 'node', key, nodeKey: key })
      continue
    }
    const group = state.pending
    if (closing.get(turn) === key) {
      group.closingKey = key
      continue
    }
    group.nodeKeys.push(key)
  }
  flush()

  if (running && !presented.some(item => item.kind === 'process' && item.live)) {
    const turn = latestOpenTurn(timeline)
    presented.push({
      kind: 'process', key: `process:${turn ?? 'pending'}`, turn,
      nodeKeys: [], live: true, anchorKey: `process:${turn ?? 'pending'}`,
    })
  }
  return presented
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useSessions, useProjection, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  fileMentions, refineResponseHeadings, refineProcessStage, t,
}: ChatViewSlotProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const timeline = useSession(s => s.chat.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const userQueries = useMemo(
    () => currentTaskQueries(order, nodeStore, pendingSteering),
    [nodeStore, order, pendingSteering],
  )
  /** Remember unfinished turns so the stable Process parent survives both the
   * running-call → settled-node handoff and pauses for user input. `running`
   * may be false during a question/approval even though the Turn is still open. */
  const seenOpenTurnsRef = useRef<Set<number>>(new Set())
  const rememberedNodeTurnsRef = useRef<Map<string, number>>(new Map())
  const groupingSessionRef = useRef(sessionId)
  if (groupingSessionRef.current !== sessionId) {
    groupingSessionRef.current = sessionId
    seenOpenTurnsRef.current.clear()
    rememberedNodeTurnsRef.current.clear()
  }
  if (running) {
    for (const [turn, location] of timeline.turns) {
      if (location.status === 'open') seenOpenTurnsRef.current.add(turn)
    }
  }
  for (const key of order) {
    const node = nodeStore.get(key) as ChatNode | undefined
    if (node === undefined) continue
    const turn = nodeTurn(node)
    if (turn !== null) rememberedNodeTurnsRef.current.set(key, turn)
  }
  const presentation = useMemo(
    () => presentChatNodes(
      order, nodeStore, timeline, seenOpenTurnsRef.current, rememberedNodeTurnsRef.current, running,
    ),
    [nodeStore, order, running, timeline],
  )

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {presentation.map(item => item.kind === 'node' ? (
            <ChatNodeSeat
              key={item.key}
              nodeKey={item.nodeKey}
              useSession={useSession}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={openFile}
              inspectCall={inspectCall}
              forkAt={forkAt}
              loadImage={loadImage}
              fileMentions={fileMentions}
              refineResponseHeadings={refineResponseHeadings}
              renderSlot={renderSlot}
              t={t}
            />
          ) : (
            <div key={`${sessionId}:${item.key}`} data-chat-anchor-key={item.anchorKey} data-chat-process-turn={item.turn ?? ''}>
              <ProcessGroup
                turn={item.turn}
                nodeKeys={item.nodeKeys}
                closingKey={item.closingKey}
                live={item.live}
                userQueries={userQueries}
                useSession={useSession}
                useProjection={useProjection}
                selectedCallId={selectedCallId}
                cwd={cwd}
                openFile={openFile}
                inspectCall={inspectCall}
                forkAt={forkAt}
                loadImage={loadImage}
                fileMentions={fileMentions}
                refineResponseHeadings={refineResponseHeadings}
                refineProcessStage={refineProcessStage}
                renderSlot={renderSlot}
                t={t}
              />
            </div>
          ))}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {pendingSteering.map(item => (
            <PendingSteeringBubble key={item.id} content={item.content} loadImage={loadImage} t={t} />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
