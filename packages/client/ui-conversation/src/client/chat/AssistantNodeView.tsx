import { memo, useEffect, useMemo, useState } from 'react'
import type { ResponseHeadingReplacement } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { assistantText } from './turn-assistant.ts'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, refineResponseHeadings, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, closingText: assistantText(data.blocks), openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const messageId = owner === undefined ? undefined : data.finalNode?.messageId
  const [refinement, setRefinement] = useState<{
    readonly messageId: NonNullable<typeof messageId>
    readonly replacements: readonly ResponseHeadingReplacement[]
  } | null>(null)
  useEffect(() => {
    if (messageId === undefined) return
    let active = true
    void refineResponseHeadings(messageId).then((replacements) => {
      if (active) setRefinement({ messageId, replacements })
    })
    return () => { active = false }
  }, [messageId, refineResponseHeadings])
  // The closing Assistant is the user-facing answer. Reasoning and other
  // execution material live in the turn's Process disclosure, so the same
  // content never appears once as a loose row and again inside the process.
  const blocks = useMemo(
    () => owner === undefined
      ? data.blocks
      : data.blocks.filter(block => block.kind === 'text' || block.kind === 'image'),
    [data.blocks, owner],
  )
  return (
    <AssistantMarkdown
      blocks={blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      headingReplacements={refinement !== null && refinement.messageId === messageId
        ? refinement.replacements
        : undefined}
      t={t}
    />
  )
})
