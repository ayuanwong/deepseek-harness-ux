import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AssistantBlock, TodoItem, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ProcessStagePresentationResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ProcessPanel, type ProcessLogLine } from './ProcessPanel.tsx'

const STAGE_TEXT_LIMIT = 52
const QUERY_ECHO_GENERIC_SUFFIX = new RegExp([
  '^(?:中|进行中|现在|当前|开始|继续|任务|请求|问题',
  '|到底(?:是|指)?什么|(?:是|指)什么|what(?:it)?means|now|currently)?$',
].join(''), 'u')
const SHELL_COMMAND_SOURCE = [
  'cd|ls|cat|rg|grep|find|git|npm|npx|pnpm|yarn|bun|node|deno|python\\d*|pytest|vitest|jest|tsc|tsx',
  'echo|printf|pwd|cp|mv|mkdir|touch|chmod|chown|sh|bash|zsh|pwsh',
  'curl|wget|sed|awk|make|cargo|go|docker|podman|pip\\d*|uv|ruby|bundle|gradle|mvn|dotnet',
  'swift|xcodebuild|terraform|kubectl|helm',
].join('|')
const SHELL_COMMAND_NAME = new RegExp(`^(?:${SHELL_COMMAND_SOURCE})$`, 'iu')
const SHELL_COMMAND_PAYLOAD = new RegExp(`(?:^|\\s)(?:${SHELL_COMMAND_SOURCE})(?=\\s|$)`, 'iu')

