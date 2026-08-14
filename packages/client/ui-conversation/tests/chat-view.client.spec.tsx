// @vitest-environment jsdom
// ChatView behavior: flow derivation, streaming isolation (Profiler counts),
// Tool seat ownership and selection handoff — driven through a scripted
// ObservableSnapshot fake, no wire or Tool presentation plugin.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useEffect } from 'react'
import type {
  AssistantMessageNode, CommandNode, CompactionSummaryNode, ConversationNode, ConversationSnapshot,
  ModelRetryNode, RunningToolCall, SessionId, SessionListState, ToolCallBlock, ToolResultNode, TurnErrorNode,
  TurnMaxTokensNode, UserMessageNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS, PendingWait,
} from '@deepseek-ai/dsh-client-runtime/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ChatNode, ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, SelectionTarget, UseChatNodeTurnData,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import { ChatView } from '../src/client/chat/ChatView.tsx'
import { zh } from '../src/client/locales.ts'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from '../src/client/chat/CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
} from '../src/client/chat/MessageItem.tsx'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import { formatRunDuration } from '../src/client/chat/message-chrome.ts'
import { ProcessPanel } from '../src/client/chat/ProcessPanel.tsx'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
// Keyless create() persists under the bare declared key; clear between cases
// so one harness's selection cannot rehydrate into the next.
beforeEach(() => {
  localStorage.clear()
})

const SID = 's1' as SessionId
type RoutedChatNodeOwner = ChatNodeOwnerProps & { readonly node: ChatNode }

function snapshotBase(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: chatSnapshotFixture(), nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Scripted snapshot source: set() swaps the top-level object like the real Session. */
function makeSource(init?: Partial<ConversationSnapshot>) {
  const initial = { ...snapshotBase(), ...init }
  let snap: ConversationSnapshot = {
    ...initial,
    chat: init?.chat ?? chatSnapshotFixture(initial),
  }
  const subs = new Set<() => void>()
  return {
    set: (next: Partial<ConversationSnapshot>) => {
      const merged = { ...snap, ...next }
      snap = {
        ...merged,
        chat: Object.hasOwn(next, 'chat') && next.chat !== undefined
          ? next.chat
          : chatSnapshotFixture(merged, snap.chat),
      }
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

const user = (seq: number, text: string): UserMessageNode => ({
  kind: 'user',
  seq,
  time: seq * 1000,
  content: [{ type: 'text', text }] as never,
  source: null,
})
const assistant = (seq: number, text: string, turn = 1): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: 1, blocks: [{ kind: 'text', text }],
})
const retry = (seq: number): ModelRetryNode => ({
  kind: 'model-retry', retryId: 'chat-view-retry' as ModelRetryNode['retryId'],
  seq, time: seq * 1_000, turn: 1, step: 0,
  retryState: 'scheduled',
  provider: 'mock', mode: 'normal', policyKey: 'mock-normal',
  retry: 1, maxRetries: 2, delayMs: 450,
  failure: { code: 'TRANSPORT', message: '连接被重置' },
})
const turnError = (seq: number, code?: string): TurnErrorNode => ({
  kind: 'turn-error', seq, time: seq * 1_000, turn: 1, step: 0,
  message: seq === 2 ? 'API key is invalid' : 'plugin exploded',
  ...(code === undefined ? {} : { code }),
})
const turnMaxTokens = (seq: number): TurnMaxTokensNode => ({
  kind: 'turn-max-tokens', seq, time: seq * 1_000, turn: 1, step: 0,
})
const toolResult = (seq: number, callId: string, name = 'bash'): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name, argsRaw: `{"command":"cmd-${callId}","description":"run ${callId}"}` },
  callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})
const runningCall = (callId: string, name = 'bash'): RunningToolCall => ({
  callId, name, argsRaw: `{"command":"cmd-${callId}"}`, turn: 2, step: 1, time: 1_000, callView: null, subCalls: [],
})
const command = (over: Partial<CommandNode> = {}): CommandNode => ({
  kind: 'command', seq: 5, time: 5_000, commandId: 'cmd-1' as CommandNode['commandId'],
  name: 'plan', args: '', outcome: { kind: 'success', text: '已进入 plan mode' },
  ...over,
})
const compaction = (over: Partial<CompactionSummaryNode> = {}): CompactionSummaryNode => ({
  kind: 'compaction', seq: 8, time: 8_000,
  summary: '## 压缩摘要\n\n保留的事实。',
  summaryEventSeq: 7,
  shadowedItemCount: 16,
  shadowedTokenCount: 11_309,
  ...over,
})

/** Empty sessions-list hook for the global standard-kit seat. */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}

function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function makeHarness(init?: Partial<ConversationSnapshot>) {
  const { set, source } = makeSource(init)
  const openDetails = vi.fn<(t: SelectionTarget) => void>()
  const openFile = vi.fn<(path: string) => void>()
  const loadOlder = vi.fn()
  const inspectCall = vi.fn<(callId: string) => void>()
  // In-memory scroll memory matching the apply.ts per-session map contract.
  let savedScroll: ReturnType<ChatViewSlotProps['chatScroll']['read']> = null
  const chatScroll: ChatViewSlotProps['chatScroll'] = {
    save: (position) => { savedScroll = position },
    read: () => savedScroll,
  }
  const forkAt = vi.fn()
  // Selection rides the REAL chat store (same construction path as
  // production; the view reads it through the PropsStore useStore share).
  const chat = createChatStore().create()
  const t = makeTranslate(zh, commonZh)
  const toolOwners: Array<{
    callId: string
    toolName: string
    block: ToolCallBlock
    selectedCallId: string | undefined
    openFile: ChatNodeOwnerProps['openFile']
    inspectCall: ChatNodeOwnerProps['inspectCall']
  }> = []
  const renderCommandSlot = ((_key: string, _owner: object, opts?: { fallback?: React.ReactNode }) =>
    opts?.fallback ?? null) as unknown as React.ComponentProps<typeof CommandNodeView>['renderSlot']
  const renderTurnTail = ((_key: string, _owner: object) => null) as unknown as
    React.ComponentProps<typeof TurnTailNodeView>['renderSlotChain']
  const renderTurnTailSlot = (() => null) as unknown as
    React.ComponentProps<typeof TurnTailNodeView>['renderSlot']
  const renderSlot = ((key: string, owner: object, opts?: {
    fallback?: React.ReactNode
    hookContext?: unknown
  }) => {
    if (key !== 'conversation.chat.node') return opts?.fallback ?? null
    const nodeOwner = owner as RoutedChatNodeOwner
    const nodeKey = opts?.hookContext as string | undefined
    const useTurnData: UseChatNodeTurnData = dataKey => props.useSession((snapshot) => {
      const location = nodeKey === undefined ? undefined : snapshot.chat.nodes.get(nodeKey)?.location
      return location?.kind === 'turn' || location?.kind === 'step'
        ? location.turn.data.get(dataKey)
        : undefined
    })
    const nodeProps = <Kind extends ChatNode['kind']>(): ChatNodeViewProps<Kind> => (
      { ...props, ...nodeOwner, useTurnData } as unknown as ChatNodeViewProps<Kind>
    )
    switch (nodeOwner.node.kind) {
      case 'user':
      case 'steering':
        return <UserMessageNodeView {...nodeProps<'user' | 'steering'>()} />
      case 'context':
        return <ContextMessageNodeView {...nodeProps<'context'>()} />
      case 'assistant-step':
        return <AssistantNodeView {...nodeProps<'assistant-step'>()} />
      case 'command':
        return (
          <CommandNodeView
            {...nodeProps<'command'>()}
            renderSlot={renderCommandSlot}
            SessionProvider={props.SessionProvider}
          />
        )
      case 'manual-compaction':
        return <ManualCompactionNodeView {...nodeProps<'manual-compaction'>()} />
      case 'compaction':
        return <CompactionNodeView {...nodeProps<'compaction'>()} />
      case 'model-retry':
        return <RetryNodeView {...nodeProps<'model-retry'>()} />
      case 'turn-error':
        return <TurnErrorNodeView {...nodeProps<'turn-error'>()} />
      case 'turn-max-tokens':
        return <TurnMaxTokensNodeView {...nodeProps<'turn-max-tokens'>()} />
      case 'turn-tail':
        return (
          <TurnTailNodeView
            {...nodeProps<'turn-tail'>()}
            renderSlot={renderTurnTailSlot}
            renderSlotChain={renderTurnTail}
            SessionProvider={props.SessionProvider}
          />
        )
      case 'unknown':
        return <UnknownNodeView {...nodeProps<'unknown'>()} />
      case 'tool-call': {
        const block = nodeOwner.node.data.root
        const toolName = 'kind' in block ? block.call?.name ?? '' : block.name
        const tool = {
          callId: block.callId,
          toolName,
          block,
          selectedCallId: nodeOwner.selectedCallId,
          openFile: nodeOwner.openFile,
          inspectCall: nodeOwner.inspectCall,
        }
        toolOwners.push(tool)
        return (
          <div
            data-testid={`tool-seat-${tool.callId}`}
            data-chat-anchor-key={`call:${tool.callId}`}
            data-chat-call-id={tool.callId}
          >
            {tool.toolName || '(unnamed)'}:{tool.callId}
          </div>
        )
      }
      default:
        return opts?.fallback ?? null
    }
  }) as unknown as ChatViewSlotProps['renderSlot']
  // SessionProvider seat arrives with the session-scope child declaration;
  // ChatView never invokes it (render-prop pass-through stub).
  const SessionProviderStub: ChatViewSlotProps['SessionProvider'] = ({ children }) => <>{children(SID)}</>
  const props: ChatViewSlotProps = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source),
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useProjection: (() => undefined),
    useInput: (() => { throw new Error('unused') }),
    inputActions: {
      setDraft: () => {},
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    useStore: bindSnapshotSelector(chat),
    actions: chat.actions,
    renderSlot,
    SessionProvider: SessionProviderStub,
    openDetails,
    openFile,
    loadOlder,
    loadImage: vi.fn(() => Promise.reject(new Error('not used'))),
    inspectCall,
    chatScroll,
    forkAt,
    // Absent-service default; mention tests override with a real resolver.
    fileMentions: () => undefined,
    refineResponseHeadings: async () => [],
    refineProcessStage: async () => null,
    // Mirrors the real lookup chain (conversation namespace, then common).
    t,
  }
  const setSelection = (next: SelectionTarget | null): void => { chat.actions.select(next) }
  return {
    set, ChatView, props, openDetails, openFile, loadOlder, inspectCall,
    chatScroll, forkAt, setSelection, toolOwners,
  }
}

