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

function configWith(overrides: Partial<Config>): Config {
  return Object.assign({}, CONFIG, overrides)
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

async function bench(outputs: readonly string[], config: Config = CONFIG) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  const adapter = new ScriptedAdapter(outputs)
  ctx.llm.registerAdapter(['main'], adapter)
  await ctx.plugin(WebPresentationService, config)
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
    expect(session.events.findLast(event => event.type === 'web/presentation-llm-request')?.data)
      .toMatchObject({ sourceEventSeqs: [call.seq, result.seq] })
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

  it('asks for a Chinese title when the current human message is Chinese but reasoning is English', async () => {
    const { ctx, adapter } = await bench(['{"action":"append","title":"设计关卡规则"}'])
    const session = ctx.sessions.create(SessionId('presentation-stage-language'))
    route(session)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Previous English request' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '请设计关卡规则' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    const chunk = session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'I am defining the level rules now.' },
    })

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: -1, acceptedStages: [],
    })).resolves.toEqual({
      kind: 'stage', cursor: chunk.seq, action: 'append', title: '设计关卡规则',
    })

    const framed = adapter.requests[0]?.messages[0]?.content[0]
    expect(framed?.type === 'text' ? framed.text : '').toContain('"displayLanguage":"zh"')
    expect(adapter.requests[0]?.system).toContain('Use Chinese when displayLanguage is "zh"')
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

  it('rejects answer constraints returned as stage titles', async () => {
    const { ctx } = await bench(['{"action":"append","title":"Length: a reasonably concise short story"}'])
    const session = ctx.sessions.create(SessionId('presentation-answer-constraint'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'Drafting the story now.' },
    })

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: -1,
      acceptedStages: [],
    })).resolves.toEqual({ kind: 'unavailable', reason: 'generation-failed' })
  })

  it('rejects self-referential and incomplete reasoning fragments as stage titles', async () => {
    const { ctx } = await bench(['{"action":"append","title":"The user wants a countdown"}'])
    const session = ctx.sessions.create(SessionId('presentation-reasoning-fragment'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'The user wants a countdown. Let me inspect the workspace.' },
    })

    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: -1,
      acceptedStages: [],
    })).resolves.toEqual({ kind: 'unavailable', reason: 'generation-failed' })
  })

  it('retries failed sources without advancing their cursor or spending the successful-call budget', async () => {
    const { ctx, adapter } = await bench([
      'not json',
      '{"action":"append","title":"Designing the board"}',
    ], configWith({ maxStageCallsPerTurn: 2 }))
    const session = ctx.sessions.create(SessionId('presentation-stage-retry'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const chunk = session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Designing the board.' },
    })

    const request = { sessionId: session.id, turn: 1, afterSeq: -1, acceptedStages: [] }
    await expect(ctx.webPresentation.processStage(request)).resolves.toEqual({
      kind: 'unavailable', reason: 'generation-failed',
    })
    await expect(ctx.webPresentation.processStage(request)).resolves.toEqual({
      kind: 'stage', cursor: chunk.seq, action: 'append', title: 'Designing the board',
    })
    expect(adapter.requests).toHaveLength(2)
    expect(session.events.filter(event => event.type === 'web/presentation-llm-request'))
      .toHaveLength(2)
  })

  it('reserves half of the Turn budget for later Todo or Tool boundaries', async () => {
    const reasoningOutputs = Array.from({ length: CONFIG.maxStageCallsPerTurn / 2 }, (_, index) =>
      `{"action":"append","title":"Analyzing pass ${index + 1}"}`)
    const { ctx, adapter } = await bench([
      ...reasoningOutputs,
      '{"action":"append","title":"Implementing the selected option"}',
    ])
    const session = ctx.sessions.create(SessionId('presentation-stage-reserved-budget'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    let cursor = -1
    for (let index = 0; index < reasoningOutputs.length; index += 1) {
      const chunk = session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: `Analyzing pass ${index + 1}.` },
      })
      await expect(ctx.webPresentation.processStage({
        sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
      })).resolves.toMatchObject({ kind: 'stage', cursor: chunk.seq })
      cursor = chunk.seq
    }
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'More internal analysis.' },
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
    })).resolves.toEqual({ kind: 'unavailable', reason: 'call-budget-reached' })

    const todo = session.append('todo/write', {
      todos: [{ content: 'Implement the selected option', status: 'in_progress' }],
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
    })).resolves.toEqual({
      kind: 'stage',
      cursor: todo.seq,
      action: 'append',
      title: 'Implementing the selected option',
    })
    expect(adapter.requests).toHaveLength(reasoningOutputs.length + 1)
  })

  it('coalesces a long reasoning tail before the source cap so a later Tool can use reserved budget', async () => {
    const reasoningLimit = CONFIG.maxStageCallsPerTurn / 2
    const reasoningOutputs = Array.from({ length: reasoningLimit }, (_, index) =>
      `{"action":"append","title":"Analyzing pass ${index + 1}"}`)
    const { ctx, adapter } = await bench([
      ...reasoningOutputs,
      '{"action":"append","title":"Implementing the selected option"}',
    ], configWith({ maxSectionCharacters: 24 }))
    const session = ctx.sessions.create(SessionId('presentation-long-reasoning-before-tool'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    let cursor = -1
    for (let index = 0; index < reasoningLimit; index += 1) {
      const chunk = session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: `Analyzing pass ${index + 1}.` },
      })
      await expect(ctx.webPresentation.processStage({
        sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
      })).resolves.toMatchObject({ kind: 'stage', cursor: chunk.seq })
      cursor = chunk.seq
    }

    const tail = Array.from({ length: CONFIG.maxStageEvents + 4 }, (_, index) =>
      session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: `analysis-${index};` },
      }))
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
    })).resolves.toEqual({ kind: 'unavailable', reason: 'call-budget-reached' })

    const call = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-after-long-reasoning' as never,
      name: 'bash',
      arguments: JSON.stringify({ description: 'Implement the selected option' }),
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: cursor, acceptedStages: [],
    })).resolves.toEqual({
      kind: 'stage',
      cursor: call.seq,
      action: 'append',
      title: 'Implementing the selected option',
    })

    const sourceEventSeqs = session.events
      .findLast(event => event.type === 'web/presentation-llm-request')?.data.sourceEventSeqs ?? []
    expect(sourceEventSeqs).not.toContain(tail[0]?.seq)
    expect(sourceEventSeqs).toContain(tail.at(-1)?.seq)
    expect(sourceEventSeqs).toContain(call.seq)
    expect(adapter.requests).toHaveLength(reasoningLimit + 1)
  })

  it('advances only through the represented source window and leaves later activity for the next request', async () => {
    const { ctx, adapter } = await bench([
      '{"action":"append","title":"Reviewing the first task"}',
      '{"action":"append","title":"Reviewing the remaining task"}',
    ], configWith({ maxStageEvents: 1 }))
    const session = ctx.sessions.create(SessionId('presentation-source-window'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const first = session.append('todo/write', {
      todos: [{ content: 'Review the first task', status: 'in_progress' }],
    })
    const second = session.append('todo/write', {
      todos: [{ content: 'Review the remaining task', status: 'in_progress' }],
    })
    const firstDecision = await ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: -1, acceptedStages: [],
    })
    expect(firstDecision).toEqual({
      kind: 'stage', cursor: first.seq, action: 'append', title: 'Reviewing the first task',
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: first.seq,
      acceptedStages: ['Reviewing the first task'],
    })).resolves.toEqual({
      kind: 'stage', cursor: second.seq, action: 'append', title: 'Reviewing the remaining task',
    })
    expect(adapter.requests).toHaveLength(2)
  })

  it('forces prefix-growing stage wording to replace the current stage', async () => {
    const { ctx } = await bench([
      '{"action":"append","title":"Designing the board"}',
      '{"action":"append","title":"Designing the board rules"}',
    ])
    const session = ctx.sessions.create(SessionId('presentation-progressive-stage'))
    route(session)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const first = session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Drafting the board.' },
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id, turn: 1, afterSeq: -1, acceptedStages: [],
    })).resolves.toMatchObject({ kind: 'stage', action: 'append', title: 'Designing the board' })

    session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: ' Refining its rules.' },
    })
    await expect(ctx.webPresentation.processStage({
      sessionId: session.id,
      turn: 1,
      afterSeq: first.seq,
      acceptedStages: ['Designing the board'],
    })).resolves.toMatchObject({
      kind: 'stage', action: 'replace-current', title: 'Designing the board rules',
    })
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
