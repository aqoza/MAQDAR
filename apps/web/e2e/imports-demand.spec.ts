import { expect as baseExpect, test } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import {
  DEMAND_START,
  PASSED,
  addFiles,
  arabicIndic,
  batchById,
  commitFromCheck,
  continueButton,
  continueToCheck,
  countOf,
  deleteDemand,
  demandFile,
  demandItemsFile,
  demandLocationsFile,
  expectCounts,
  filesOf,
  isoDay,
  openNewImport,
  removeOriginals,
  rowsOf,
  runCheck,
  serviceClient,
  stepButton,
  textFile,
  waitFor,
  type BatchRow,
} from './helpers/imports'
import { createOrganization } from './helpers/organizations'

/*
 * Demand history through the wizard: 100,000 generated rows for 25 parts at 4 locations (created
 * by an import first) take the stepped commit path; a correction file of zero rows deletes days
 * and skips days that hold nothing; a stepped commit whose tab closed is resumed from the
 * import's page. The demand rows and originals are removed afterwards.
 */

const expect = baseExpect.configure({ timeout: 15_000 })

const run = Date.now()
const owner = { email: `imp-demand-${run}@example.com`, password: `Imp-demand-pass-${run}` }
const organization = { name: `Imports Demand ${run}`, slug: `imports-demand-${run}` }

test.describe.configure({ mode: 'serial', timeout: 300_000 })

let organizationId = ''

/** Logs a timing for the PR notes. */
function note(label: string, value: string | number) {
  console.log(`[imports-demand] ${label}: ${value}`)
}

function slowestUnit(batch: BatchRow | null) {
  const timings = batch?.progress?.timings ?? []
  return timings.reduce<{ unit: string; ms: number } | null>(
    (slowest, timing) => (!slowest || timing.ms > slowest.ms ? timing : slowest),
    null,
  )
}

/** Demand rows of the organization on one day. */
async function rowsOnDay(day: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from('demand_history')
    .select('organization_id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('demand_date', day)
  if (error) throw new Error(error.message)
  return count ?? 0
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  await createConfirmedUser(owner.email, owner.password)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  organizationId = await organizationIdBySlug(organization.slug)
  await context.close()
})

test.beforeEach(async ({ page }) => {
  await signInWithPassword(page, owner.email, owner.password)
})

test.afterAll(async () => {
  test.setTimeout(120_000)
  if (!organizationId) return
  await deleteDemand(organizationId)
  await removeOriginals(organizationId)
})

