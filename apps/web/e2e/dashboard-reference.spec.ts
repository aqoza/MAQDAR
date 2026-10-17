import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('dashboard reference renders real scoped data at the reference viewports', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `dashboard-reference-${key}@example.com`
  const password = `Dashboard-${key}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `reference-${key}`
  await createOrganization(page, {
    name: 'Acme',
    slug,
    arabicEnabled: true,
    homeCountry: 'AE',
    baseCurrency: 'USD',
  })
  const organization = await organizationIdBySlug(slug)
  const locations = ['DXB', 'LHR', 'JFK', 'SIN', 'FRA'].map((code, index) => ({
    id: randomUUID(),
    organization_id: organization,
    code,
    name_en: ['Dubai', 'London', 'New York', 'Singapore', 'Frankfurt'][index],
    location_type: 'branch',
    country_code: 'AE',
    timezone: 'Asia/Dubai',
  }))
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: randomUUID(),
    organization_id: organization,
    code: `REF-${String(index).padStart(3, '0')}`,
    name_en: `Reference part ${index}`,
    product_group: 'Reference',
    unit_of_measure: 'EA',
    unit_cost: '351.955',
    currency: 'USD',
  }))
  await seedRows('locations', locations)
  await seedRows('items', items)
  await seedRows(
    'stock_snapshots',
    locations.flatMap((location, locationIndex) =>
      items.slice(0, 100).map((item, itemIndex) => ({
        organization_id: organization,
        item_id: item.id,
        location_id: location.id,
        snapshot_date: '2026-10-17',
        quantity: itemIndex < [92, 76, 68, 64, 58][locationIndex] ? '10' : '0',
        unit_cost: '351.955',
        currency: 'USD',
        unit_of_measure: 'EA',
      })),
    ),
  )
  const sold = [
    31, 43, 38, 59, 44, 29, 43, 46, 43, 38, 55, 53, 38, 42, 32, 62, 47, 49, 51, 76, 61, 46, 51, 48,
    65, 79, 67, 66, 69, 72,
  ]
  const lost = [
    6, 8, 14, 7, 7, 12, 10, 8, 6, 8, 9, 15, 20, 12, 15, 9, 6, 9, 11, 12, 16, 14, 14, 11, 13, 8, 10,
    9, 16, 19,
  ]
  await seedRows(
    'demand_history',
    sold.map((quantity, index) => ({
      organization_id: organization,
      item_id: items[0].id,
      location_id: locations[0].id,
      demand_date: new Date(Date.UTC(2026, 8, 18 + index)).toISOString().slice(0, 10),
      quantity: String(quantity),
      lost_sales_quantity: String(lost[index]),
      unit_of_measure: 'EA',
    })),
  )
  await page.goto('/dashboard?day=2026-10-17')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.locator('svg.recharts-surface[role="application"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.dashboard-metric')).toHaveCount(5)
  await expect(page.locator('.dashboard-metric').first()).toContainText('71.6%')
  await expect(page.locator('.dashboard-risk-empty')).toBeVisible()
  await expect(page.locator('.dashboard-location-table tbody tr')).toHaveCount(5)
  for (const [width, height] of [
    [1672, 941],
    [1648, 928],
  ]) {
    await page.setViewportSize({ width, height })
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1)
    const capturePath = testInfo.outputPath(
      `dashboard-${process.env.DASHBOARD_CAPTURE ?? 'reference'}-${width}.png`,
    )
    await page.screenshot({ path: capturePath, fullPage: false })
    await testInfo.attach(`dashboard-${width}`, {
      path: capturePath,
      contentType: 'image/png',
    })
    const strip = await page.locator('.dashboard-metrics').boundingBox()
    expect(strip?.height).toBe(107)
    // The approved compact heading reclaims 27px above the original reference composition.
    expect(strip?.y).toBeCloseTo(222, 0)
    expect((await page.locator('.dashboard-demand').boundingBox())?.height).toBe(280)
  }
  await page.setViewportSize({ width: 1672, height: 941 })
  await writeFile(
    testInfo.outputPath('dashboard-environment.json'),
    JSON.stringify(
      await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        devicePixelRatio: devicePixelRatio,
        locale: document.documentElement.lang,
        font: getComputedStyle(document.body).fontFamily,
        regions: Object.fromEntries(
          [
            '.dashboard-filters',
            '.dashboard-metrics',
            '.dashboard-demand',
            '.dashboard-locations',
            '.dashboard-risk',
            '.dashboard-insights',
            '.dashboard-information',
          ].map((selector) => {
            const bounds = document.querySelector(selector)!.getBoundingClientRect()
            return [
              selector,
              { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            ]
          }),
        ),
      })),
      null,
      2,
    ) + '\n',
  )
  await page.locator('.recharts-area-dots circle').last().hover()
  await expect(page.locator('.recharts-tooltip-wrapper')).toContainText('2026-10-17')
  await expect(page.locator('.recharts-tooltip-wrapper')).toContainText('72')
  await page.screenshot({ path: testInfo.outputPath('dashboard-tooltip-1672.png') })
  await page.locator('.dashboard-currencies summary').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.dashboard-currency-popover')).toContainText('1,259,998.900')
  await page.keyboard.press('Enter')
  await page.locator('.dashboard-location-table').getByRole('link', { name: 'DXB – Dubai' }).click()
  await expect(page).toHaveURL(/day=2026-10-17&location=DXB/)
  await expect(page.locator('.dashboard-metric').first()).toContainText('92%')
  await expect(page.locator('.dashboard-location-table tbody tr')).toHaveCount(1)
  await expect(
    page.getByRole('link', { name: 'Saved forecast quality', exact: true }),
  ).toHaveAttribute('href', '/forecasts/quality?location=DXB')
  await expect(page.locator('.dashboard-information')).toHaveAttribute(
    'href',
    '/forecasts/quality?location=DXB',
  )
  await page.goto('/dashboard?day=2026-10-17')
  await expect(page.locator('.dashboard-location-table tbody tr')).toHaveCount(5)
  await expect(page.locator('.dashboard-location-table')).toBeVisible()
  await page.setViewportSize({ width: 375, height: 900 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.locator('.dashboard-currencies summary').click()
  await expect(page.locator('.dashboard-currency-popover')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.locator('.dashboard-currencies summary').click()
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-375.png'), fullPage: true })
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto('/dashboard?day=2026-10-17')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('.dashboard-metric')).toHaveCount(5)
  await expect(page.locator('.dashboard-metric').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.screenshot({ path: testInfo.outputPath('dashboard-arabic-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1672, height: 941 })
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(1672)
  await page.screenshot({ path: testInfo.outputPath('dashboard-arabic-1672.png') })
  // Add a second physical-stock currency after the stable visual captures.
  await seedRows('stock_snapshots', [
    {
      organization_id: organization,
      item_id: items[100].id,
      location_id: locations[0].id,
      snapshot_date: '2026-10-17',
      quantity: '2',
      unit_cost: '1.125',
      currency: 'KWD',
      unit_of_measure: 'EA',
    },
  ])
  await page.reload()
  await page.locator('.dashboard-currencies summary').click()
  await expect(page.locator('.dashboard-currency-popover')).toContainText('2.250')
  await page.locator('.dashboard-currency-popover select').selectOption('USD')
  await expect(page.locator('.dashboard-currencies summary')).toContainText('USD')
  await page.locator('.dashboard-currency-popover select').selectOption('KWD')
  await expect(page.locator('.dashboard-currencies summary')).toContainText('KWD')
  await expect(page.locator('.dashboard-currencies summary')).toContainText('2.250')
  await expect(page.locator('.dashboard-currency-popover li')).toHaveCount(2)
  if (process.env.DASHBOARD_FAULT_CAPTURE === '1') {
    // Local-only failure drills reuse this session; test-results is ignored and never published.
    await page.context().storageState({ path: testInfo.outputPath('dashboard-session.json') })
  }
})
