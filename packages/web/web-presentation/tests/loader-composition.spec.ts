import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import LlmRuntime, {
  createAssistantMessage,
  createUserMessage,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as presentationPlugin from '@deepseek-ai/dsh-web-presentation'

let root: string | undefined
let context: Context | undefined

class LoaderAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const output = this.requests.length === 1
      ? '{"action":"append","title":"Comparing navigation structures"}'
      : '[{"index":0,"title":"The navigation lacks hierarchy"}]'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-web-presentation-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-web-presentation'",
    '  config:',
    '    maxInputBytes: 8192',
    '    maxOutputTokens: 256',
    '    timeoutMs: 8000',
    '    maxHeadings: 10',
    '    maxSectionCharacters: 480',
    '    maxStageEvents: 8',
    '    maxStageCallsPerTurn: 8',
    '    maxTitleCharacters: 52',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-web-presentation', presentationPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('web-presentation Loader composition', () => {
  it('keeps running and answer refinements on a separate presentation route', async () => {
    const ctx = await loadComposition()
    expect([...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)).toEqual([])

    const adapter = new LoaderAdapter()
    ctx.llm.registerAdapter(['main'], adapter)
    const session = ctx.sessions.create(SessionId('loader-web-presentation'))
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'chat' }, system: 'unchanged main system' },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Improve the navigation' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    const answer = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: '# You are right\n\nThe navigation lacks hierarchy.' }],
        source: { provider: 'main', model: 'chat' },
      }),
    }, { surfaceOp: 'append' })
    const historyBeforeSidecars = session.deriveMessages()

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: -1,
      acceptedStages: [],
    })).resolves.toMatchObject({ kind: 'stage', title: 'Comparing navigation structures' })

    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await expect(ctx.webPresentation.responseHeadings({
      sessionId: session.id,
      messageId: answer.data.message.id,
    })).resolves.toEqual({
      kind: 'refined',
      replacements: [{ textBlock: 0, offset: 0, title: 'The navigation lacks hierarchy' }],
    })

    expect(session.deriveMessages()).toEqual(historyBeforeSidecars)
    expect(session.requestHeader()?.system).toBe('unchanged main system')
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.every(request => request.purpose === 'presentation')).toBe(true)
  })
})
