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
const STAGE_METADATA_PREFIX = new RegExp([
  '^(?:length|word\\s*count|words?|tone|style|format|language|audience|requirements?|constraints?',
  '|output|genre|setting|characters?|theme|长度|篇幅|字数|语气|风格|格式|语言|受众|要求|限制',
  '|输出|体裁|类型|背景|人物|主题)\\s*[:：]',
].join(''), 'iu')
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
  if (
    title === null
    || STAGE_METADATA_PREFIX.test(title)
    || containsTechnicalPayload(title)
    || isUserQueryEcho(title, userQueries)
  ) return null
  return title
}

/** Reject display-sidecar fragments that are answer constraints, not work stages. */
function refinedStageText(value: string, userQueries: readonly string[]): string | null {
  const compact = value.replace(/\s+/gu, ' ').trim()
  if (
    Array.from(compact).length > STAGE_TEXT_LIMIT
    || STAGE_METADATA_PREFIX.test(compact)
    || /(?:…|\.{3}|[（(\[{:：,，;；-])$/u.test(compact)
  ) return null
  return semanticStageText(compact, userQueries)
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
  /** Newest transcript fact represented by this local presentation title. */
  evidence: number
  /** Stable client identity for in-flight evidence without a durable Session seq. */
  activityKey?: string
}

function latestToolTitle(nodes: readonly ChatNode[], userQueries: readonly string[]): ProcessHeadline | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind !== 'tool-call') continue
    const text = textFromTool(node.data.root, userQueries)
    if (text !== null) return { text, priority: 1, evidence: node.anchorSeq, activityKey: node.key }
  }
  return null
}

/**
 * Keep the semantic seat useful before the display sidecar returns. This
 * classifies only the task object; it never copies the request or exposes the
 * streamed reasoning that the technical disclosure owns.
 */
function taskStageFallback(userQueries: readonly string[]): string {
  const query = userQueries.join(' ').normalize('NFKC').toLocaleLowerCase()
  const chinese = /[\p{Script=Han}]/u.test(query)
  const label = (zh: string, en: string): string => chinese ? zh : en
  const web = /(?:html|网页|网站|web\s*(?:page|site)|landing\s*page)/u.test(query)
  const story = /(?:故事|小说|叙事|story|narrative)/u.test(query)
  if (web && story) return label('构思故事网页的视觉与交互', 'Shaping the story page and its interactions')
  if (web) return label('梳理网页的信息结构与交互', 'Structuring the page and its interactions')
  if (/(?:游戏|消消乐|关卡|game|level)/u.test(query)) {
    return label('设计游戏规则与核心体验', 'Designing the game rules and core experience')
  }
  if (/(?:pdf|幻灯片|演示文稿|ppt|slides?|文档|报告|document|report)/u.test(query)) {
    return label('组织内容结构与呈现重点', 'Organizing the content and presentation')
  }
  if (/(?:海报|图片|插画|视觉|动效|image|poster|illustration|animation)/u.test(query)) {
    return label('构思视觉主题与画面层次', 'Shaping the visual theme and hierarchy')
  }
  if (/(?:调研|研究|分析|比较|评估|research|analy[sz]e|compare|evaluate)/u.test(query)) {
    return label('整理关键线索与判断依据', 'Gathering the evidence for a sound judgment')
  }
  if (/(?:修复|排查|故障|报错|bug|debug|fix|broken|fail)/u.test(query)) {
    return label('定位问题成因与修复路径', 'Tracing the problem and its repair path')
  }
  if (/(?:实现|开发|代码|组件|功能|build|implement|code|component|feature)/u.test(query)) {
    return label('确定实现路径与关键约束', 'Defining the implementation path and constraints')
  }
  if (/(?:写|创作|文章|故事|文案|write|draft|story|article)/u.test(query)) {
    return label('组织内容结构与表达重点', 'Organizing the content and its key message')
  }
  return label('形成任务的可执行方案', 'Forming an executable approach')
}

function nextHeadline(
  nodes: readonly ChatNode[], todos: readonly TodoItem[], userQueries: readonly string[],
): ProcessHeadline | null {
  const activeTodo = todos.find(item => item.status === 'in_progress')
  const todoText = activeTodo === undefined ? null : semanticStageText(activeTodo.content, userQueries)
  if (todoText !== null) return { text: todoText, priority: 3, evidence: Number.MAX_SAFE_INTEGER }
  // Raw reasoning stays private and remains available under “运行详情”. A
  // task-object title keeps this seat understandable while the display-only
  // sidecar is pending or unavailable.
  return latestToolTitle(nodes, userQueries)
    ?? { text: taskStageFallback(userQueries), priority: 0, evidence: -1 }
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
  readonly cursor: number
  readonly activityKey?: string
}

interface RefinedStageState {
  readonly stages: readonly RefinedStage[]
  /** Explicit Tool/Todo activity represented by the latest accepted decision. */
  readonly coveredActivityKey: string | null
}

