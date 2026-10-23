import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import {
  PASSED,
  addFiles,
  batchById,
  continueButton,
  continueToCheck,
  countOf,
  deleteDemand,
  deleteRowsInSlices,
  openNewImport,
  removeOriginals,
  runCheck,
  stepButton,
  type BatchRow,
} from './helpers/imports'
import { createOrganization } from './helpers/organizations'

/*
 * Local evidence for docs/performance.md, not a CI test (SCALE=1 only): the large synthetic
 * master bundle (50,000 items, 64,843 supplier items, …) imported through the wizard into a
 * fresh organization, then a demand file of 1,000,000 rows (three months of the large preset,
 * trimmed to the per-import cap). Phase timings and the request and unit durations are logged;
 * the bounds are generous on purpose. The bundle comes from engine/data/large, generated with
 * `uv run zeespare-synth generate --preset large --out data/large` when missing (never loaded with
 * zeespare-synth). Everything the spec imported is deleted afterwards.
 */

test.skip(process.env.SCALE !== '1', 'Local evidence only: run with SCALE=1')

const ENGINE = path.resolve(__dirname, '..', '..', '..', 'engine')
const BUNDLE = path.join(ENGINE, 'data', 'large')
const MASTER_FILES = [
  'locations.csv',
  'brands.csv',
  'items.csv',
  'item_supersessions.csv',
  'suppliers.csv',
  'supplier_items.csv',
] as const
const DEMAND_MONTHS = ['2026-07', '2026-08', '2026-09'] as const
const DEMAND_ROWS = 1_000_000

const MASTER_BOUND_MS = 15 * 60_000
const DEMAND_BOUND_MS = 30 * 60_000

const run = Date.now()
const owner = { email: `imp-scale-${run}@example.com`, password: `Imp-scale-pass-${run}` }
const organization = { name: `Imports Scale ${run}`, slug: `imports-scale-${run}` }
let organizationId = ''

test.describe.configure({ mode: 'serial', timeout: 75 * 60_000 })

function note(label: string, value: string | number) {
  console.log(`[imports-scale] ${label}: ${value}`)
}

/** The large bundle, generated (not loaded) when it is missing. */
function ensureBundle(): void {
  if (existsSync(path.join(BUNDLE, 'items.csv'))) return
  execFileSync(
    process.env.UV ?? 'uv',
    ['run', 'zeespare-synth', 'generate', '--preset', 'large', '--out', 'data/large'],
    { cwd: ENGINE, stdio: 'inherit' },
  )
}

type Call = { kind: string; start: number; end: number | null; status: number | null }

/** Records every /api/imports request of the page with its wall time. */
function trackImportCalls(page: Page): Call[] {
  const calls: Call[] = []
  const open = new Map<Request, Call>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/imports')) return
    const method = request.method()
    const kind =
      method === 'POST' && url.pathname === '/api/imports'
        ? 'create'
        : url.pathname.includes('/chunks/')
          ? 'chunk'
          : url.pathname.endsWith('/seal')
            ? 'seal'
            : url.pathname.endsWith('/commit')
              ? 'commit'
              : 'other'
    const call: Call = { kind, start: Date.now(), end: null, status: null }
    open.set(request, call)
    calls.push(call)
  })
  const finish = async (request: Request) => {
    const call = open.get(request)
    if (!call) return
    call.end = Date.now()
    call.status = (await request.response())?.status() ?? null
    open.delete(request)
  }
  page.on('requestfinished', finish)
  page.on('requestfailed', finish)
  return calls
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0
}

function summarize(label: string, calls: Call[], kind: string): void {
  const own = calls.filter((call) => call.kind === kind && call.end !== null)
  if (own.length === 0) return
  const durations = own.map((call) => (call.end ?? call.start) - call.start).sort((a, b) => a - b)
  const span = Math.max(...own.map((call) => call.end ?? 0)) - Math.min(...own.map((c) => c.start))
  const statuses = [...new Set(own.map((call) => call.status))].join('/')
  note(
    `${label} ${kind} requests`,
    `${own.length} (status ${statuses}), span ${span} ms, p50 ${percentile(durations, 0.5)} ms, p95 ${percentile(durations, 0.95)} ms, max ${durations.at(-1)} ms`,
  )
}

function summarizeUnits(label: string, batch: BatchRow | null): void {
  const timings = batch?.progress?.timings ?? []
  if (timings.length === 0) return
  const sorted = timings.map((timing) => timing.ms).sort((a, b) => a - b)
  const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a))
  note(
    `${label} commit units`,
    `${batch?.progress?.steps ?? timings.length} steps (last ${timings.length} kept), p50 ${percentile(sorted, 0.5)} ms, p95 ${percentile(sorted, 0.95)} ms, slowest ${slowest.unit} ${slowest.ms} ms`,
  )
}