/** Simulate reader input (any device): a delivered position that deviates
 * from the observed-top ledger of programmatic writes. */
function readerScroll(element: HTMLElement, top: number): void {
  element.scrollTop = top
  fireEvent.scroll(element)
}

function installScrollMetrics(element: HTMLElement, initialHeight: number, clientHeight: number) {
  let scrollHeight = initialHeight
  let scrollTop = 0
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight)) },
  })
  return {
    setHeight: (value: number) => { scrollHeight = value },
    setLayout: (height: number, top: number) => {
      scrollHeight = height
      scrollTop = Math.max(0, Math.min(top, scrollHeight - clientHeight))
    },
  }
}

function requiredProcessStage(root: ParentNode): HTMLElement {
  const stage = root.querySelector<HTMLElement>('[data-process-stage-title]')
  if (stage === null) throw new Error('expected a non-empty process stage')
  expect(stage.textContent?.trim()).not.toBe('')
  return stage
}

function expectSafeProcessStage(root: ParentNode, rejected: readonly string[] = []): HTMLElement {
  const stage = requiredProcessStage(root)
  for (const fragment of rejected) expect(stage.textContent).not.toContain(fragment)
  return stage
}

describe('Chat node rendering', () => {

  it('threads the injected file-mention vocabulary into the closing prose only', () => {
    const wrote = (seq: number, callId: string, path: string): ToolResultNode => ({
      ...toolResult(seq, callId, 'write'),
      callView: {
        card: 'diff', title: 'Write', diffs: [{ path, oldText: null, newText: 'x' }], locations: [{ path }],
      },
    })
    const h = makeHarness({
      nodes: [
        user(1, 'build it'),
        assistant(2, 'writing `report.html` now', 1),
        wrote(3, 'w', 'site/report.html'),
        assistant(4, 'Wrote `report.html`; `notes.md` untouched.', 1),
      ],
      turnEnds: new Map([[1, 4]]),
    })
    // Stub provider mirroring the real service: only produced files resolve.
    h.props.fileMentions = owner => ({
      resolve: (value) => {
        if (value !== 'report.html') return undefined
        return {
          open: () => { h.openFile(`for-seq-${String(owner.seq)}/site/report.html`) },
          label: '打开 site/report.html',
          title: 'site/report.html',
        }
      },
    })
    const view = render(<h.ChatView {...h.props} />)
    // Exactly one live mention: the closing message links, the mid-turn
    // narration stays inert code, and the unknown file resolves to nothing.
    const mentions = view.container.querySelectorAll('code button')
    expect(mentions).toHaveLength(1)
    const mention = view.getByRole('button', { name: '打开 site/report.html' })
    expect(mention.getAttribute('title')).toBe('site/report.html')
    fireEvent.click(mention)
    // The vocabulary was built from the closing message's own owner currency.
    expect(h.openFile).toHaveBeenCalledWith('for-seq-4/site/report.html')
  })

  it('formatRunDuration localizes units and floors partial seconds', () => {
    const t = makeTranslate(zh, commonZh)
    expect(formatRunDuration(0, t)).toBe('0秒')
    expect(formatRunDuration(-500, t)).toBe('0秒')
    expect(formatRunDuration(15_999, t)).toBe('15秒')
    expect(formatRunDuration(125_000, t)).toBe('2分05秒')
  })

})

