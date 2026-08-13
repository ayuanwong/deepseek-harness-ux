import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(fileURLToPath(new URL(
  '../src/client/chat/MessageIconActions.module.css', import.meta.url,
)), 'utf8')

describe('message IconActions hover contract', () => {
  it('keeps the invisible action strip hit-testable so its own first hover can reveal it', () => {
    const hoverRules = STYLES.match(/@media\s*\(hover:\s*hover\)\s*\{[\s\S]*?\n\}/u)?.[0]
    expect(hoverRules).toBeDefined()
    expect(hoverRules).toContain('opacity: 0')
    // pointer-events:none creates a deadlock: Playwright and a real pointer hit
    // the turn-tail parent instead of the invisible button, so :hover never
    // reaches the action strip that would enable it again.
    expect(hoverRules).not.toMatch(/pointer-events\s*:/u)
  })
})
