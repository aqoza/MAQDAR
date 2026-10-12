import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createConfirmedUser,
  deleteOrganizationRows,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { listRow, pagerSummary, searchList } from './helpers/master-data'
import { createOrganization } from './helpers/organizations'

/*
 * The items list at 50,000 rows: the total, a sort by name, the last page and a search, each one
 * server-rendered navigation timed from the click to the rows on screen. The bound is generous
 * (15 s, dev server included) so the spec catches a broken query plan, not a slow laptop; the
 * timings are logged for the PR. Items are seeded with the service role on the local stack only.
 */

const run = Date.now()
const owner = { email: `scale-owner-${run}@example.com`, password: `Scale-pass-${run}` }
const organization = { name: `Scale Org ${run}`, slug: `scale-${run}` }

const TOTAL = 50_000
const BATCH = 1_000
const NAVIGATION_BOUND_MS = 15_000
// Distinct first letters and zero-padded numbers sort the same under any collation, so the first
// name is "Air filter 000010" (P-000010) and the last "Jack stand 049999" (P-049999).
const NAMES = [
  'Air filter',
  'Brake pad',
  'Clutch disc',
  'Drive belt',
  'Engine mount',
  'Fuel pump',
  'Gasket set',
  'Headlamp',
  'Ignition coil',
  'Jack stand',
] as const
const GROUPS = ['Filters', 'Brakes', 'Engine', 'Electrical', 'Body'] as const

let organizationId: string | null = null

function pad(value: number): string {
  return String(value).padStart(6, '0')
}

function seedItems(id: string): Record<string, unknown>[] {
  return Array.from({ length: TOTAL }, (_, index) => {
    const n = index + 1
    return {
      organization_id: id,
      code: `P-${pad(n)}`,
      name_en: `${NAMES[n % NAMES.length]} ${pad(n)}`,
      product_group: GROUPS[n % GROUPS.length],
      unit_of_measure: 'EA',
      unit_cost: ((n % 997) * 1.25 + 0.5).toFixed(3),
      currency: 'SAR',
      status: 'active',
    }
  })
}

/** Runs `action`, waits until `ready` is visible and returns the elapsed milliseconds. */
async function timed(label: string, action: () => Promise<unknown>, ready: Locator) {
  const started = Date.now()
  await action()
  await expect(ready).toBeVisible({ timeout: NAVIGATION_BOUND_MS })
  const elapsed = Date.now() - started
  console.log(`[master-data-scale] ${label}: ${elapsed} ms`)
  expect(elapsed, `${label} took ${elapsed} ms`).toBeLessThan(NAVIGATION_BOUND_MS)
  return elapsed
}

function firstRow(page: Page): Locator {
  return page.locator('tbody tr').first()
}

test.afterAll(async () => {
  test.setTimeout(120_000)
  // 50,000 rows per run would pile up in the local database.
  if (organizationId) await deleteOrganizationRows('items', organizationId)
})

test('the items list stays fast at 50,000 items', async ({ page }) => {
  test.setTimeout(300_000)

  await createConfirmedUser(owner.email, owner.password)
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  organizationId = await organizationIdBySlug(organization.slug)

  // Compile the route on the dev server before anything is timed (the list is empty here).
  await page.goto('/items')
  await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible({
    timeout: 60_000,
  })

  const seedStarted = Date.now()
  await seedRows('items', seedItems(organizationId), BATCH)
  console.log(`[master-data-scale] seeded ${TOTAL} items in ${Date.now() - seedStarted} ms`)

  await timed(
    'first page with exact total',
    () => page.goto('/items'),
    page.getByText('50,000 rows · Page 1 of 2,000', { exact: true }),
  )
  await expect(firstRow(page)).toContainText('P-000001')

  // Sort by name through the column header.
  const nameHeader = page.getByRole('columnheader', { name: 'Name' })
  await timed(
    'sort by name',
    async () => {
      await nameHeader.getByRole('link').click()
      await page.waitForURL((url) => url.searchParams.get('sort') === 'name_en')
    },
    firstRow(page).filter({ hasText: 'Air filter 000010' }),
  )
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(firstRow(page)).toContainText('P-000010')

  // Jump to the last page with the pager.
  await timed(
    'last page',
    async () => {
      await page.getByRole('link', { name: 'Last page', exact: true }).click()
      await page.waitForURL((url) => url.searchParams.get('page') === '2000')
    },
    page.getByText('50,000 rows · Page 2,000 of 2,000', { exact: true }),
  )
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await expect(page.locator('tbody tr').last()).toContainText('P-049999')
  await expect(page.locator('tbody tr').last()).toContainText('Jack stand 049999')

  // Search by part code: exactly one row (the sort is kept, the page is reset).
  await timed(
    'search P-049999',
    () => searchList(page, 'P-049999'),
    page.getByText('1 row · Page 1 of 1', { exact: true }),
  )
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(listRow(page, 'P-049999')).toContainText('Jack stand 049999')
  await expect(pagerSummary(page)).toHaveText('1 row · Page 1 of 1')
})
