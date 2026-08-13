import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import LlmRuntime, {
  createAssistantMessage, createToolResultMessage, createUserMessage, LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WebPresentationService from '../src/index.ts'
import type { Config } from '../src/index.ts'

const CONFIG: Config = {
  maxInputBytes: 8_192,
  maxOutputTokens: 256,
  timeoutMs: 8_000,
  maxHeadings: 10,
  maxSectionCharacters: 480,
  maxStageEvents: 8,
  maxStageCallsPerTurn: 8,
  maxTitleCharacters: 52,
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async context => context.fiber.dispose()))
})

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly outputs: readonly string[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const output = this.outputs[this.requests.length - 1] ?? ''
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function bench(outputs: readonly string[]) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  const adapter = new ScriptedAdapter(outputs)
  ctx.llm.registerAdapter(['main'], adapter)
  await ctx.plugin(WebPresentationService, CONFIG)
  return { ctx, adapter }
}

function route(session: ReturnType<Context['sessions']['create']>, system = 'agent system'): void {
  session.append('request/header', {
    header: { config: { provider: 'main', model: 'chat' }, system },
    reason: 'initial',
  })
}

function turn(session: ReturnType<Context['sessions']['create']>, text: string) {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Improve this page' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  const answer = createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'main', model: 'chat' },
  })
  const event = session.append('assistant/message', {
    turn: 1, step: 1, message: answer,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  return event
}

describe('WebPresentationService', () => {
  it('refines only a completed closing answer and leaves model history and system prompt untouched', async () => {
    const { ctx, adapter } = await bench(['[{"index":0,"title":"The hierarchy lacks information"}]'])
    const session = ctx.sessions.create(SessionId('presentation-heading'))
    route(session)
    const answer = turn(session, '# You are right, where is the problem?\n\nThe page lacks hierarchy.')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const before = session.deriveMessages()

    await expect(ctx.webPresentation.responseHeadings({
      sessionId: session.id,
      messageId: answer.data.message.id,
    })).resolves.toEqual({
      kind: 'refined',
      replacements: [{ textBlock: 0, offset: 0, title: 'The hierarchy lacks information' }],
    })

    expect(session.deriveMessages()).toEqual(before)
    expect(session.requestHeader()?.system).toBe('agent system')
    expect(answer.data.message.content).toEqual([{
      type: 'text',
      text: '# You are right, where is the problem?\n\nThe page lacks hierarchy.',
    }])
    expect(adapter.requests[0]).toMatchObject({
      provider: 'main', model: 'chat', purpose: 'presentation',
    })
    expect(typeof adapter.requests[0]?.system).toBe('string')
    expect(adapter.requests[0]?.system).not.toContain('agent system')
    expect(session.events.findLast(event => event.type === 'web/presentation-llm-request')?.data)
      .toMatchObject({ kind: 'response-headings', sourceEventSeqs: [answer.seq] })
  })

  it('summarizes newly logged running activity without exposing raw commands', async () => {
    const { ctx, adapter } = await bench(['{"action":"append","title":"Comparing layout options"}'])
    const session = ctx.sessions.create(SessionId('presentation-stage'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const call = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-1' as never,
      name: 'bash',
      arguments: JSON.stringify({ cmd: 'cat /private/secret', description: 'Compare layout options' }),
    })
    const result = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.data.callId,
        content: [{ type: 'text', text: 'Saved private output at /private/secret' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const before = session.deriveMessages()

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: -1,
      acceptedStages: [],
    })).resolves.toEqual({
      kind: 'stage', cursor: result.seq, action: 'append', title: 'Comparing layout options',
    })

    expect(session.deriveMessages()).toEqual(before)
    const framed = adapter.requests[0]?.messages[0]?.content[0]
    expect(framed?.type === 'text' ? framed.text : '').toContain('Compare layout options')
    expect(framed?.type === 'text' ? framed.text : '').not.toContain('/private/secret')
    expect(framed?.type === 'text' ? framed.text : '').not.toContain('Saved private output')
    expect(adapter.requests[0]).toMatchObject({ purpose: 'presentation' })
  })

  it('can refine a live stage from streamed reasoning before an Assistant message finalizes', async () => {
    const { ctx, adapter } = await bench(['{"action":"append","title":"Designing the level rules"}'])
    const session = ctx.sessions.create(SessionId('presentation-live-reasoning'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const chunk = session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'I am defining the board and level rules now.' },
    })

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: -1,
      acceptedStages: [],
    })).resolves.toEqual({
      kind: 'stage', cursor: chunk.seq, action: 'append', title: 'Designing the level rules',
    })

    const framed = adapter.requests[0]?.messages[0]?.content[0]
    expect(framed?.type === 'text' ? framed.text : '').toContain('defining the board and level rules')
    expect(adapter.requests[0]).toMatchObject({ purpose: 'presentation' })
  })

  it('coalesces token-sized live deltas and records every represented source sequence', async () => {
    const { ctx, adapter } = await bench(['{"action":"append","title":"Designing the board"}'])
    const session = ctx.sessions.create(SessionId('presentation-live-deltas'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const first = session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Designing ' },
    })
    const second = session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'the board' },
    })

    await ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: -1, acceptedStages: [],
    })

    const framed = adapter.requests[0]?.messages[0]?.content[0]
    const input = framed?.type === 'text' ? framed.text : ''
    expect(input).toContain('Designing the board')
    expect(input.match(/reasoning-delta/gu)).toHaveLength(1)
    expect(session.events.findLast(event => event.type === 'web/presentation-llm-request')?.data)
      .toMatchObject({ sourceEventSeqs: [first.seq, second.seq] })
  })

  it('refuses an intermediate Assistant message in a completed Turn', async () => {
    const { ctx, adapter } = await bench([])
    const session = ctx.sessions.create(SessionId('presentation-intermediate'))
    route(session)
    const intermediate = turn(session, '# Interim\n\nFirst explanation.')
    const closing = createAssistantMessage({
      content: [{ type: 'text', text: '# Final\n\nCompleted answer.' }],
      source: { provider: 'main', model: 'chat' },
    })
    session.append('step/start', { turn: 1, step: 2 })
    session.append('assistant/message', {
      turn: 1, step: 2, message: closing,
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 2 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await expect(ctx.webPresentation.responseHeadings({
      sessionId: session.id,
      messageId: intermediate.data.message.id,
    })).resolves.toEqual({ kind: 'unavailable', reason: 'not-closing-message' })
    expect(adapter.requests).toEqual([])
  })
})
