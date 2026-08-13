/** Turn-scoped produced-file Definition and readers. Client-only and model-free. */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolResultNode['callView']>
}

/** Common end-user artifacts that are normally created by a command or a
 * document skill rather than the UTF-8 write/edit tools. Their exact inline
 * code references in the closing answer are therefore useful output facts,
 * while arbitrary prose paths remain excluded. The native opener itself is
 * extension-agnostic and hands each path to the operating system. */
const PRESENTATION_DELIVERABLE_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx', '.odt', '.rtf', '.pages',
  '.xls', '.xlsx', '.xlsm', '.ods', '.csv', '.tsv', '.numbers',
  '.ppt', '.pptx', '.odp', '.key',
  '.json', '.jsonl', '.parquet', '.sqlite', '.sqlite3', '.db',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.tif', '.tiff', '.bmp', '.ico',
  '.psd', '.ai', '.sketch', '.fig',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv',
  '.zip', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.epub',
  '.glb', '.gltf', '.obj', '.fbx', '.stl', '.step', '.stp',
])

function extension(path: string): string {
  const basename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = basename.lastIndexOf('.')
  return dot <= 0 ? '' : basename.slice(dot).toLocaleLowerCase()
}

function safeArtifactPath(value: string): string | null {
  const path = value.trim()
  if (
    path === '' || path.includes('\0') || path.includes('\n') || path.includes('\r')
    || /^(?:https?|data|file):/iu.test(path)
    || /^(?:open|start|xdg-open|explorer(?:\.exe)?|invoke-item)\s+/iu.test(path)
    || path.startsWith('-') || /["*?<>|]/u.test(path)
    || !PRESENTATION_DELIVERABLE_EXTENSIONS.has(extension(path))
  ) return null
  return path
}

function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function normalizedArtifactPath(value: string, encoded = false): string | null {
  const candidate = value.trim()
  if (/^sandbox:/iu.test(candidate)) {
    if (/^sandbox:\/\//iu.test(candidate)) return null
    const decoded = decodePath(candidate.slice('sandbox:'.length))
    if (decoded === null) return null
    const path = /^\/[a-z]:[\\/]/iu.test(decoded) ? decoded.slice(1) : decoded
    return safeArtifactPath(path)
  }
  if (!/^file:/iu.test(candidate)) {
    const path = encoded ? decodePath(candidate) : candidate
    return path === null ? null : safeArtifactPath(path)
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) return null
    const decoded = decodePath(url.pathname)
    if (decoded === null) return null
    const path = /^\/[a-z]:\//iu.test(decoded) ? decoded.slice(1) : decoded
    return safeArtifactPath(path)
  } catch {
    return null
  }
}

function standaloneArtifactPath(line: string): string | null {
  let candidate = line.trim().replace(/^[-*+]\s+/u, '').trim()
  if (candidate.startsWith('<') && candidate.endsWith('>')) {
    candidate = candidate.slice(1, -1).trim()
  }
  if (candidate === '' || /\s/u.test(candidate) && !/^(?:\.{0,2}\/|~\/|\/|[a-z]:[\\/])/iu.test(candidate)) {
    return null
  }
  return normalizedArtifactPath(candidate)
}

function markdownArtifactCandidates(line: string): readonly { index: number; value: string; encoded: boolean }[] {
  const candidates: Array<{ index: number; value: string; encoded: boolean }> = []
  for (const match of line.matchAll(/(?<!`)`([^`\n]+)`(?!`)/gu)) {
    candidates.push({ index: match.index, value: match[1] ?? '', encoded: false })
  }
  for (const match of line.matchAll(/\[[^\n\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/gu)) {
    const value = match[1] ?? match[2]
    if (value !== undefined) candidates.push({ index: match.index, value, encoded: true })
  }
  if (candidates.length === 0) {
    const standalone = standaloneArtifactPath(line)
    if (standalone !== null) candidates.push({ index: 0, value: standalone, encoded: false })
  }
  return candidates.sort((left, right) => left.index - right.index)
}

/**
 * Exact common-artifact references from settled Markdown, excluding fenced code.
 * Intent is explicit: inline code, a Markdown link destination, or a line that
 * consists only of a path. Ordinary prose remains outside the fallback.
 * @param markdown - Visible closing-answer Markdown.
 * @returns Safe, deduplicated artifact paths in first-seen order.
 */
export function artifactDeliverableReferences(markdown: string): readonly string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  let fence: { character: string; length: number } | null = null
  for (const line of markdown.split(/\r?\n/u)) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fenceMatch !== undefined) {
      const character = fenceMatch[0] ?? ''
      if (fence === null) fence = { character, length: fenceMatch.length }
      else if (character === fence.character && fenceMatch.length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    for (const candidate of markdownArtifactCandidates(line)) {
      const path = normalizedArtifactPath(candidate.value, candidate.encoded)
      if (path === null || seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }
  }
  return paths
}

/**
 * Turn output paths from tool-reported mutations and exact common artifacts.
 * @param owner - Closing Turn data, text, sequence, and Host opener.
 * @returns Deduplicated deliverable paths in first-seen order.
 */
export function deliverablePaths(owner: TurnTailOwnerProps): readonly string[] {
  const paths = [
    ...producedForClosing(owner.turn.data.get('deliverables'), owner.seq),
    ...artifactDeliverableReferences(owner.closingText),
  ]
  return paths.filter((path, index) => paths.indexOf(path) === index)
}

/**
 * Paths a call view reports having created or changed, by render intent rather
 * than tool name: a diff card, or a generic card whose kind is `edit` (the
 * shape `str_replace_editor`'s insert presents). Every other card produces
 * nothing to open — a read looked, a delete removed, a terminal ran. Only
 * root call views enter this Turn accumulator; nested Code Mode dispatches
 * preserve the pre-assembly behavior and do not contribute independently.
 */
function producedPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the mutation tools' own follow-along `locations`, not the
 * closing prose: a produced file must be listed whether or not the model
 * remembered to name it. A mutation is recognized by render intent, not by
 * tool name — a diff card, or a generic card whose `kind` is `edit` (the shape
 * `str_replace_editor`'s insert presents) — so a new mutation tool joins by
 * declaring what it does. Reads contribute nothing (looking at a file does not
 * produce it), and neither do deletes (there is nothing left to open) or
 * failed calls. Paths keep first-seen order and appear once, so a file written
 * and then edited in the same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = deliverablePaths(owner)
  return paths.length === 0 ? null : paths
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        match.view?.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = producedPaths(context.state.calls.get(callId) ?? null)
      .map(path => ({ seq: match.event.seq, path }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    },
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