test('locations and parts for the demand come from one import', async ({ page }) => {
  await openNewImport(page)
  await addFiles(page, [demandItemsFile(), demandLocationsFile()])
  await continueToCheck(page)
  await runCheck(page)
  await expect(
    page.getByText('Every file passed: 29 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()
  await commitFromCheck(page)
  await expectCounts(page, 'Locations', { inserted: 4 })
  await expectCounts(page, 'Items', { inserted: 25 })
  // The parents set in the second pass get a column of their own.
  await expect(
    page.getByRole('columnheader', { name: 'Parents changed', exact: true }),
  ).toBeVisible()

  const locations = await rowsOf<{ id: string; code: string; parent_location_id: string | null }>(
    'locations',
    organizationId,
    'id, code, parent_location_id',
    'code',
  )
  const central = locations.find((location) => location.code === 'RUH-DC')
  expect(central?.parent_location_id).toBeNull()
  expect(locations.filter((location) => location.parent_location_id === central?.id).length).toBe(3)
})

test('100,000 demand rows are checked and committed in steps', async ({ page }) => {
  const file = demandFile('demand_history.csv', DEMAND_START, 1_000)
  note('demand file', `${file.buffer.length} bytes`)
  await openNewImport(page)
  await addFiles(page, [file])
  await continueToCheck(page)

  const checkStarted = Date.now()
  const batchId = await runCheck(page, 240_000)
  note('check (read twice, create, stage, seal)', `${Date.now() - checkStarted} ms`)
  await expect(
    page.getByText('Every file passed: 100,000 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()

  await continueButton(page).click()
  await expect(stepButton(page, 'Commit')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText(/^Larger imports are committed in steps/)).toBeVisible()
  const commitStarted = Date.now()
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await expect(page.getByText('Import committed.', { exact: true })).toBeVisible({
    timeout: 240_000,
  })
  note('commit', `${Date.now() - commitStarted} ms`)
  await expectCounts(page, 'Demand history', { inserted: 100_000 })

  const batch = await batchById(batchId)
  expect(batch?.status).toBe('succeeded')
  expect(batch?.commit_mode).toBe('stepped')
  expect(batch?.progress?.steps ?? 0).toBeGreaterThan(1)
  const slowest = slowestUnit(batch)
  note('commit steps', batch?.progress?.steps ?? 0)
  note('slowest unit', slowest ? `${slowest.unit} ${slowest.ms} ms` : 'none')
  expect(await countOf('demand_history', organizationId)).toBe(100_000)

  await page.getByRole('link', { name: 'View this import', exact: true }).click()
  await page.waitForURL(new RegExp(`/imports/${batchId}$`))
  await expect(page.locator('dl')).toContainText('Imported')
  await expect(page.locator('dl')).toContainText('In steps')
})

test('a correction of zero rows deletes stored days and skips days without demand', async ({
  page,
}) => {
  const day0 = DEMAND_START
  const day1 = isoDay(DEMAND_START, 1)
  const empty = '2022-12-31'
  const lines = ['item_code,location_code,demand_date,quantity,lost_sales_quantity']
  // Five parts at the central warehouse on the first two days: both quantities 0 (written with
  // Arabic-Indic digits, as an Arabic Excel export may have them).
  for (const day of [day0, day1]) {
    for (let part = 1; part <= 5; part += 1) {
      lines.push(`D-000${part},RUH-DC,${arabicIndic(day)},٠,٠`)
    }
  }
  lines.push(`D-0001,JED-01,${empty},0,0`, `D-0002,JED-01,${empty},0,0`)
  const file = textFile('demand_history.csv', `\uFEFF${lines.join('\r\n')}\r\n`)

  expect(await rowsOnDay(day0)).toBe(100)
  await openNewImport(page)
  await addFiles(page, [file])
  await continueToCheck(page)
  await runCheck(page)
  await expect(page.getByText(PASSED)).toBeVisible()
  await expect(page.getByText(/2 warnings: the rows can still be committed\./)).toBeVisible()
  await expect(
    page.getByText('Both quantities are 0 for a day without demand; the row was skipped.'),
  ).toBeVisible()
  await commitFromCheck(page)
  await expectCounts(page, 'Demand history', { deleted: 10, skipped: 2 })

  expect(await rowsOnDay(day0)).toBe(95)
  expect(await rowsOnDay(day1)).toBe(95)
  expect(await rowsOnDay(empty)).toBe(0)
  expect(await countOf('demand_history', organizationId)).toBe(99_990)
})

test('a stepped commit whose tab closed is resumed from the import page', async ({
  page,
  context,
}) => {
  // 300 later days: 30,000 new rows, more than one atomic commit takes.
  const file = demandFile('demand_history.csv', DEMAND_START, 300, 1_000)
  await openNewImport(page)
  await addFiles(page, [file])
  await continueToCheck(page)
  const batchId = await runCheck(page, 180_000)
  await expect(
    page.getByText('Every file passed: 30,000 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()
  await continueButton(page).click()
  await expect(stepButton(page, 'Commit')).toHaveAttribute('aria-current', 'step')

  // Tiny merge units (the client's own max_rows knob) keep this commit going for longer than one
  // request, so closing the tab really leaves it half done.
  await page.route('**/api/imports/*/commit', (route) =>
    route.continue({ postData: JSON.stringify({ max_rows: 5 }) }),
  )
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await waitFor(
    () => filesOf(batchId),
    (files) => (files[0]?.merged_through_row ?? 0) > 0,
    { what: 'the first merged rows' },
  )
  await page.close()

  // The request the tab left behind runs out its time budget on the server; then nothing moves.
  let lastStep: string | null = null
  let quietSince = Date.now()
  const settled = await waitFor(
    () => batchById(batchId),
    (batch) => {
      if (batch?.last_step_at !== lastStep) {
        lastStep = batch?.last_step_at ?? null
        quietSince = Date.now()
        return false
      }
      return Date.now() - quietSince >= 3_000
    },
    { timeoutMs: 90_000, intervalMs: 500, what: 'the abandoned commit to stop' },
  )
  const [merged] = await filesOf(batchId)
  note('rows merged before the tab closed and the request ended', merged?.merged_through_row ?? 0)
  expect(settled?.status).toBe('committing')
  expect(merged?.merged_through_row ?? 0).toBeGreaterThan(0)
  expect(merged?.merged_through_row ?? 0).toBeLessThan(30_000)

  // The import's page shows the partial state and continues the commit without the file.
  const resumed = await context.newPage()
  await resumed.goto(`/imports/${batchId}`)
  await expect(resumed.locator('dl')).toContainText('Committing')
  await expect(resumed.getByText('Partially applied', { exact: true })).toBeVisible()
  await expect(
    resumed.getByText(/The commit is running, or its tab was closed\. Continue it here/),
  ).toBeVisible()
  await resumed.getByRole('button', { name: 'Continue commit', exact: true }).click()
  await expect(resumed.locator('dl')).toContainText('Imported', { timeout: 120_000 })
  await expect(resumed.getByText('Partially applied', { exact: true })).toHaveCount(0)
  await expectCounts(resumed, 'Demand history', { inserted: 30_000 })

  const batch = await batchById(batchId)
  expect(batch?.status).toBe('succeeded')
  expect(batch?.commit_mode).toBe('stepped')
  expect(await countOf('demand_history', organizationId)).toBe(129_990)
})