function compactStageText(value: string): string | null {
  const compact = value
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]\s+)\s*/u, '')
    .replace(/[*_`~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (
    compact === ''
    || /^(?:正在)?(?:理解|思考|处理|工作|规划)(?:中|…|\.\.\.|\s|[:：]|$)/u.test(compact)
    || /^(?:the user|user)(?:\s+(?:wants|asked|is asking|needs)|\s*[:：])/iu.test(compact)
    || /^用户(?:希望|要求|想要|正在要求|问|询问|需要)/u.test(compact)
    || /^(?:i(?:'ll| will| need| should| can)|let me|first,?\s+i)\b/iu.test(compact)
    || /^(?:now|next),?\s+(?:i|we)\b/iu.test(compact)
    || /^(?:then|after(?:\s+that|wards)?|finally)(?:,|\s)/iu.test(compact)
    || /^(?:我(?:先|将|要|会|需要)|先(?:来|从)?)(?:\s|[:：]|$)/u.test(compact)
    || /^(?:接下来|然后)(?:我|我们)(?:\s|[:：]|$)/u.test(compact)
    || /^(?:good|okay|ok|done|great)(?:[.!。](?:\s|$)|$)/iu.test(compact)
    || /^(?:think|thinking|reasoning)(?:\s*[·:：-]|\s|$)/iu.test(compact)
  ) return null
  const characters = Array.from(compact)
  return characters.length <= STAGE_TEXT_LIMIT
    ? compact
    : `${characters.slice(0, STAGE_TEXT_LIMIT - 1).join('').trimEnd()}…`
}

function comparisonText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isUserQueryEcho(value: string, userQueries: readonly string[]): boolean {
  const candidate = comparisonText(value)
  if (candidate === '') return false
  return userQueries.some((rawQuery) => {
    const query = comparisonText(rawQuery)
    if (query === '') return false
    if (candidate === query) return true
    // Reasoning often quotes only one sentence from a longer request. That
    // fragment is still query repetition, even though it no longer contains
    // the complete user message after sentence splitting.
    if (candidate.length >= 8 && query.includes(candidate)) return true
    if (!candidate.includes(query)) return false
    const queryIndex = candidate.indexOf(query)
    const suffix = candidate.slice(queryIndex + query.length)
    return QUERY_ECHO_GENERIC_SUFFIX.test(suffix)
  })
}

function containsTechnicalPayload(value: string): boolean {
  const compact = value.trim()
  const firstToken = compact.replace(/^(?:[$>#]\s*)/u, '').split(/\s/u, 1)[0] ?? ''
  const action = /(?:执行|运行|调用|输入|键入|run(?:ning)?|execut(?:e|ing)|invok(?:e|ing))\s*(?:[$>#]\s*)?/iu.exec(compact)
  const afterAction = action === null ? '' : compact.slice(action.index + action[0].length)
  return /^(?:https?:\/\/|file:\/\/|\/|~\/|\.{1,2}\/|[a-z]:[\\/])/iu.test(compact)
    || SHELL_COMMAND_NAME.test(firstToken)
    || /https?:\/\/\S+/iu.test(compact)
    || /(?:^|[\s"'([{:：])(?:file:\/\/|\/|~\/|\.{1,2}\/|[a-z]:[\\/])\S+/iu.test(compact)
    || /\/[\w.@+-]+(?:\/[\w.@+-]+)+/u.test(compact)
    || (action !== null && (
      SHELL_COMMAND_PAYLOAD.test(afterAction.replace(/[：:]/gu, ' '))
      || /(?:^|\s)--?[a-z][\w-]*(?:\s|$)/iu.test(afterAction)
      || /(?:&&|\|\||[|>])/u.test(afterAction)
    ))
    || /^(?:[\w.@+-]+[\\/])+[\w.@+ -]+(?:[:#]\d+)?$/u.test(compact)
    || /^(?:[\w@+-]+\.)+[a-z\d]{1,8}(?:[:#]\d+)?$/iu.test(compact)
}

function semanticStageText(value: string, userQueries: readonly string[]): string | null {
  if (isUserQueryEcho(value, userQueries)) return null
  const title = compactStageText(value)
  if (title === null || containsTechnicalPayload(title) || isUserQueryEcho(title, userQueries)) return null
  return title
}

function reasoningTitle(value: string, userQueries: readonly string[]): string | null {
  const segments = value.split(/(?:\r?\n+|(?<=[。！？])\s*|(?<=[.!?])\s+)/u)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment === undefined) continue
    const title = semanticStageText(segment, userQueries)
    if (title !== null) return title
  }
  return null
}

function toolArgsRaw(block: ToolCallBlock): string | undefined {
  return 'kind' in block ? block.call?.argsRaw : block.argsRaw
}

function toolArgs(block: ToolCallBlock): Record<string, unknown> | null {
  const raw = toolArgsRaw(block)
  if (raw === undefined) return null
  try {
    const args: unknown = JSON.parse(raw)
    return typeof args === 'object' && args !== null ? args as Record<string, unknown> : null
  } catch {
    return null
  }
}

function textFromTool(block: ToolCallBlock, userQueries: readonly string[]): string | null {
  const view = block.callView
  if (view?.card === 'terminal' && view.description !== undefined) {
    const title = semanticStageText(view.description, userQueries)
    if (title !== null) return title
  }
  const args = toolArgs(block)
  if (args !== null) {
    for (const key of ['description', 'objective', 'label', 'phase']) {
      const value = args[key]
      if (typeof value !== 'string') continue
      const title = semanticStageText(value, userQueries)
      if (title !== null) return title
    }
  }
  return null
}

interface ProcessHeadline {
  text: string
  priority: ProcessLogLine['priority']
}

function latestReasoning(nodes: readonly ChatNode[], userQueries: readonly string[]): ProcessHeadline | null {
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = nodes[nodeIndex]
    if (node?.kind !== 'assistant-step') continue
    for (let blockIndex = node.data.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = node.data.blocks[blockIndex]
      if (block?.kind !== 'reasoning') continue
      const text = reasoningTitle(block.text, userQueries)
      if (text !== null) return { text, priority: 2 }
    }
  }
  return null
}

function latestToolTitle(nodes: readonly ChatNode[], userQueries: readonly string[]): ProcessHeadline | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind !== 'tool-call') continue
    const text = textFromTool(node.data.root, userQueries)
    if (text !== null) return { text, priority: 1 }
  }
  return null
}

function nextHeadline(
  nodes: readonly ChatNode[], todos: readonly TodoItem[], userQueries: readonly string[],
): ProcessHeadline | null {
  const activeTodo = todos.find(item => item.status === 'in_progress')
  const todoText = activeTodo === undefined ? null : semanticStageText(activeTodo.content, userQueries)
  if (todoText !== null) return { text: todoText, priority: 3 }
  return latestReasoning(nodes, userQueries) ?? latestToolTitle(nodes, userQueries)
}

function useStableHeadline(next: ProcessHeadline | null): ProcessHeadline | null {
  const stable = useRef(next)
  const latest = useRef(next)
  const timer = useRef<number | null>(null)
  const [, setRevision] = useState(0)
  latest.current = next
  if (stable.current === null && next !== null) stable.current = next
  useEffect(() => {
    if (stable.current?.text === next?.text && stable.current?.priority === next?.priority) return
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      stable.current = latest.current
      setRevision(value => value + 1)
    }, 650)
  }, [next])
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  return stable.current
}

interface RefinedStage {
  readonly key: string
  readonly title: string
}

function acceptRefinedStage(
  previous: readonly RefinedStage[], result: ProcessStagePresentationResult,
): readonly RefinedStage[] {
  if (result.kind !== 'stage') return previous
  const identity = comparisonText(result.title)
  const existing = previous.findIndex(stage => comparisonText(stage.title) === identity)
  if (existing !== -1) return previous
  if (result.action === 'replace-current' && previous.length > 0) {
    const current = previous.at(-1)
    /* v8 ignore next -- length guard above makes the current stage present. */
    if (current === undefined) return previous
    return [...previous.slice(0, -1), { ...current, title: result.title }]
  }
  return [...previous, { key: `refined-stage:${previous.length}`, title: result.title }]
}

function useRefinedStages({
  turn, live, nodes, todos, refine,
}: {
  readonly turn: number | null
  readonly live: boolean
  readonly nodes: readonly ChatNode[]
  readonly todos: readonly TodoItem[]
  readonly refine: ChatViewSlotProps['refineProcessStage']
}): readonly RefinedStage[] {
  const [stages, setStages] = useState<readonly RefinedStage[]>([])
  const stagesRef = useRef<readonly RefinedStage[]>([])
  const cursorRef = useRef(-1)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const turnRef = useRef(turn)
  const liveRef = useRef(live)
  const refineRef = useRef(refine)
  const [revision, setRevision] = useState(0)
  const activitySignature = useMemo(() => JSON.stringify({
    nodes: nodes.map((node) => {
      switch (node.kind) {
        case 'assistant-step':
          return [node.key, node.anchorSeq, node.data.status,
            node.data.blocks.map(block => block.kind === 'reasoning' || block.kind === 'text'
              ? Math.floor(block.text.length / 320)
              : block.kind)]
        case 'tool-call': {
          const root = node.data.root
          return [node.key, node.anchorSeq, 'kind' in root ? root.kind : 'running', 'seq' in root ? root.seq : root.time]
        }
        default:
          return [node.key, node.anchorSeq, node.kind]
      }
    }),
    todos: todos.map(todo => [todo.status, todo.content]),
  }), [nodes, todos])
  liveRef.current = live
  refineRef.current = refine
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])
  useEffect(() => {
    turnRef.current = turn
    stagesRef.current = []
    cursorRef.current = -1
    queuedRef.current = false
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setStages([])
  }, [turn])
  useEffect(() => {
    if (!live || turn === null) {
      queuedRef.current = false
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }
    queuedRef.current = true
    if (timerRef.current !== null || inFlightRef.current) return
    // Throttle from the first observed activity instead of debouncing until a
    // continuous stream becomes quiet. Text progress is quantized above, so
    // this remains a small number of calls rather than one call per token.
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (!mountedRef.current || !liveRef.current || turnRef.current !== turn) return
      inFlightRef.current = true
      queuedRef.current = false
      const requestedTurn = turn
      void refineRef.current({
        turn: requestedTurn,
        afterSeq: cursorRef.current,
        acceptedStages: stagesRef.current.map(stage => stage.title),
      }).then((result) => {
        if (!mountedRef.current || turnRef.current !== requestedTurn || result === null) return
        if (result.cursor !== undefined) {
          cursorRef.current = Math.max(cursorRef.current, result.cursor)
        }
        const next = acceptRefinedStage(stagesRef.current, result)
        if (next !== stagesRef.current) {
          stagesRef.current = next
          setStages(next)
        }
      }).finally(() => {
        inFlightRef.current = false
        if (mountedRef.current && liveRef.current && queuedRef.current) {
          setRevision(value => value + 1)
        }
      })
    }, 1_200)
  }, [activitySignature, live, revision, turn])
  return stages
}

function nodeWarning(node: ChatNode): boolean {
  switch (node.kind) {
    case 'assistant-step': return node.data.status === 'interrupted'
    case 'tool-call': return 'kind' in node.data.root && node.data.root.isError
    case 'turn-error': return true
    case 'command': return node.data.outcome?.kind === 'error'
    case 'manual-compaction': return node.data.command.outcome?.kind === 'error'
    case 'model-retry': return node.data.current.retryState === 'cancelled'
    default: return false
  }
}

function processLogLines(
  nodes: readonly ChatNode[], headline: ProcessHeadline | null, userQueries: readonly string[], t: ChatViewSlotProps['t'],
): ProcessLogLine[] {
  const lines: ProcessLogLine[] = []
  const push = (line: ProcessLogLine): void => {
    const previous = lines.at(-1)
    if (previous?.text === line.text) {
      lines[lines.length - 1] = {
        ...previous,
        state: line.state === 'warning' ? 'warning' : line.state,
        priority: Math.max(previous.priority, line.priority) as ProcessLogLine['priority'],
      }
      return
    }
    lines.push(line)
  }
  for (const node of nodes) {
    switch (node.kind) {
      case 'assistant-step': {
        const text = [...node.data.blocks].reverse()
          .map(block => block.kind === 'reasoning' ? reasoningTitle(block.text, userQueries) : null)
          .find(value => value !== null)
        if (typeof text === 'string') {
          push({
            key: node.key, text,
            state: node.data.status === 'running' ? 'active' : node.data.status === 'interrupted' ? 'warning' : 'done',
            priority: 2,
          })
        }
        break
      }
      case 'tool-call': {
        const root = node.data.root
        push({
          key: node.key,
          text: textFromTool(root, userQueries),
          state: !('kind' in root) ? 'active' : root.isError ? 'warning' : 'done',
          priority: 1,
        })
        break
      }
      case 'context':
        push({ key: node.key, text: null, state: 'done', priority: 0 })
        break
      case 'compaction':
      case 'manual-compaction':
        push({ key: node.key, text: t('chat.activity.compacting'), state: 'done', priority: 0 })
        break
      case 'model-retry':
        push({
          key: node.key, text: t('chat.activity.retrying'),
          state: node.data.current.retryState === 'cancelled' ? 'warning' : 'active',
          priority: 0,
        })
        break
      case 'command':
        push({
          key: node.key, text: null,
          state: node.data.outcome === null ? 'active' : node.data.outcome.kind === 'error' ? 'warning' : 'done',
          priority: 1,
        })
        break
      default:
        break
    }
  }
  if (headline !== null && lines.at(-1)?.text !== headline.text) {
    push({
      key: `live-stage:${comparisonText(headline.text)}`, text: headline.text, state: 'active',
      priority: headline.priority,
    })
  } else if (headline !== null) {
    const last = lines.at(-1)
    if (last !== undefined && last.state !== 'warning') lines[lines.length - 1] = { ...last, state: 'active' }
  }
  return lines.slice(-24)
}

function resultBlocks(node: ChatNode): readonly AssistantBlock[] {
  return node.kind === 'assistant-step'
    ? node.data.blocks.filter(block => block.kind === 'text' || block.kind === 'image')
    : []
}

function detailBlocks(
  node: ChatNode, live: boolean, closing: boolean,
): readonly AssistantBlock[] {
  if (node.kind !== 'assistant-step') return []
  // Live narration already occupies the semantic result seat. Once the turn
  // settles, preserve intermediate explanations in the expanded history;
  // the closing answer itself remains outside the Process disclosure.
  return node.data.blocks.filter(block => block.kind !== 'tool-call'
    && (!live && !closing || block.kind !== 'text' && block.kind !== 'image'))
}

interface ProcessGroupProps {
  readonly turn: number | null
  readonly nodeKeys: readonly string[]
  readonly closingKey?: string | undefined
  readonly live: boolean
  readonly userQueries: readonly string[]
  readonly useSession: ChatViewSlotProps['useSession']
  readonly useProjection: ChatViewSlotProps['useProjection']
  readonly selectedCallId?: ChatNodeOwnerProps['selectedCallId']
  readonly cwd?: string | undefined
  readonly openFile: ChatViewSlotProps['openFile']
  readonly inspectCall: ChatViewSlotProps['inspectCall']
  readonly forkAt: ChatViewSlotProps['forkAt']
  readonly loadImage: ChatViewSlotProps['loadImage']
  readonly fileMentions: ChatViewSlotProps['fileMentions']
  readonly refineResponseHeadings: ChatViewSlotProps['refineResponseHeadings']
  readonly refineProcessStage: ChatViewSlotProps['refineProcessStage']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

/** Live presentation wrapper over stable business Nodes; execution data is never changed. */
export const ProcessGroup = memo(function ProcessGroup({
  turn, nodeKeys, closingKey, live, userQueries, useSession, useProjection,
  selectedCallId, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions, renderSlot, t,
  refineResponseHeadings, refineProcessStage,
}: ProcessGroupProps) {
  const version = useSession(snapshot => turn === null
    ? snapshot.chat.nodes.values()
    : snapshot.chat.locations.getTurn(turn))
  const store = useSession(snapshot => snapshot.chat.nodes)
  const turnLocation = useSession(snapshot => turn === null ? null : snapshot.chat.timeline.turns.get(turn) ?? null)
  const todos = useProjection('todos') ?? []
  const nodes = useMemo(() => {
    void version
    const keys = closingKey === undefined ? nodeKeys : [...nodeKeys, closingKey]
    return keys
      .map(key => store.get(key) as ChatNode | undefined)
      .filter((node): node is ChatNode => node !== undefined)
  }, [closingKey, nodeKeys, store, version])
  const processNodes = closingKey === undefined ? nodes : nodes.filter(node => node.key !== closingKey)
  const headline = useStableHeadline(useMemo(
    () => nextHeadline(processNodes, todos, userQueries),
    [processNodes, todos, userQueries],
  ))
  const lines = useMemo(
    () => processLogLines(processNodes, headline, userQueries, t),
    [headline, processNodes, t, userQueries],
  )
  const refinedStages = useRefinedStages({
    turn, live, nodes: processNodes, todos, refine: refineProcessStage,
  })
  const presentationLines = useMemo<readonly ProcessLogLine[]>(() => refinedStages.length === 0
    ? lines
    : refinedStages.map((stage, index) => ({
      key: stage.key,
      text: stage.title,
      state: index === refinedStages.length - 1 ? 'active' : 'done',
      priority: 3,
      replaceCurrent: true,
    })), [lines, refinedStages])
  const warning = nodes.some(nodeWarning)
  const processState = live ? 'running' : warning ? 'warning' : 'done'
  const startTime = turnLocation?.start?.time ?? null
  const runMs = turnLocation?.start === undefined || turnLocation.end === undefined
    ? undefined
    : Math.max(0, turnLocation.end.time - turnLocation.start.time)
  const count = Math.max(1, turnLocation?.steps.length ?? 0, nodeKeys.length)

  const narration = processNodes.flatMap((node) => {
    const blocks = resultBlocks(node)
    return blocks.length === 0 ? [] : [{ key: node.key, blocks, streaming: node.kind === 'assistant-step' && node.data.status === 'running' }]
  })
  const result = narration.length === 0 ? undefined : (
    <>
      {narration.map(item => (
        <AssistantMarkdown
          key={item.key}
          blocks={item.blocks}
          streaming={item.streaming}
          loadImage={loadImage}
          t={t}
        />
      ))}
    </>
  )

  const details: ReactNode[] = []
  for (const node of nodes) {
    if (node.kind === 'assistant-step') {
      const blocks = detailBlocks(node, live, node.key === closingKey)
      if (blocks.length > 0) {
        details.push(
          <AssistantMarkdown
            key={`detail:${node.key}`}
            blocks={blocks}
            streaming={live && node.data.status === 'running'}
            interrupted={node.data.status === 'interrupted'}
            loadImage={loadImage}
            t={t}
          />,
        )
      }
      continue
    }
    details.push(
      <ChatNodeSeat
        key={node.key}
        nodeKey={node.key}
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
      />,
    )
  }

  return (
    <ProcessPanel
      state={processState}
      count={count}
      startTime={startTime}
      runMs={runMs}
      title={refinedStages.at(-1)?.title ?? headline?.text}
      lines={presentationLines}
      trailSource={refinedStages.length === 0 ? 'local' : 'refined'}
      result={result}
      t={t}
    >
      {details.length === 0 ? null : details}
    </ProcessPanel>
  )
})
