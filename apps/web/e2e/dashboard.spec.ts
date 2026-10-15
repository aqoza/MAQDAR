import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  deleteOrganizationRows,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { reportingDay } from '../src/lib/dashboard'

test('dashboard explains empty stock and offers an accessible daily table and audit history', async ({
  page,
}) => {
  const id = randomUUID()
  const email = `dashboard-${id}@example.com`
  const password = `Dashboard-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, { name: `Dashboard ${id}`, slug: `dash-${id}` })
  await expect(page.getByText(/No stock observations yet/)).toBeVisible()
  await page.getByText('View daily data', { exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(30)
  await expect(page.getByRole('img', { name: 'Demand over 30 days' })).toBeVisible()
  await page.getByRole('link', { name: 'Audit log', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible()
})

test('dashboard loads below two seconds with 50,000 items and 40 locations', async ({ page }) => {
  test.skip(
    process.env.DASHBOARD_SCALE !== '1',
    'Run against a production build with DASHBOARD_SCALE=1',
  )
  test.setTimeout(600_000)
  const id = randomUUID()
  const email = `dashboard-scale-${id}@example.com`
  const password = `Dashboard-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `dash-scale-${id}`
  await createOrganization(page, { name: `Dashboard scale ${id}`, slug })
  const org = await organizationIdBySlug(slug)
  const day = reportingDay(new Date(), 'Asia/Riyadh')
  const locations = Array.from({ length: 40 }, (_, n) => ({
    id: randomUUID(),
    organization_id: org,
    code: `L-${n}`,
    name_en: `Location ${n}`,
    location_type: 'branch',
    country_code: 'SA',
    timezone: 'Asia/Riyadh',
  }))
  const items = Array.from({ length: 50_000 }, (_, n) => ({
    id: randomUUID(),
    organization_id: org,
    code: `I-${n}`,
    name_en: `Item ${n}`,
    product_group: 'Scale',
    unit_of_measure: 'EA',
    unit_cost: '1.125',
    currency: 'SAR',
  }))
  try {
    await seedRows('locations', locations)
    await seedRows('items', items)
    await seedRows(
      'stock_snapshots',
      items.map((item, n) => ({
        organization_id: org,
        item_id: item.id,
        location_id: locations[n % 40]!.id,
        snapshot_date: day,
        quantity: n % 10 === 0 ? '0' : '2',
        unit_cost: '1.125',
        currency: 'SAR',
      })),
    )
    await seedRows(
      'demand_history',
      items.map((item, n) => ({
        organization_id: org,
        item_id: item.id,
        location_id: locations[n % 40]!.id,
        demand_date: day,
        quantity: '1',
      })),
    )
    for (let sample = 0; sample < 3; sample++) {
      const start = Date.now()
      await page.goto('/dashboard')
      await expect(page.getByText('101,250.000', { exact: false })).toBeVisible()
      await expect(page.getByRole('img', { name: 'Demand over 30 days' })).toBeVisible()
      await expect(page.locator('svg.recharts-surface[role="application"]')).toBeVisible()
      const elapsed = Date.now() - start
      console.log(
        `[dashboard-scale] 50,000 items, 40 locations, 50,000 stock rows, 50,000 demand rows: ${elapsed} ms`,
      )
      expect(elapsed).toBeLessThan(2000)
    }
    await expect(page.getByText('5,000', { exact: true })).toBeVisible()
    await expect(page.getByText('1,950,000', { exact: true })).toBeVisible()
    const filteredStart = Date.now()
    await page.goto(`/dashboard?day=${day}&location=L-1`)
    await expect(page.getByText('2,812.500', { exact: false })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Observed stock availability', exact: true }).locator('..'),
    ).toContainText('100%')
    const filteredElapsed = Date.now() - filteredStart
    console.log(`[dashboard-scale] location-filtered navigation: ${filteredElapsed} ms`)
    expect(filteredElapsed).toBeLessThan(2000)
  } finally {
    for (const table of ['stock_snapshots', 'demand_history', 'items', 'locations'])
      await deleteOrganizationRows(table, org)
  }
})