/** Runs one import through the wizard and logs its phases; returns the batch id. */
async function importThroughWizard(
  page: Page,
  label: string,
  files: string[],
  boundMs: number,
): Promise<string> {
  const calls = trackImportCalls(page)
  await openNewImport(page)
  const pickStarted = Date.now()
  await addFiles(page, files)
  note(
    `${label} files read for the wizard (hash, header, preview)`,
    `${Date.now() - pickStarted} ms`,
  )
  await continueToCheck(page)

  const checkStarted = Date.now()
  const batchId = await runCheck(page, boundMs)
  const checkMs = Date.now() - checkStarted
  await expect(page.getByText(PASSED)).toBeVisible()
  const create = calls.find((call) => call.kind === 'create')
  const chunks = calls.filter((call) => call.kind === 'chunk')
  const seals = calls.filter((call) => call.kind === 'seal')
  const lastSeal = Math.max(...seals.map((call) => call.end ?? 0))
  note(
    `${label} parse (count every row before the import is created)`,
    `${(create?.start ?? 0) - checkStarted} ms`,
  )
  note(
    `${label} stage (first chunk to last seal)`,
    `${lastSeal - (chunks[0]?.start ?? lastSeal)} ms`,
  )
  note(`${label} check in all`, `${checkMs} ms`)
  summarize(label, calls, 'create')
  summarize(label, calls, 'chunk')
  summarize(label, calls, 'seal')

  await continueButton(page).click()
  await expect(stepButton(page, 'Commit')).toHaveAttribute('aria-current', 'step')
  const commitStarted = Date.now()
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await expect(page.getByText('Import committed.', { exact: true })).toBeVisible({
    timeout: boundMs,
  })
  const commitMs = Date.now() - commitStarted
  note(`${label} commit`, `${commitMs} ms`)
  summarize(label, calls, 'commit')
  const batch = await batchById(batchId)
  note(`${label} commit mode`, batch?.commit_mode ?? 'none')
  note(`${label} counts`, JSON.stringify(batch?.counts ?? {}))
  summarizeUnits(label, batch)
  note(`${label} end to end`, `${checkMs + commitMs} ms`)
  expect(checkMs + commitMs).toBeLessThan(boundMs)
  expect(batch?.status).toBe('succeeded')
  return batchId
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(30 * 60_000)
  ensureBundle()
  await createConfirmedUser(owner.email, owner.password)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  organizationId = await organizationIdBySlug(organization.slug)
  await context.close()
})

test.afterAll(async () => {
  test.setTimeout(10 * 60_000)
  if (!organizationId) return
  await deleteDemand(organizationId)
  for (const table of [
    'supplier_items',
    'item_supersessions',
    'items',
    'suppliers',
    'brands',
    'locations',
  ]) {
    // Item deletion rechecks incoming FKs and writes an audit row per item. A 10,000-row
    // cleanup can exceed PostgREST's statement budget even after the import itself passed.
    await deleteRowsInSlices(table, organizationId, 'id', table === 'items' ? 100 : 10_000)
  }
  await removeOriginals(organizationId)
})

test('the large master bundle through the wizard', async ({ page }) => {
  await signInWithPassword(page, owner.email, owner.password)
  await importThroughWizard(
    page,
    'master',
    MASTER_FILES.map((file) => path.join(BUNDLE, file)),
    MASTER_BOUND_MS,
  )
  expect(await countOf('items', organizationId)).toBe(50_000)
  expect(await countOf('supplier_items', organizationId)).toBe(64_843)
  expect(await countOf('item_supersessions', organizationId)).toBe(1_812)
})

test('1,000,000 demand rows through the wizard', async ({ page }, testInfo) => {
  // Three months of the large preset, cut at the per-import cap.
  const lines: string[] = []
  let header = ''
  for (const month of DEMAND_MONTHS) {
    const [first = '', ...rows] = readFileSync(
      path.join(BUNDLE, 'demand_history', `${month}.csv`),
      'utf8',
    )
      .trimEnd()
      .split('\n')
    header ||= first
    for (const row of rows) {
      if (lines.length === DEMAND_ROWS) break
      lines.push(row)
    }
  }
  expect(lines.length).toBe(DEMAND_ROWS)
  const file = testInfo.outputPath('demand_history.csv')
  writeFileSync(file, `${header}\n${lines.join('\n')}\n`)
  note('demand file', `${DEMAND_ROWS} rows, ${Buffer.byteLength(lines.join('\n'))} bytes`)

  await signInWithPassword(page, owner.email, owner.password)
  await importThroughWizard(page, 'demand', [file], DEMAND_BOUND_MS)
  expect(await countOf('demand_history', organizationId)).toBe(DEMAND_ROWS)
})