describe('ChatView', () => {
  it('hands a windowless tool result to the Tool seat with an empty tool name', () => {
    const h = makeHarness({
      nodes: [{ ...toolResult(3, 'w1'), call: null }],
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('tool-seat-w1')).toBeTruthy()
    expect(h.toolOwners[0]).toMatchObject({ callId: 'w1', toolName: '' })
  })

  it('prepend keeps the reader\'s latest pending-request scroll position anchored', () => {
    const h = makeHarness({ nodes: [user(9, 'first visible'), user(10, 'next visible')], hasMore: true })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    const first = view.container.querySelector('[data-chat-flow-key="fixture:user:9"]') as HTMLDivElement
    const next = view.container.querySelector('[data-chat-flow-key="fixture:user:10"]') as HTMLDivElement
    let firstTop = 100
    let nextTop = 300
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, bottom: 200 } as DOMRect),
    )
    vi.spyOn(first, 'getBoundingClientRect').mockImplementation(
      () => ({ top: firstTop, bottom: firstTop + 40 } as DOMRect),
    )
    vi.spyOn(next, 'getBoundingClientRect').mockImplementation(
      () => ({ top: nextTop, bottom: nextTop + 40 } as DOMRect),
    )
    Object.defineProperty(scroller, 'scrollHeight', { value: 800, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, writable: true })
    readerScroll(scroller, 50)
    fireEvent.click(view.getByText('加载更早'))
    // The reader moves after the request starts; this, not the click-time
    // row, is the intent the arriving page must preserve.
    firstTop = -200
    nextTop = 60
    readerScroll(scroller, 90)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1300, writable: true })
    nextTop = 560
    act(() => { h.set({ nodes: [assistant(2, 'older'), user(9, 'first visible'), user(10, 'next visible')] }) })
    expect(scroller.scrollTop).toBe(590) // latest 90 + the anchored row's 500px prepend shift
  })

  it('renders the fixture main line as independently keyed business nodes', () => {
    const h = makeHarness({
      nodes: [user(1, 'do the thing'), assistant(2, 'running tools'), toolResult(3, 'a'), toolResult(4, 'b')],
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText('do the thing')).toBeTruthy()
    expect(view.getByText('running tools')).toBeTruthy()
    expect(view.getByTestId('tool-seat-a').textContent).toBe('bash:a')
    expect(view.getByTestId('tool-seat-b').textContent).toBe('bash:b')
    expect([...view.container.querySelectorAll('[data-chat-flow-key]')].map(row => ({
      key: row.getAttribute('data-chat-flow-key'),
      kind: row.getAttribute('data-chat-flow-kind'),
    }))).toEqual([
      { key: 'fixture:user:1', kind: 'user' },
      { key: 'fixture:assistant:2', kind: 'assistant-step' },
      { key: 'fixture:tool:a', kind: 'tool-call' },
      { key: 'fixture:tool:b', kind: 'tool-call' },
    ])
    expect([...view.container.querySelectorAll('[data-chat-call-id]')].map(row => row.getAttribute('data-chat-call-id')))
      .toEqual(['a', 'b'])
    expect([...view.container.querySelectorAll('[data-chat-anchor-key]')].map(row => row.getAttribute('data-chat-anchor-key')))
      .toEqual([
        'fixture:user:1', 'fixture:assistant:2',
        'fixture:tool:a', 'call:a', 'fixture:tool:b', 'call:b',
      ])
  })

  it('renders Host-pending steering at the flow tail and hands off to the durable node', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const pending = {
      id: 'steer-occurrence' as never,
      messageId: 'steer-message' as never,
      placement: 'steering' as const,
      content: [{ type: 'text' as const, text: 'interrupt now' }],
      preview: 'interrupt now',
      text: 'interrupt now',
    }
    const queued = {
      id: 'queued-occurrence' as never,
      messageId: 'queued-message' as never,
      placement: 'queued' as const,
      content: [{ type: 'text' as const, text: 'later' }],
      preview: 'later',
      text: 'later',
    }
    const h = makeHarness({ nodes: [assistant(1, 'working')], queue: [queued, pending], running: true })
    const view = render(<h.ChatView {...h.props} />)

    expect(view.getByText('interrupt now').closest('[data-pending-steering]')).not.toBeNull()
    expect(view.queryByText('later')).toBeNull()
    const pendingBubble = view.getByText('interrupt now').closest('[data-pending-steering]')
    expect(pendingBubble).not.toBeNull()
    fireEvent.click(within(pendingBubble as HTMLElement).getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('interrupt now')
    expect(within(pendingBubble as HTMLElement).queryByRole('button', { name: '在新对话中分支' })).toBeNull()
    expect(view.getByRole('status').compareDocumentPosition(view.getByText('interrupt now'))
      & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    act(() => {
      h.set({
        queue: [queued],
        nodes: [
          assistant(1, 'working'),
          {
            kind: 'steering', messageId: pending.messageId,
            seq: 2, time: 2_000,
            content: [{ type: 'text', text: 'interrupt now' }], source: null,
          },
        ],
      })
    })
    expect(view.getAllByText('interrupt now')).toHaveLength(1)
    expect(view.container.querySelector('[data-pending-steering]')).toBeNull()
    // Only the durable steering bubble: the turn is still running, so its
    // assistant narration owns no footer yet, and a steering bubble never
    // carries a branch action.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(1)
    const durableBubble = view.getByText('interrupt now').closest('[class*="userRow"]') as HTMLElement
    expect(within(durableBubble).queryByRole('button', { name: '在新对话中分支' })).toBeNull()

    act(() => {
      h.set({ running: false, turnEnds: new Map([[1, 3]]) })
    })
    // The Turn Tail belongs to the closed Turn, independently of a later
    // steering bubble's placement in the Chat list.
    const branchButtons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(branchButtons).toHaveLength(1)
    expect(branchButtons[0]!.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(branchButtons[0]!)
    expect(h.forkAt).toHaveBeenCalledWith(1)
  })

  it('keeps a later pending occurrence visible when it reuses a durable MessageId', () => {
    const pending = {
      id: 'steer-occurrence-later' as never,
      messageId: 'shared-steer-message' as never,
      placement: 'steering' as const,
      content: [{ type: 'text' as const, text: 'same steering' }],
      preview: 'same steering',
      text: 'same steering',
    }
    const h = makeHarness({
      queue: [pending],
      nodes: [{
        kind: 'user', seq: 2, time: 2_000,
        content: pending.content, source: null,
      }],
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)

    expect(view.getAllByText('same steering')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-pending-steering]')).toHaveLength(1)
  })

  it('animates only the latest unresolved model retry', () => {
    const retryNode = retry(2)
    const nextRetry = { ...retry(3), turn: 2, retry: 2 }
    const context = {
      kind: 'context', seq: 4, time: 4_000, content: [], source: null,
      provenance: { role: 'inject', label: null },
      form: null,
    } as const satisfies ConversationNode
    const h = makeHarness({ nodes: [user(1, 'try'), retryNode], running: true })
    const view = render(<h.ChatView {...h.props} />)
    const disclosure = view.container.querySelector('[data-chat-flow-kind="model-retry"] details') as HTMLDetailsElement
    expect(disclosure.dataset.active).toBe('true')
    expect(within(disclosure).getByRole('status').textContent).toBe('正在重试模型请求（1/2） · 1s')

    act(() => {
      h.set({ nodes: [user(1, 'try'), nextRetry] })
    })
    expect(within(disclosure).getAllByRole('status')).toHaveLength(1)
    expect(view.container.querySelector('[data-chat-flow-kind="model-retry"] details')).toBe(disclosure)
    expect(within(disclosure).getByRole('status').textContent).toBe('正在重试模型请求（2/2） · 1s')

    act(() => {
      h.set({
        nodes: [
          user(1, 'try'),
          { ...nextRetry, retryState: 'started' },
          context,
          assistant(5, 'done'),
        ],
        running: false,
      })
    })
    const settledDisclosure = view.container.querySelector('[data-chat-flow-kind="model-retry"] details') as HTMLDetailsElement
    expect(settledDisclosure.dataset.active).toBeUndefined()
    expect(within(settledDisclosure).getByRole('status').textContent).toBe('已重试模型请求（2/2） · 1s')

    act(() => {
      h.set({ nodes: [user(1, 'try'), { ...retry(6), retryState: 'cancelled' }], running: true })
    })
    const cancelledDisclosure = view.container.querySelector('[data-chat-flow-kind="model-retry"] details') as HTMLDetailsElement
    expect(cancelledDisclosure.dataset.active).toBeUndefined()
    expect(within(cancelledDisclosure).getByRole('status').textContent).toContain('重试已取消')
  })

  it('renders terminal turn failures inline with their durable message and optional code', () => {
    const h = makeHarness({ nodes: [user(1, 'try'), turnError(2, 'AUTH'), turnError(3)] })
    const view = render(<h.ChatView {...h.props} />)
    const statuses = view.getAllByRole('status')
    expect(statuses.map(status => status.textContent)).toEqual([
      '本轮运行失败API key is invalidAUTH',
      '本轮运行失败plugin exploded',
    ])
  })

  it('renders the max-tokens notice with localized guidance, distinct from turn errors', () => {
    const h = makeHarness({ nodes: [user(1, 'try'), assistant(2, 'truncated'), turnMaxTokens(3)] })
    const view = render(<h.ChatView {...h.props} />)
    const statuses = view.getAllByRole('status')
    expect(statuses.map(status => status.textContent)).toEqual([
      '已达到输出 token 上限回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
    ])
    expect(view.queryByText('本轮运行失败')).toBeNull()
  })

  it('hands the trajectory callback to the Tool seat', () => {
    const h = makeHarness({
      nodes: [toolResult(3, 'a')],
    })
    render(<h.ChatView {...h.props} />)
    expect(h.toolOwners[0]?.inspectCall).toBe(h.inspectCall)
  })

  it('shows assistant IconActions only on the last content message of each turn', () => {
    const h = makeHarness({
      nodes: [
        user(1, 'hi'),
        assistant(2, 'mid-turn text'),
        toolResult(3, 'a'),
        assistant(4, 'final answer'),
        user(5, 'next'),
        assistant(6, 'second turn', 2),
      ],
      turnEnds: new Map([[1, 4], [2, 6]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // Branch renders only under assistant answers; user bubbles keep copy alone.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(4)
    const branchButtons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(branchButtons).toHaveLength(2)
    expect(branchButtons.map(button => button.getAttribute('aria-disabled'))).toEqual([null, null])
  })

  it('withholds assistant IconActions while the turn is still running', () => {
    const h = makeHarness({
      running: true,
      runningCalls: [runningCall('a')],
      nodes: [
        user(1, 'first'),
        assistant(2, 'previous answer', 1),
        user(4, 'second'),
        assistant(5, 'mid-turn text', 2),
      ],
      // Boundary seqs follow the log: a turn/end is strictly after its own nodes.
      turnEnds: new Map([[1, 3]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // 2 user + the settled turn-1 tail, which keeps its seat while a later
    // turn runs; turn 2's narration stays chrome-free while its tool runs, so
    // the footer never appears and then moves.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(3)
    expect(view.getByText('mid-turn text')).toBeTruthy()
    // turn/end lands: the same node becomes the settled answer and takes the seat.
    act(() => { h.set({ running: false, runningCalls: [], turnEnds: new Map([[1, 3], [2, 6]]) }) })
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(4)
  })

  it('the actions-owning assistant footer shows the turn run time', () => {
    const h = makeHarness({
      nodes: [
        user(1, 'hi'), // time 1_000
        assistant(2, 'mid-turn text'),
        assistant(16, 'final answer'),
        toolResult(18, 'trailing'),
      ],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 20_000 }]]),
      turnEnds: new Map([[1, 20]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // The exact turn/end includes trailing tool activity after the final text.
    expect(view.getAllByText(/用时 19秒/)).toHaveLength(1)
  })

  it('the settled footer appends first-step ttft and turn decode throughput', () => {
    const first: AssistantMessageNode = {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'mid' }],
      timing: { stepStartTime: 1_000, firstTokenTime: 2_200, completedTime: 5_200 },
      usage: { outputTokens: 40 },
    }
    const second: AssistantMessageNode = {
      kind: 'assistant', seq: 16, time: 16_000, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'final' }],
      timing: { stepStartTime: 10_000, firstTokenTime: 10_200, completedTime: 12_200 },
      usage: { outputTokens: 60 },
    }
    const h = makeHarness({
      nodes: [user(1, 'hi'), first, second],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 20_000 }]]),
      turnEnds: new Map([[1, 20]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // First-step ttft (1.2s) plus 100 tokens over 5s of decode.
    expect(view.getAllByText(/用时 19秒/)).toHaveLength(1)
    expect(view.getAllByText(/首 token 1\.2秒/)).toHaveLength(1)
    expect(view.getAllByText(/20 tok\/s/)).toHaveLength(1)
  })

  it('withholds ttft and throughput while the turn is still running', () => {
    const settled: AssistantMessageNode = {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'answer' }],
      timing: { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 },
      usage: { outputTokens: 10 },
    }
    const h = makeHarness({
      nodes: [user(1, 'hi'), settled],
      turnTimings: new Map([[1, { startTime: 1_000 }]]),
      turnEnds: new Map(),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/首 token|tok\/s/)).toBeNull()
  })

  it('user and assistant message containers scope the hover-revealed time chrome', () => {
    const h = makeHarness({
      nodes: [user(1, 'hi'), assistant(2, 'answer')],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 2_000 }]]),
      turnEnds: new Map([[1, 2]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // The user row and the settled assistant's Turn Tail each own one clock scope.
    expect(view.container.querySelectorAll('[data-time-hover-root]')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-message-actions]')).toHaveLength(2)
    for (const root of view.container.querySelectorAll('[data-time-hover-root]')) {
      expect(root.querySelector('[data-message-actions]')).not.toBeNull()
    }
  })

  it('keeps the second-turn process summary after its live details settle away', () => {
    vi.useFakeTimers()
    const h = makeHarness({
      nodes: [
        user(1, '第一轮'), assistant(2, '第一轮结果'),
        user(4, '第二轮'),
      ],
      partial: {
        turn: 2, step: 1,
        blocks: [{ kind: 'reasoning', text: '比较第二轮三个选项的影响' }],
      },
      turnEnds: new Map([[1, 3]]),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const runningSecond = view.container.querySelector(
      '[data-chat-process-turn="2"] [data-process-panel="running"]',
    ) as HTMLDetailsElement
    expect(runningSecond.open).toBe(true)
    act(() => { vi.advanceTimersByTime(850) })
    expectSafeProcessStage(runningSecond, ['比较第二轮三个选项的影响'])
    expect(view.container.querySelectorAll('[data-chat-process-turn]')).toHaveLength(1)

    act(() => {
      h.set({
        nodes: [
          user(1, '第一轮'), assistant(2, '第一轮结果'),
          user(4, '第二轮'), assistant(6, '第二轮结果', 2),
        ],
        partial: null,
        turnEnds: new Map([[1, 3], [2, 7]]),
        running: false,
      })
    })

    const settledSecond = view.container.querySelector(
      '[data-chat-process-turn="2"] [data-process-panel="done"]',
    ) as HTMLDetailsElement
    expect(settledSecond).toBe(runningSecond)
    expect(settledSecond.open).toBe(false)
    expect(view.container.querySelector('[data-chat-process-turn="1"]')).toBeNull()
    expect(view.getByText('第二轮结果')).toBeTruthy()
  })

  it('the run-time label is withheld when the turn start is outside the window', () => {
    const h = makeHarness({
      nodes: [assistant(16, 'tail without trigger')],
      turnEnds: new Map([[1, 16]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/用时/)).toBeNull()
  })

  it('enables fork only on the finalized assistant at the completed transcript tail', () => {
    const h = makeHarness({
      nodes: [user(1, 'question'), assistant(2, 'answer')],
      turnEnds: new Map([[1, 3]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    // The user bubble offers no branch; the settled answer's is live.
    const buttons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(buttons[0]!)
    expect(h.forkAt.mock.calls).toEqual([[2]])
  })

  it('disables fork when the indexed Turn has a later steering Node', () => {
    const base = chatSnapshotFixture({
      nodes: [user(1, 'question'), assistant(2, 'answer')],
      turnEnds: new Map([[1, 4]]),
    })
    const chat = {
      ...base,
      locations: {
        getTurn: (turn: number) => turn === 1
          ? [...base.locations.getTurn(turn), 'fixture:steering:later']
          : base.locations.getTurn(turn),
        getStep: (turn: number, step: number) => base.locations.getStep(turn, step),
      },
    }
    const h = makeHarness({ chat })
    const view = render(<h.ChatView {...h.props} />)
    const branch = view.getByRole('button', { name: '在新对话中分支' })
    expect(branch.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(branch)
    expect(h.forkAt).not.toHaveBeenCalled()
  })

  it('keeps final content actions but disables branch when Tool and interrupted Think follow it', () => {
    const interruptedThink: AssistantMessageNode = {
      kind: 'assistant', seq: 4.1, time: 4_100, turn: 1, step: 2,
      blocks: [{ kind: 'reasoning', text: 'bad path' }], interrupted: true,
    }
    const h = makeHarness({
      nodes: [user(1, 'question'), assistant(2, 'answer'), toolResult(3, 'a'), interruptedThink],
      turnEnds: new Map([[1, 5]]),
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(2)
    const buttons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(buttons[0]!)
    expect(h.forkAt).not.toHaveBeenCalled()
  })

  it('renders assistant Markdown across history, streaming, final, and interrupted states while user text stays literal', () => {
    const markdown = '# Rendered\n\n- **one**\n- `two`'
    const h = makeHarness({ nodes: [user(1, markdown), assistant(2, markdown)] })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.container.querySelectorAll('h1')).toHaveLength(1)
    const literal = view.getByText((_content, element) => (
      element?.tagName === 'DIV' && element.childElementCount === 0 && element.textContent === markdown
    ))
    expect(literal.querySelector('h1')).toBeNull()

    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: markdown }] } })
    })
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
    expect(view.container.querySelector('[data-streaming="true"] h1')?.textContent).toBe('Rendered')

    act(() => {
      h.set({
        nodes: [user(1, markdown), assistant(2, markdown), assistant(3, markdown)],
        partial: null,
      })
    })
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
    expect(view.container.querySelector('[data-streaming="true"]')).toBeNull()

    act(() => {
      h.set({
        nodes: [
          user(1, markdown),
          assistant(2, markdown),
          { ...assistant(3, markdown), interrupted: true },
        ],
      })
    })
    expect(view.getByText('已停止')).toBeTruthy()
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
  })

  it('streaming partial frames update the tail without replacing a sibling Tool row', () => {
    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(2, 'old answer'), toolResult(3, 'a')],
    })
    const view = render(<h.ChatView {...h.props} />)
    const tool = view.getByTestId('tool-seat-a')
    const beforeHtml = tool.innerHTML
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'streaming…' }] } })
    })
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'streaming… more' }] } })
    })
    expect(view.getByText('streaming… more')).toBeTruthy()
    expect(view.getByTestId('tool-seat-a')).toBe(tool)
    expect(tool.innerHTML).toBe(beforeHtml)
  })

  it('streaming leaves neighbor tool rows and history items at zero re-renders', () => {
    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(2, 'old'), toolResult(3, 'a')],
    })
    // Count renderSlot invocations: the memo boundary holds when CallRow does
    // not re-render, so the row's renderSlot call count freezes during chunks.
    let rowRenders = 0
    h.props.renderSlot = ((key: string, owner: object) => {
      if (key !== 'conversation.chat.node'
        || (owner as RoutedChatNodeOwner).node.kind !== 'tool-call') return null
      rowRenders += 1
      return <div data-testid="counting-row" />
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('counting-row')).toBeTruthy()
    const afterMount = rowRenders
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'chunk1' }] } })
    })
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'chunk1 chunk2' }] } })
    })
    expect(rowRenders).toBe(afterMount)
  })

  it('updates the selected call id handed to the Tool seat', () => {
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    render(<h.ChatView {...h.props} />)
    expect(h.toolOwners.at(-1)?.selectedCallId).toBeUndefined()
    act(() => { h.setSelection({ turnSeq: 3, callId: 'a', toolName: 'bash' }) })
    expect(h.toolOwners.at(-1)?.selectedCallId).toBe('a')
  })

  it('hands running calls to a live Tool group', () => {
    const h = makeHarness({ runningCalls: [runningCall('r1')], running: true })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('tool-seat-r1')).toBeTruthy()
    expect(h.toolOwners[0]?.block).toMatchObject({ callId: 'r1', argsRaw: '{"command":"cmd-r1"}' })
    expect(view.getByRole('status').textContent).toBe('Deep diving...·1 步')
  })

  it('keeps the Tool renderer mounted when a running call settles into log order', () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    function StatefulToolNode({ node }: { readonly node: ChatNode<'tool-call'> }) {
      useEffect(() => {
        mounted()
        return () => { unmounted() }
      }, [])
      const root = node.data.root
      return (
        <div data-testid="stateful-tool" data-state={'kind' in root ? 'settled' : 'running'}>
          {root.callId}
        </div>
      )
    }

    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(4, 'later')],
      runningCalls: [runningCall('r1')],
      running: true,
    })
    h.props.renderSlot = ((key: string, owner: object, opts?: { fallback?: React.ReactNode }) => {
      const routed = owner as RoutedChatNodeOwner
      return key === 'conversation.chat.node' && routed.node.kind === 'tool-call'
        ? <StatefulToolNode node={routed.node} />
        : opts?.fallback ?? null
    }) as ChatViewSlotProps['renderSlot']
    const view = render(<h.ChatView {...h.props} />)
    const tool = view.getByTestId('stateful-tool')
    const row = view.container.querySelector('[data-chat-flow-key="fixture:tool:r1"]')
    expect(tool.dataset.state).toBe('running')
    expect(mounted).toHaveBeenCalledTimes(1)

    act(() => {
      h.set({
        nodes: [user(1, 'q'), toolResult(3, 'r1'), assistant(4, 'later')],
        runningCalls: [],
        running: false,
      })
    })

    expect(view.getByTestId('stateful-tool')).toBe(tool)
    expect(view.container.querySelector('[data-chat-flow-key="fixture:tool:r1"]')).toBe(row)
    expect(tool.dataset.state).toBe('settled')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('the running clock uses turn/start, ignores steering, and stays out of the live region', () => {
    const startTime = Date.now() - 125_000
    const trigger: UserMessageNode = { ...user(1, 'go'), time: startTime + 1 }
    const h = makeHarness({
      nodes: [trigger], turnTimings: new Map([[1, { startTime }]]), running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    // Freshly mounted (as after a reload) yet already past the 15s gate.
    const status = view.getByRole('status')
    expect(status.textContent).toMatch(/^Deep diving\.\.\.·1 步·2分0\d秒$/)
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull()
    act(() => {
      h.set({ queue: [{
        id: 'steering-occurrence' as never,
        messageId: 'steering-message' as never,
        placement: 'steering',
        content: [{ type: 'text', text: 'also' }],
        preview: 'also',
        text: 'also',
      }] })
    })
    expect(status.textContent).toMatch(/^Deep diving\.\.\.·1 步·2分0\d秒$/)
  })

  it('uses a non-empty safe stage instead of a sentence copied from a longer user request', () => {
    vi.useFakeTimers()
    const request = [
      'Begin with a short explanation.',
      'Then after the tool result, reply with the single word DONE and stop.',
    ].join(' ')
    const h = makeHarness({
      nodes: [
        user(1, request),
        {
          ...assistant(2, ''),
          blocks: [{
            kind: 'reasoning',
            text: 'I should follow the requested sequence. Then after the tool result, reply with the single word DONE and stop.',
          }],
        },
      ],
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    act(() => { vi.advanceTimersByTime(850) })
    expectSafeProcessStage(view.container, [request, 'Then after the tool result'])
  })

  it('keeps a reasoning-only long task on a non-empty safe stage while raw progress stays in details', () => {
    vi.useFakeTimers()
    const query = '设计一个页面'
    const rawReasoning = 'Think: query="设计一个页面" Length: 1200 words Tone: concise; run pnpm --filter web test at /tmp/deepseek-harness'
    const h = makeHarness({
      nodes: [user(1, query)],
      partial: {
        turn: 1,
        step: 1,
        blocks: [{ kind: 'reasoning', text: rawReasoning }],
      },
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const panel = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    act(() => { vi.advanceTimersByTime(850) })
    expectSafeProcessStage(panel, [
      'Think', query, 'Length', 'Tone', 'pnpm', '/tmp/deepseek-harness', rawReasoning,
    ])
    const details = panel.querySelector('[data-process-live-disclosure]') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain(rawReasoning)
  })

  it('matches the safe fallback language to the user instead of the browser locale', () => {
    const h = makeHarness({
      nodes: [user(1, 'Build a small HTML story page')],
      partial: {
        turn: 1,
        step: 1,
        blocks: [{ kind: 'reasoning', text: 'Think: choose a narrative structure.' }],
      },
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(requiredProcessStage(view.container).textContent)
      .toBe('Shaping the story page and its interactions')
    expect(view.queryByText('构思故事网页的视觉与交互')).toBeNull()
  })

  it.each([
    ['null', async () => null],
    ['unavailable', async () => ({ kind: 'unavailable' as const, reason: 'generation-failed' as const })],
  ])('keeps the safe non-empty stage when the presentation sidecar returns %s', async (_label, refine) => {
    vi.useFakeTimers()
    const h = makeHarness({
      nodes: [user(1, '规划一个长任务')],
      partial: {
        turn: 1, step: 1,
        blocks: [{ kind: 'reasoning', text: 'Think: query=规划一个长任务; Length: long; Tone: direct' }],
      },
      running: true,
    })
    h.props.refineProcessStage = vi.fn(refine)
    const view = render(<h.ChatView {...h.props} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(850) })
    const safeStage = expectSafeProcessStage(view.container, ['Think', 'Length', 'Tone'])
    const safeTitle = safeStage.textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })

    expect(h.props.refineProcessStage).toHaveBeenCalledTimes(1)
    expect(requiredProcessStage(view.container)).toBe(safeStage)
    expect(safeStage.textContent).toBe(safeTitle)
  })

  it('retries the presentation sidecar when Tool activity arrives after a budget response', async () => {
    vi.useFakeTimers()
    const refine = vi.fn()
      .mockResolvedValueOnce({ kind: 'unavailable', reason: 'call-budget-reached' })
      .mockResolvedValueOnce({
        kind: 'stage', cursor: 12, action: 'append', title: '校验网页的交互结构',
      })
    const h = makeHarness({
      nodes: [user(1, '做一个有动效的故事网页')],
      partial: {
        turn: 1, step: 1,
        blocks: [{ kind: 'reasoning', text: 'Comparing narrative structures.' }],
      },
      running: true,
    })
    h.props.refineProcessStage = refine
    const view = render(<h.ChatView {...h.props} />)

    await act(async () => {
      vi.advanceTimersByTime(1_201)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(refine).toHaveBeenNthCalledWith(1, {
      turn: 1, afterSeq: -1, acceptedStages: [],
    })

    act(() => {
      h.set({
        runningCalls: [{
          ...runningCall('inspect-page'),
          turn: 1,
          argsRaw: JSON.stringify({
            command: 'inspect', description: 'Check the page interaction structure',
          }),
        }],
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(1_201)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(refine).toHaveBeenNthCalledWith(2, {
      turn: 1, afterSeq: -1, acceptedStages: [],
    })
    await expect(refine.mock.results[1]?.value).resolves.toMatchObject({
      kind: 'stage', title: '校验网页的交互结构',
    })
    // The sidecar result lands immediately; the mounted semantic trail applies
    // its in-place replacement in the following layout pass.
    await act(async () => {
      await refine.mock.results[1]?.value
      await Promise.resolve()
    })
    // Debugging this regression needs the exact semantic rail, not the raw
    // technical detail rows which intentionally retain the Tool description.
    const stageTitles = [...view.container.querySelectorAll<HTMLElement>('[data-process-stage-title]')]
      .map(stage => stage.textContent)
    expect(stageTitles).toEqual(['校验网页的交互结构'])
    expect(within(view.container).queryByText('Check the page interaction structure')).toBeNull()
  })

  it('keeps the same safe stage before and after a timed-out presentation sidecar returns null', async () => {
    vi.useFakeTimers()
    const h = makeHarness({
      nodes: [user(1, '检查长时间运行任务')],
      partial: {
        turn: 1, step: 1,
        blocks: [{ kind: 'reasoning', text: 'Think: inspect /workspace/app then run pnpm test' }],
      },
      running: true,
    })
    h.props.refineProcessStage = vi.fn(() => new Promise<null>((resolve) => {
      window.setTimeout(() => { resolve(null) }, 30_000)
    }))
    const view = render(<h.ChatView {...h.props} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(850) })
    const safeStage = expectSafeProcessStage(view.container, ['Think', '/workspace/app', 'pnpm test'])
    const safeTitle = safeStage.textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(30_350) })

    expect(h.props.refineProcessStage).toHaveBeenCalledTimes(1)
    expect(requiredProcessStage(view.container)).toBe(safeStage)
    expect(safeStage.textContent).toBe(safeTitle)
  })

  it('keeps dynamic activity across snapshots when an older title appears again', () => {
    const view = render(
      <ProcessPanel
        state="running"
        count={1}
        lines={[{ key: 'a', text: '理清用户真正关心的限制', state: 'active', priority: 2 }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )

    view.rerender(
      <ProcessPanel
        state="running"
        count={2}
        lines={[{ key: 'a', text: '比较两种可行的实现方案', state: 'active', priority: 2 }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    view.rerender(
      <ProcessPanel
        state="running"
        count={3}
        lines={[{ key: 'a', text: '搭建交互主流程', state: 'active', priority: 3 }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    view.rerender(
      <ProcessPanel
        state="running"
        count={4}
        lines={[{ key: 'a', text: '理清用户真正关心的限制', state: 'active', priority: 2 }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )

    expect(view.container.querySelector('[data-process-stage-title]')?.textContent)
      .toBe('搭建交互主流程')
    expect(view.getAllByText('理清用户真正关心的限制')).toHaveLength(1)
    expect(view.queryByText('明确目标')).toBeNull()
    expect(view.queryByText('确认路径')).toBeNull()
    expect(view.queryByText('设计与实现')).toBeNull()
  })

  it('keeps a running technical-log wheel gesture inside the bounded detail scrollport', () => {
    const view = render(
      <ProcessPanel state="running" count={2} t={makeTranslate(zh, commonZh)}>
        <div>first diagnostic row</div>
        <div>second diagnostic row</div>
      </ProcessPanel>,
    )
    const details = view.container.querySelector('[data-process-live-disclosure] > div') as HTMLDivElement
    Object.defineProperty(details, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(details, 'scrollHeight', { value: 800, configurable: true })
    Object.defineProperty(details, 'scrollTop', { value: 120, writable: true, configurable: true })

    expect(fireEvent.wheel(details, { deltaY: 320 })).toBe(false)
    expect(details.scrollTop).toBe(440)
    expect(fireEvent.wheel(details, { deltaY: 600 })).toBe(false)
    expect(details.scrollTop).toBe(600)
    expect(fireEvent.wheel(details, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE })).toBe(false)
    expect(details.scrollTop).toBe(400)
  })

  it('promotes a refined stage in place over the safe fallback without duplicate or backward rows', () => {
    const safeFallback = '形成任务的可执行方案'
    const view = render(
      <ProcessPanel
        state="running"
        count={1}
        trailSource="local"
        lines={[{ key: 'local:safe', text: safeFallback, state: 'active', priority: 0 }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    const panel = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    const stageSeat = requiredProcessStage(panel)

    view.rerender(
      <ProcessPanel
        state="running"
        count={2}
        trailSource="refined"
        lines={[{
          key: 'refined-stage:0', text: '梳理导航层级', state: 'active', priority: 3, replaceCurrent: true,
        }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    expect(requiredProcessStage(panel)).toBe(stageSeat)
    expect(view.queryByText(safeFallback)).toBeNull()
    expect(view.getAllByText('梳理导航层级')).toHaveLength(1)

    view.rerender(
      <ProcessPanel
        state="running"
        count={3}
        trailSource="refined"
        lines={[{
          key: 'refined-stage:0', text: '确定导航信息层级', state: 'active', priority: 3, replaceCurrent: true,
        }]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    expect(requiredProcessStage(panel)).toBe(stageSeat)
    expect(view.queryByText('梳理导航层级')).toBeNull()
    expect(view.getAllByText('确定导航信息层级')).toHaveLength(1)

    view.rerender(
      <ProcessPanel
        state="running"
        count={4}
        trailSource="refined"
        lines={[
          {
            key: 'refined-stage:0', text: '确定导航信息层级', state: 'done', priority: 3, replaceCurrent: true,
          },
          {
            key: 'refined-stage:1', text: '实现并校验交互', state: 'active', priority: 3, replaceCurrent: true,
          },
        ]}
        t={makeTranslate(zh, commonZh)}
      >
        {null}
      </ProcessPanel>,
    )
    expect(view.getAllByText('确定导航信息层级')).toHaveLength(1)
    expect(view.getAllByText('实现并校验交互')).toHaveLength(1)
  })

  it('promotes sidecar stages in place and starts the second turn with independent refinement state', async () => {
    vi.useFakeTimers()
    const refine = vi.fn()
      .mockResolvedValueOnce({ kind: 'stage', cursor: 2, action: 'replace-current', title: '梳理第一轮范围' })
      .mockResolvedValueOnce({ kind: 'stage', cursor: 5, action: 'replace-current', title: '比较第二轮方案' })
    const h = makeHarness({
      nodes: [user(1, '第一轮任务')],
      partial: {
        turn: 1, step: 1,
        blocks: [{ kind: 'reasoning', text: 'Think: query=第一轮任务; Length: long' }],
      },
      running: true,
    })
    h.props.refineProcessStage = refine
    const view = render(<h.ChatView {...h.props} />)
    const firstPanel = view.container.querySelector(
      '[data-chat-process-turn="1"] [data-process-panel="running"]',
    ) as HTMLDetailsElement
    await act(async () => { await vi.advanceTimersByTimeAsync(850) })
    const firstSeat = requiredProcessStage(firstPanel)
    expectSafeProcessStage(firstPanel, ['Think', '第一轮任务', 'Length'])

    await act(async () => { await vi.advanceTimersByTimeAsync(350) })

    expect(requiredProcessStage(firstPanel)).toBe(firstSeat)
    expect(firstSeat.textContent).toBe('梳理第一轮范围')
    expect(refine).toHaveBeenNthCalledWith(1, {
      turn: 1, afterSeq: -1, acceptedStages: [],
    })

    act(() => {
      h.set({
        nodes: [
          user(1, '第一轮任务'), assistant(2, '第一轮结果'),
          user(4, '第二轮任务'),
        ],
        partial: {
          turn: 2, step: 1,
          blocks: [{ kind: 'reasoning', text: 'Think: query=第二轮任务; Tone: concise' }],
        },
        turnEnds: new Map([[1, 3]]),
        running: true,
      })
    })

    const settledFirst = view.container.querySelector(
      '[data-chat-process-turn="1"] [data-process-panel="done"]',
    ) as HTMLDetailsElement
    const secondPanel = view.container.querySelector(
      '[data-chat-process-turn="2"] [data-process-panel="running"]',
    ) as HTMLDetailsElement
    expect(settledFirst.open).toBe(false)
    expect(secondPanel.open).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(850) })
    expectSafeProcessStage(secondPanel, ['Think', '第二轮任务', 'Tone'])

    await act(async () => { await vi.advanceTimersByTimeAsync(350) })

    expect(requiredProcessStage(secondPanel).textContent).toBe('比较第二轮方案')
    expect(refine).toHaveBeenNthCalledWith(2, {
      turn: 2, afterSeq: -1, acceptedStages: [],
    })
    expect(within(secondPanel).queryByText('梳理第一轮范围')).toBeNull()
  })

  it('keeps a streaming answer out of the stage rail and rejects answer constraints as stages', () => {
    vi.useFakeTimers()
    const story = '会修月亮的人'
    const h = makeHarness({
      nodes: [user(1, '写一个短故事')],
      partial: {
        turn: 1, step: 1,
        blocks: [
          { kind: 'reasoning', text: 'Length: a reasonably concise short story (500-1000 words)' },
          { kind: 'text', text: story },
        ],
      },
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const panel = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    const result = panel.querySelector('[data-process-result]') as HTMLElement

    expect(result.dataset.processResultKind).toBe('candidate')
    expect(within(result).getByText(story)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(850) })
    expectSafeProcessStage(panel, ['Length', '500-1000 words', story])
    expect(panel.querySelector('ol')).toBeNull()
    expect((panel.querySelector('[data-process-live-disclosure]') as HTMLDetailsElement).open).toBe(false)
    expect(view.queryByText('阶段结果')).toBeNull()
  })

  it('promotes a pre-interaction explanation in place only when later activity appears', () => {
    const explanation = '你的选择会改变后续建议，所以先确认你偏好的方向。'
    const h = makeHarness({
      nodes: [user(1, '帮我选一个方向')],
      partial: {
        turn: 1, step: 1,
        blocks: [
          { kind: 'reasoning', text: '比较选项对后续推荐的影响' },
          { kind: 'text', text: explanation },
        ],
      },
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const candidate = view.container.querySelector('[data-process-result]') as HTMLElement
    expect(candidate.dataset.processResultKind).toBe('candidate')
    expect(view.queryByText('阶段结果')).toBeNull()

    act(() => {
      h.set({
        partial: {
          turn: 1, step: 1,
          blocks: [
            { kind: 'reasoning', text: '比较选项对后续推荐的影响' },
            { kind: 'text', text: explanation },
            { kind: 'tool-call', callId: 'question', name: 'ask_user_question', argsRaw: '{}' },
          ],
        },
      })
    })

    const promoted = view.container.querySelector('[data-process-result]') as HTMLElement
    expect(promoted).toBe(candidate)
    expect(promoted.dataset.processResultKind).toBe('intermediate')
    expect(within(promoted).getByText('阶段结果')).toBeTruthy()
    expect(view.getAllByText(explanation)).toHaveLength(1)
  })

  it('keeps a pre-tool explanation visible when a later answer fragment starts streaming', () => {
    const explanation = '先说明选择依据，再请你确认偏好。'
    const h = makeHarness({
      nodes: [
        user(1, '帮我选一个方向'),
        { ...assistant(2, explanation), blocks: [
          { kind: 'text', text: explanation },
          { kind: 'tool-call', callId: 'question', name: 'ask_user_question', argsRaw: '{}' },
        ] },
        toolResult(3, 'question', 'ask_user_question'),
      ],
      partial: {
        turn: 1,
        step: 2,
        blocks: [{ kind: 'text', text: '好' }],
      },
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const result = view.container.querySelector('[data-process-result]') as HTMLElement
    expect(result.dataset.processResultKind).toBe('intermediate')
    expect(within(result).getByText(explanation)).toBeTruthy()
    expect(within(result).queryByText('好')).toBeNull()
    expect(view.getAllByText(explanation)).toHaveLength(1)
  })

  it('keeps a pre-question explanation in one stable process result, then collapses it only after turn/end', () => {
    const explanation = '你的选择会改变后续建议，所以先确认你偏好的方向。'
    const startTime = Date.now() - 20_000
    const h = makeHarness({
      nodes: [
        user(1, '帮我选一个方向'),
        { ...assistant(2, explanation), blocks: [
          { kind: 'reasoning', text: '比较选项对后续推荐的影响' },
          { kind: 'text', text: explanation },
        ] },
        toolResult(3, 'question', 'ask_user_question'),
      ],
      turnTimings: new Map([[1, { startTime }]]),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const runningPanel = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    expect(runningPanel.open).toBe(true)
    expect(view.getAllByText(explanation)).toHaveLength(1)
    expect(within(runningPanel.querySelector('[data-process-result]') as HTMLElement).getByText(explanation)).toBeTruthy()

    act(() => {
      h.set({
        nodes: [
          user(1, '帮我选一个方向'),
          { ...assistant(2, explanation), blocks: [
            { kind: 'reasoning', text: '比较选项对后续推荐的影响' },
            { kind: 'text', text: explanation },
          ] },
          toolResult(3, 'question', 'ask_user_question'),
          assistant(4, '根据你的选择，建议采用蓝色方案。'),
        ],
        turnTimings: new Map([[1, { startTime, endTime: Date.now() }]]),
        turnEnds: new Map([[1, 5]]),
        running: false,
      })
    })

    const settledPanel = view.container.querySelector('[data-process-panel="done"]') as HTMLDetailsElement
    expect(settledPanel).toBe(runningPanel)
    expect(settledPanel.open).toBe(false)
    expect(view.getByText('根据你的选择，建议采用蓝色方案。')).toBeTruthy()
    expect(view.getByText(explanation).closest('[data-process-panel]')).toBe(settledPanel)
    expect(view.getByText(explanation).getClientRects()).toHaveLength(0)
    fireEvent.click(settledPanel.querySelector('[data-process-disclosure]') as HTMLElement)
    expect(view.getByText(explanation)).toBeTruthy()
  })

  it('settles and folds on authoritative idle before a delayed turn/end, while keeping the answer visible', () => {
    const h = makeHarness({
      nodes: [user(1, 'inspect this'), assistant(2, 'The inspection is complete.')],
      turnTimings: new Map([[1, { startTime: 1_000 }]]),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    const process = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    expect(process.open).toBe(true)

    // The running bit and composer settle first; the event lane still exposes
    // an open Turn. That stale boundary must not own the visible activity.
    act(() => { h.set({ running: false }) })
    const idleProcess = view.container.querySelector('[data-process-panel="done"]') as HTMLDetailsElement
    expect(idleProcess).toBe(process)
    expect(idleProcess.open).toBe(false)
    expect(within(idleProcess).queryByText('Deep diving...')).toBeNull()
    expect(view.getByText('The inspection is complete.').closest('[data-process-panel]')).toBeNull()

    // A later durable boundary repairs timing/turn authority without reopening
    // or replacing the stable Process parent.
    act(() => {
      h.set({
        turnTimings: new Map([[1, { startTime: 1_000, endTime: 4_000 }]]),
        turnEnds: new Map([[1, 4]]),
      })
    })
    const repairedProcess = view.container.querySelector('[data-process-panel="done"]') as HTMLDetailsElement
    expect(repairedProcess).toBe(process)
    expect(repairedProcess.open).toBe(false)
    expect(view.getByText('The inspection is complete.').closest('[data-process-panel]')).toBeNull()
  })

  it('keeps an open turn active while idle is waiting on a user interaction', () => {
    const h = makeHarness({
      nodes: [user(1, 'choose'), assistant(2, 'Please choose a path.')],
      turnTimings: new Map([[1, { startTime: 1_000 }]]),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)
    act(() => {
      h.set({
        running: false,
        pending: [new PendingWait(
          'question', RpcId('waiting-question'), SID,
          { questions: [{ id: 'path', question: 'Which path?' }] }, vi.fn(),
        )],
      })
    })
    const process = view.container.querySelector('[data-process-panel="running"]') as HTMLDetailsElement
    expect(process.open).toBe(true)
    expect(within(process).getByText('Deep diving...')).toBeTruthy()
  })

  it('folds a recovered Tool failure after a later final answer', () => {
    const failedTool = { ...toolResult(3, 'recoverable'), isError: true, turn: 2 } as ToolResultNode
    const h = makeHarness({
      nodes: [user(1, 'finish despite one failed read'), assistant(2, 'Checking alternatives.', 2)],
      runningCalls: [runningCall('recoverable')],
      turnTimings: new Map([[2, { startTime: 1_000 }]]),
      running: true,
    })
    const view = render(<h.ChatView {...h.props} />)

    act(() => {
      h.set({
        nodes: [
          user(1, 'finish despite one failed read'),
          assistant(2, 'Checking alternatives.', 2),
          failedTool,
          assistant(4, 'Recovered and completed successfully.', 2),
        ],
        runningCalls: [],
        turnTimings: new Map([[2, { startTime: 1_000, endTime: 5_000 }]]),
        turnEnds: new Map([[2, 5]]),
        running: false,
      })
    })

    const settled = view.container.querySelector('[data-process-panel="done"]') as HTMLDetailsElement
    expect(settled.open).toBe(false)
    expect(view.container.querySelector('[data-process-panel="warning"]')).toBeNull()
    expect(view.getByText('Recovered and completed successfully.').closest('[data-process-panel]')).toBeNull()
    expect(view.getByTestId('tool-seat-recoverable').closest('[data-process-panel]')).toBe(settled)
    fireEvent.click(settled.querySelector('[data-process-disclosure]') as HTMLElement)
    expect(view.getByTestId('tool-seat-recoverable')).toBeTruthy()
  })

  it('keeps an unrecovered Tool failure expanded when no final answer follows', () => {
    const failedTool = { ...toolResult(3, 'terminal'), isError: true, turn: 1 } as ToolResultNode
    const h = makeHarness({
      nodes: [user(1, 'read this image'), failedTool],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 4_000 }]]),
      turnEnds: new Map([[1, 4]]),
      running: false,
    })
    const view = render(<h.ChatView {...h.props} />)
    const warning = view.container.querySelector('[data-process-panel="warning"]') as HTMLDetailsElement
    expect(warning.open).toBe(true)
    expect(view.getByTestId('tool-seat-terminal').closest('[data-process-panel]')).toBe(warning)
  })

  it('keeps a failed turn expanded so its actionable error is immediately visible', () => {
    const h = makeHarness({
      nodes: [user(1, 'run this'), turnError(2, 'AUTH: API key is invalid')],
      turnEnds: new Map([[1, 3]]),
      running: false,
    })
    const view = render(<h.ChatView {...h.props} />)
    const warning = view.container.querySelector('[data-process-panel="warning"]') as HTMLDetailsElement
    expect(warning.open).toBe(true)
    expect(view.getAllByText(/API key is invalid/).length).toBeGreaterThanOrEqual(1)
  })

  it('hands each ordered root call to the keyed business-node slot', () => {
    const block = toolResult(3, 'a')
    const h = makeHarness({ nodes: [block] })
    const calls: { key: string; owner: object; entryKey?: string }[] = []
    h.props.renderSlot = ((key: string, owner: object, opts?: { entryKey?: string; fallback?: React.ReactNode }) => {
      calls.push({ key, owner, ...(opts?.entryKey !== undefined ? { entryKey: opts.entryKey } : {}) })
      return opts?.fallback ?? null
    })
    render(<h.ChatView {...h.props} />)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      key: 'conversation.chat.node',
      owner: { node: { kind: 'tool-call' }, selectedCallId: undefined },
      entryKey: 'tool-call',
    })
    const owner = calls[0]?.owner as RoutedChatNodeOwner
    expect((owner.node.data as { readonly root: ToolCallBlock }).root).toBe(block)
    expect(owner.openFile).toBe(h.openFile)
    expect(owner.inspectCall).toBe(h.inspectCall)
  })

  it('prepend preserves a semantic row; a trailing user node force-scrolls', () => {
    const h = makeHarness({ nodes: [user(5, 'later'), assistant(6, 'a')], hasMore: true })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    // jsdom has no layout: fake the metrics the anchor math reads.
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 400, writable: true })
    const anchored = view.container.querySelector('[data-chat-flow-key="fixture:user:5"]') as HTMLDivElement
    let anchoredTop = 100
    vi.spyOn(anchored, 'getBoundingClientRect').mockImplementation(
      () => ({ top: anchoredTop, bottom: anchoredTop + 40 } as DOMRect),
    )
    readerScroll(scroller, 80)
    // Arm the paging anchor, then deliver an older page (head seq decreases).
    fireEvent.click(view.getByText('加载更早'))
    Object.defineProperty(scroller, 'scrollHeight', { value: 1600, writable: true })
    anchoredTop = 700
    act(() => { h.set({ nodes: [user(1, 'old'), assistant(2, 'b'), user(5, 'later'), assistant(6, 'a')] }) })
    expect(scroller.scrollTop).toBe(680) // reader offset 80 + the anchored row's 600px shift
    // A new trailing user bubble (own words) force-scrolls to the bottom.
    act(() => { h.set({ nodes: [user(1, 'old'), assistant(2, 'b'), user(5, 'later'), assistant(6, 'a'), user(9, 'mine')] }) })
    expect(scroller.scrollTop).toBe(1600)
  })

  it('back-to-bottom cancels an in-flight paging anchor', () => {
    const h = makeHarness({ nodes: [user(9, 'late')], hasMore: true })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 800, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, writable: true })
    readerScroll(scroller, 50)
    fireEvent.click(view.getByText('加载更早'))
    fireEvent.click(view.getByLabelText('回到底部'))
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_300, writable: true })
    act(() => { h.set({ nodes: [assistant(2, 'older'), user(9, 'late')] }) })
    expect(scroller.scrollTop).toBe(1_300)
    expect(h.chatScroll.read()).toBeNull()
  })

  it('scrolling away disables follow and shows the back-to-bottom button; clicking returns', () => {
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    readerScroll(scroller, 100) // far from bottom
    const backButton = view.getByLabelText('回到底部')
    expect(backButton).toBeTruthy()
    // Streaming growth must NOT drag a scrolled-away reader down.
    act(() => { h.set({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'grow' }] } }) })
    expect(scroller.scrollTop).toBe(100)
    fireEvent.click(backButton)
    expect(scroller.scrollTop).toBe(1000)
    // At the bottom again: follow re-arms and the button unmounts.
    expect(view.queryByLabelText('回到底部')).toBeNull()
  })

  it('keeps following when a stream-finalization shrink clamp delivers its scroll', () => {
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    const metrics = installScrollMetrics(scroller, 1_000, 300)
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)

    // Stream finalization shrinks the column: the browser clamps the pinned
    // position onto the new floor and delivers a scroll event. The clamp
    // lands exactly on the ledger's floor min, so it is not reader input.
    metrics.setLayout(800, 700)
    fireEvent.scroll(scroller)
    expect(scroller.scrollTop).toBe(500)
    expect(view.queryByLabelText('回到底部')).toBeNull()
    expect(h.chatScroll.read()).toBeNull()

    metrics.setHeight(1_200)
    act(() => { h.set({ running: true }) })
    expect(scroller.scrollTop).toBe(900)
  })

  it('uses the last delivered top when compositor scrolling precedes scroll delivery', () => {
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    installScrollMetrics(scroller, 1_000, 300)
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)

    // Chromium advances compositor geometry before delivering the event:
    // attribution must compare against the observed-top ledger, never a
    // baseline sampled from already-moved raw geometry.
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    expect(view.getByLabelText('回到底部')).toBeTruthy()
  })

  it('one ResizeObserver owns pinned dynamic-height follow and ignores growth while away', () => {
    let notify: (() => void) | undefined
    const observe = vi.fn()
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        notify = () => { callback([], this as unknown as ResizeObserver) }
      }

      observe = observe
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_200, writable: true })
    act(() => { notify?.() })
    expect(scroller.scrollTop).toBe(1_200)
    readerScroll(scroller, 200)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_400, writable: true })
    act(() => { notify?.() })
    expect(scroller.scrollTop).toBe(200)
    expect(observe).toHaveBeenCalledTimes(1)
  })

  it('entering the at-bottom threshold does not snap the remaining scroll distance', () => {
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    const view = render(<h.ChatView {...h.props} />)
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    // Inside FOLLOW_THRESHOLD (24) but not flush with the floor — the chrome
    // re-render from setAtBottom must not force scrollTop to scrollHeight.
    readerScroll(scroller, 690) // distance-to-bottom = 10
    expect(view.queryByLabelText('回到底部')).toBeNull()
    expect(scroller.scrollTop).toBe(690)
  })

  it('under data-conversation-scroll, bottom-follow targets the host scrollport', () => {
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    try {
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      const view = render(<h.ChatView {...h.props} />, { container: host })
      // Open jump uses the host, not the local .scroll node.
      expect(host.scrollTop).toBe(2000)
      readerScroll(host, 100)
      expect(view.getByLabelText('回到底部')).toBeTruthy()
      fireEvent.click(view.getByLabelText('回到底部'))
      expect(host.scrollTop).toBe(2000)
    } finally {
      host.remove()
    }
  })

  it('a remount restores the saved semantic row after width reflow', () => {
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    let anchorTop = 80
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, bottom: 500 } as DOMRect),
    )
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.chatAnchorKey === 'fixture:user:1') {
        return { top: anchorTop, bottom: anchorTop + 40 } as DOMRect
      }
      return { top: 0, bottom: 40 } as DOMRect
    })
    try {
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      // Fresh open (nothing saved): the bottom jump stands.
      const view = render(<h.ChatView {...h.props} />, { container: host })
      expect(host.scrollTop).toBe(2000)
      // Reader scrolls up; the position is recorded continuously.
      readerScroll(host, 100)
      // View-tab switch away and back: the view unmounts, then remounts.
      view.rerender(<div />)
      anchorTop = 560
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(580) // approximate 100 + the row's 480px reflow shift
      // The restored position is above the floor: follow stays disarmed.
      expect(view.getByLabelText('回到底部')).toBeTruthy()
    } finally {
      rect.mockRestore()
      host.remove()
    }
  })

  it('normalizes a semantic restore clamped to the bottom before an immediate remount', () => {
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2_000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    let scrollTop = 0
    Object.defineProperty(host, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = Math.min(value, 1_500) },
    })
    document.body.appendChild(host)
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.chatAnchorKey === 'fixture:user:1') return { top: 300, bottom: 340 } as DOMRect
      return { top: 0, bottom: 500 } as DOMRect
    })
    try {
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      h.chatScroll.save({ anchorKey: 'fixture:user:1', anchorTop: 80, scrollTop: 1_400 })
      const view = render(<h.ChatView {...h.props} />, { container: host })
      expect(host.scrollTop).toBe(1_500)
      expect(h.chatScroll.read()).toBeNull()
      view.rerender(<div />)
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(1_500)
    } finally {
      rect.mockRestore()
      host.remove()
    }
  })

  it('a remount while pinned to the bottom keeps the bottom jump', () => {
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    try {
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      const view = render(<h.ChatView {...h.props} />, { container: host })
      // At the bottom: the scroll event records the pinned state (null).
      fireEvent.scroll(host)
      expect(h.chatScroll.read()).toBeNull()
      view.rerender(<div />)
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(2000)
    } finally {
      host.remove()
    }
  })

  it('paging button loads older and shows its busy label', () => {
    const h = makeHarness({ nodes: [user(5, 'later')], hasMore: true })
    const view = render(<h.ChatView {...h.props} />)
    fireEvent.click(view.getByText('加载更早'))
    expect(h.loadOlder).toHaveBeenCalledTimes(1)
    act(() => { h.set({ loadingOlder: true }) })
    expect(view.getByText('加载中…')).toBeTruthy()
  })

  it('shows open error and loading states', () => {
    const h = makeHarness({
      openState: 'error',
      openError: { code: 'internal', message: 'boom' } as never,
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText(/历史加载失败：boom/)).toBeTruthy()
    const loading = makeHarness({ openState: 'loading' })
    const lv = render(<loading.ChatView {...loading.props} />)
    expect(lv.getByText('载入历史…')).toBeTruthy()
  })

  it('pending waits leave the flow entirely — questions and approvals both take over the composer', () => {
    const h = makeHarness({
      pending: [
        new PendingWait('approval', RpcId('r1'), SID,
          { approvalId: 'ap1', toolName: 'bash' } as PendingWait<'approval'>['payload'], vi.fn()),
        new PendingWait('question', RpcId('r2'), SID,
          { questions: [{ id: 'q1', question: '选择' }] }, vi.fn()),
      ],
    })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/等待回答/)).toBeNull()
    expect(view.queryByText(/等待审批/)).toBeNull()
  })

  it('renders command nodes as durable rows: settled text, error state, executing spinner, run-less soft-fall', () => {
    // Settled success: the bare command name is the title, the outcome text
    // the summary — neither the dispatched `/` nor its arguments reach the row
    // (the settlement text already says what the command did).
    const settled = makeHarness({ nodes: [user(1, 'hi'), command({ args: ' now' })] })
    const view = render(<settled.ChatView {...settled.props} />)
    expect(view.getByText('plan')).toBeTruthy()
    expect(view.queryByText('/plan')).toBeNull()
    expect(view.queryByText('/plan now')).toBeNull()
    expect(view.getByText('已进入 plan mode')).toBeTruthy()

    // Error outcome flips the row state; a text-less error gets the default copy.
    const failed = makeHarness({
      nodes: [command({ seq: 6, commandId: 'cmd-2' as CommandNode['commandId'], outcome: { kind: 'error' } })],
    })
    const fv = render(<failed.ChatView {...failed.props} />)
    expect(fv.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(fv.getByText('命令失败')).toBeTruthy()
    expect(fv.getByText('失败')).toBeTruthy()

    // Still executing: running state with the executing copy.
    const executing = makeHarness({
      nodes: [command({ seq: 7, commandId: 'cmd-3' as CommandNode['commandId'], outcome: null })],
    })
    const xv = render(<executing.ChatView {...executing.props} />)
    expect(xv.container.querySelector('[data-state="running"]')).not.toBeNull()
    expect(xv.getByText('执行中…')).toBeTruthy()
    expect(xv.getByText('运行中')).toBeTruthy()

    // Cross-window soft-fall (run page truncated): generic title, outcome preserved.
    const orphan = makeHarness({
      nodes: [command({ seq: 8, commandId: 'cmd-4' as CommandNode['commandId'], name: null, args: null, outcome: { kind: 'success' } })],
    })
    const ov = render(<orphan.ChatView {...orphan.props} />)
    expect(ov.getByText('命令')).toBeTruthy()
    expect(ov.getByText('已完成')).toBeTruthy()
  })

  it('renders /compact as one stateful disclosure from running through completion', () => {
    const running = command({
      commandId: 'cmd-compact' as CommandNode['commandId'],
      name: 'compact',
      outcome: null,
    })
    const h = makeHarness({ nodes: [running] })
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText('正在压缩…')).toBeTruthy()
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()

    act(() => {
      h.set({
        nodes: [{
          ...running,
          outcome: {
            kind: 'success',
            text: 'Compacted 16 history items (~11309 tokens).',
            sourceEventSeq: 7,
          },
        }, compaction()],
      })
    })

    expect(view.queryByText('正在压缩…')).toBeNull()
    expect(view.queryByText('上下文已压缩')).toBeNull()
    expect(view.getByText('已压缩 16 条历史记录（约 11309 tokens）')).toBeTruthy()
    const row = view.getByRole('button', { name: /compact/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(row.querySelector('[data-compaction-icon="context"]')).not.toBeNull()
    expect(row.querySelector('[data-compaction-disclosure="collapsed"]')).not.toBeNull()
    expect(view.queryByText('保留的事实。')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(row.querySelector('[data-compaction-disclosure="expanded"]')).not.toBeNull()
    expect(view.getByRole('heading', { name: '压缩摘要' })).toBeTruthy()
  })

  it('keeps /compact no-history and error settlements on the generic command row', () => {
    const noHistory = makeHarness({
      nodes: [command({
        name: 'compact',
        outcome: { kind: 'success', text: 'No compactable history yet.' },
      })],
    })
    const noHistoryView = render(<noHistory.ChatView {...noHistory.props} />)
    expect(noHistoryView.getByText('No compactable history yet.')).toBeTruthy()
    expect(noHistoryView.queryByRole('button')).toBeNull()

    const failed = makeHarness({
      nodes: [command({
        commandId: 'cmd-compact-failed' as CommandNode['commandId'],
        name: 'compact',
        outcome: { kind: 'error', text: 'Compaction cancelled.' },
      })],
    })
    const failedView = render(<failed.ChatView {...failed.props} />)
    expect(failedView.getByText('Compaction cancelled.')).toBeTruthy()
    expect(failedView.container.querySelector('[data-state="error"]')).not.toBeNull()
  })
})
