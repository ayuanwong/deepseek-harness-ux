// Web e2e: the Ungrouped row's create affordance births and selects a blank
// Session without inheriting a Workspace account. The scenario owns an
// isolated scaffold because the created blank is deliberately durable and
// would otherwise alter later shared-sidebar scenarios.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/workspace-ungrouped-create', import.meta.url))
const EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const SEED_ID = 'workspace-ungrouped-create-web-e2e'
const MODE = webSnapshotMode()

describe('web e2e: Ungrouped Session creation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('creates and selects a Session outside every Workspace account', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ws-ungrouped-create'))
    const before = new Set((await scaffold.ctx.sessionPersistence.list()).map(header => header.id))
    const ungroupedRow = page.getByText('Ungrouped', { exact: true }).locator('..').locator('..')
    await ungroupedRow.hover()
    await ungroupedRow.getByRole('button', { name: 'New session in Ungrouped' }).click()

    let created: SessionId | undefined
    await expect.poll(async () => {
      const headers = await scaffold.ctx.sessionPersistence.list()
      const id = headers.find(header => !before.has(header.id))?.id
      created = id === undefined ? undefined : SessionId(id)
      return created
    }, { timeout: 10_000 }).toBeDefined()
    if (created === undefined) throw new Error('Ungrouped create did not persist a Session')
    const createdId = created
    expect(scaffold.ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(createdId))).toBe(false)
    await expect.poll(() => page.locator('[role="treeitem"][aria-selected="true"]').count(), { timeout: 10_000 }).toBe(1)

    const snapshot = await captureStableAria(page, '[role="tree"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('owns only its sidebar golden and uses no model fixture', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['sidebar.expected.md'])
  })
})