function stageDistance(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  const previous = b.map((_, index) => index + 1)
  for (let row = 0; row < a.length; row += 1) {
    const current = [row + 1]
    for (let column = 0; column < b.length; column += 1) {
      current[column + 1] = a[row] === b[column]
        ? previous[column] ?? 0
        : 1 + Math.min(
          previous[column + 1] ?? 0,
          current[column] ?? 0,
          previous[column] ?? 0,
        )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous.at(-1) ?? a.length
}

function sameStageMeaning(left: string, right: string): boolean {
  const a = comparisonText(left)
  const b = comparisonText(right)
  if (a === b) return true
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return true
  const longest = Math.max(a.length, b.length)
  return longest >= 8 && stageDistance(a, b) / longest <= 0.28
}

function acceptRefinedStage(
  previous: readonly RefinedStage[], result: ProcessStagePresentationResult,
  userQueries: readonly string[], activityKey?: string,
): readonly RefinedStage[] {
  if (result.kind !== 'stage') return previous
  const title = refinedStageText(result.title, userQueries)
  if (title === null) return previous
  const identity = comparisonText(title)
  const current = previous.at(-1)
  const currentIdentity = current === undefined ? '' : comparisonText(current.title)
  const existing = previous.findIndex(stage => sameStageMeaning(stage.title, title))
  if (existing !== -1 && existing !== previous.length - 1) return previous
  const progressiveRewrite = Math.min(identity.length, currentIdentity.length) >= 8
    && (identity.startsWith(currentIdentity) || currentIdentity.startsWith(identity))
  if (existing !== -1
    && existing === previous.length - 1
    && result.action === 'append'
    && !progressiveRewrite) return previous
  if ((result.action === 'replace-current' || progressiveRewrite) && current !== undefined) {
    return [...previous.slice(0, -1), {
      ...current, title, cursor: result.cursor,
      ...(activityKey === undefined ? {} : { activityKey }),
    }]
  }
  return [...previous, {
    key: `refined-stage:${previous.length}`, title, cursor: result.cursor,
    ...(activityKey === undefined ? {} : { activityKey }),
  }]
}

function processActivitySignature(nodes: readonly ChatNode[], todos: readonly TodoItem[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => {
      switch (node.kind) {
        case 'assistant-step':
          return [node.key, node.anchorSeq, node.data.status,
            node.data.blocks.map(block => block.kind === 'reasoning'
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
  })
}

function useRefinedStages({
  turn, live, activitySignature, explicitActivityKey, userQueries, refine,
}: {
  readonly turn: number | null
  readonly live: boolean
  readonly activitySignature: string
  readonly explicitActivityKey: string | undefined
  readonly userQueries: readonly string[]
  readonly refine: ChatViewSlotProps['refineProcessStage']
}): RefinedStageState {
  const [stages, setStages] = useState<readonly RefinedStage[]>([])
  const [coveredActivityKey, setCoveredActivityKey] = useState<string | null>(null)
  const stagesRef = useRef<readonly RefinedStage[]>([])
  const cursorRef = useRef(-1)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const turnRef = useRef(turn)
  const liveRef = useRef(live)
  const refineRef = useRef(refine)
  const explicitActivityKeyRef = useRef(explicitActivityKey)
  const [revision, setRevision] = useState(0)
  liveRef.current = live
  refineRef.current = refine
  explicitActivityKeyRef.current = explicitActivityKey
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
    setCoveredActivityKey(null)
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
      // Associate a decision with the activity that was actually present when
      // its request started. A Tool arriving while the request is in flight
      // remains visibly pending until the queued follow-up represents it.
      const requestedActivityKey = explicitActivityKeyRef.current
      void refineRef.current({
        turn: requestedTurn,
        afterSeq: cursorRef.current,
        acceptedStages: stagesRef.current.map(stage => stage.title),
      }).then((result) => {
        if (!mountedRef.current || turnRef.current !== requestedTurn || result === null) return
        if ((result.kind === 'stage' || result.kind === 'unchanged') && result.cursor !== undefined) {
          cursorRef.current = Math.max(cursorRef.current, result.cursor)
        }
        const next = acceptRefinedStage(
          stagesRef.current, result, userQueries, requestedActivityKey,
        )
        const current = stagesRef.current.at(-1)
        const validTitle = result.kind === 'stage' ? refinedStageText(result.title, userQueries) : null
        const coversActivity = result.kind === 'unchanged'
          || result.kind === 'stage' && validTitle !== null
            && (next !== stagesRef.current || current !== undefined && sameStageMeaning(current.title, validTitle))
        if (coversActivity && requestedActivityKey !== undefined) {
          setCoveredActivityKey(requestedActivityKey)
        }
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
  }, [activitySignature, explicitActivityKey, live, revision, turn, userQueries])
  return { stages, coveredActivityKey }
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
        // Reasoning stays available in “运行详情”. Promoting its latest sentence
        // directly into the semantic trail creates visibly unfinished and
        // backward-moving titles while the block streams.
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

interface ProcessNarration {
  readonly key: string
  readonly blocks: readonly AssistantBlock[]
  readonly streaming: boolean
  readonly kind: 'candidate' | 'intermediate'
}

/**
 * Keep the newest visible Assistant prose in one stable output seat. Until a
 * later Tool/activity arrives it is a candidate closing answer; once later
 * work exists it becomes an intermediate result without changing position.
 */
function latestNarration(nodes: readonly ChatNode[]): ProcessNarration | null {
  let candidate: ProcessNarration | null = null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node === undefined) continue
    const blocks = resultBlocks(node)
    if (blocks.length === 0 || node.kind !== 'assistant-step') continue
    const callsTool = node.data.blocks.some(block => block.kind === 'tool-call')
    const narration: ProcessNarration = {
      key: node.key,
      blocks,
      streaming: node.data.status === 'running',
      kind: callsTool || index < nodes.length - 1 ? 'intermediate' : 'candidate',
    }
    // An explanation that led into a Tool/question is a durable intermediate
    // result. Do not let a later one-word streaming fragment displace it; that
    // fragment remains in Run details until it becomes the closing answer.
    if (narration.kind === 'intermediate') return narration
    candidate ??= narration
  }
  return candidate
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
  const tailKey = closingKey ?? nodeKeys.at(-1)
  const tailVersion = useSession(snapshot => tailKey === undefined ? null : snapshot.chat.nodes.get(tailKey) ?? null)
  const turnLocation = useSession(snapshot => turn === null ? null : snapshot.chat.timeline.turns.get(turn) ?? null)
  const todos = useProjection('todos') ?? []
  const nodes = useMemo(() => {
    void version
    void tailVersion
    const keys = closingKey === undefined ? nodeKeys : [...nodeKeys, closingKey]
    return keys
      .map(key => store.get(key) as ChatNode | undefined)
      .filter((node): node is ChatNode => node !== undefined)
  }, [closingKey, nodeKeys, store, tailVersion, version])
  const processNodes = closingKey === undefined ? nodes : nodes.filter(node => node.key !== closingKey)
  const proposedHeadline = useMemo(
    () => nextHeadline(processNodes, todos, userQueries),
    [processNodes, todos, userQueries],
  )
  const headline = useStableHeadline(proposedHeadline)
  const lines = useMemo(
    () => processLogLines(processNodes, headline, userQueries, t),
    [headline, processNodes, t, userQueries],
  )
  const activitySignature = useMemo(
    () => processActivitySignature(processNodes, todos),
    [processNodes, todos],
  )
  const { stages: refinedStages, coveredActivityKey } = useRefinedStages({
    turn, live, activitySignature, explicitActivityKey: proposedHeadline?.activityKey,
    userQueries, refine: refineProcessStage,
  })
  const latestRefinedActivityKey = refinedStages.at(-1)?.activityKey ?? coveredActivityKey
  const pendingExplicitActivity = headline?.activityKey !== undefined
    && latestRefinedActivityKey !== headline.activityKey
  const explicitEvidenceIsNewer = headline?.evidence === Number.MAX_SAFE_INTEGER
    ? pendingExplicitActivity
    : pendingExplicitActivity && headline.evidence > (refinedStages.at(-1)?.cursor ?? -1)
  const explicitAfterRefinement = headline !== null
    && headline.priority > 0
    && explicitEvidenceIsNewer
    && comparisonText(headline.text) !== comparisonText(refinedStages.at(-1)?.title ?? '')
  const presentationLines = useMemo<readonly ProcessLogLine[]>(() => {
    if (refinedStages.length === 0) return lines
    const refined = refinedStages.map((stage, index) => ({
      key: stage.key,
      text: stage.title,
      state: index === refinedStages.length - 1 && !explicitAfterRefinement ? 'active' as const : 'done' as const,
      priority: 3 as const,
      replaceCurrent: true,
    }))
    return explicitAfterRefinement
      ? [...refined, {
        key: `explicit-stage:${headline.evidence}:${comparisonText(headline.text)}`,
        text: headline.text,
        state: 'active',
        priority: headline.priority,
      }]
      : refined
  }, [explicitAfterRefinement, headline, lines, refinedStages])
  const warning = nodes.some(nodeWarning)
  const processState = live ? 'running' : warning ? 'warning' : 'done'
  const startTime = turnLocation?.start?.time ?? null
  const runMs = turnLocation?.start === undefined || turnLocation.end === undefined
    ? undefined
    : Math.max(0, turnLocation.end.time - turnLocation.start.time)
  const count = Math.max(1, turnLocation?.steps.length ?? 0, nodeKeys.length)

  const narration = latestNarration(processNodes)
  const result = narration === null ? undefined : (
    <AssistantMarkdown
      key={narration.key}
      blocks={narration.blocks}
      streaming={narration.streaming}
      loadImage={loadImage}
      t={t}
    />
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
      title={explicitAfterRefinement ? headline.text : refinedStages.at(-1)?.title ?? headline?.text}
      lines={presentationLines}
      trailSource={refinedStages.length === 0 ? 'local' : 'refined'}
      result={result}
      resultKind={narration?.kind}
      t={t}
    >
      {details.length === 0 ? null : details}
    </ProcessPanel>
  )
})
