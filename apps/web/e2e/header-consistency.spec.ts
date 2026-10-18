import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

type Route = { name: string; path: string; pattern: string }
type Chain = {
  lines: { proposal: string; handoff: string; scenario: string; estimate: string }[]
  draft: string
  redistribution: string
  policy: string
  item: string
  location: string
  source: string
  supplier: string
  delivery: string
  estimate: string
  malformedPolicyRun: string
}
type EventChain = {
  forecast: string
  run: string
  policy: string
  policy_run: string
  event: string
  eventPolicy: string
  draft: string
  eventSupplier: string
  eventDelivery: string
  eventCost: string
  proposal: string
  handoff: string
}

async function workspace(page: Page) {
  const key = randomUUID()
  const email = `header-${key}@example.com`
  const password = `Header-${key}`
  const user = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`approver-${key}@example.com`, password)
  await signInWithPassword(page, email, password)
  const slug = `header-${key}`
  await createOrganization(page, { name: 'Header QA', slug, arabicEnabled: true })
  return { user, approver, organization: await organizationIdBySlug(slug) }
}

async function fixture<T>(name: string, args: string[]): Promise<T> {
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const result = await promisify(execFile)(
    'uv',
    ['run', 'python', resolve('e2e/fixtures', name), dsn, ...args],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  return JSON.parse(result.stdout.trim())
}

async function arabic(page: Page) {
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
}

async function header(page: Page, route: Route) {
  await page.goto(route.path)
  const heading = page.locator('main h1').filter({ hasText: /\S/ })
  await expect(heading).toHaveCount(1)
  await expect(heading).toBeVisible()
  await expect(heading).not.toHaveText(
    /Page not found|Unable to load this page|تعذّر تحميل|الصفحة غير موجودة/,
  )
  const banner = page.locator(`[data-page-banner="${route.pattern}"]`)
  await expect(banner).toHaveCount(1)
  await expect(heading).toHaveCSS('font-size', '20px')
  await expect(heading).toHaveCSS('line-height', '28px')
  await expect(heading).toHaveCSS('font-weight', '600')
  const family = await page.locator('html').evaluate((node) => getComputedStyle(node).fontFamily)
  await expect(heading).toHaveCSS('font-family', family)
  for (const subtitle of await banner.locator('.page-heading-copy > p').all()) {
    await expect(subtitle).toHaveCSS('font-size', '14px')
    await expect(subtitle).toHaveCSS('line-height', '20px')
  }
  for (const label of await page.locator('[data-sidebar="menu-button"]:visible').all()) {
    await expect(label).toHaveCSS('font-size', '14px')
    await expect(label).toHaveCSS('line-height', '20px')
    await expect(label).toHaveCSS('font-family', family)
  }
  for (const link of await banner.locator('.page-back a, .page-actions > a').all()) {
    await expect(link).toHaveCSS('font-size', '14px')
    await expect(link).toHaveCSS('line-height', '20px')
  }
  for (const caption of await banner.locator('.help-disclosure > summary').all()) {
    await expect(caption).toHaveCSS('font-size', '12px')
    await expect(caption).toHaveCSS('line-height', '16px')
  }
  const viewport = page.viewportSize()!
  const input = page
    .locator('main input:not([type="hidden"], [type="checkbox"], [type="radio"]):visible')
    .first()
  if (await input.count()) {
    await expect(input).toHaveCSS('font-size', viewport.width < 768 ? '16px' : '14px')
    await expect(input).toHaveCSS('line-height', viewport.width < 768 ? '24px' : '20px')
  }
  for (const metric of await page.locator('main .text-metric:visible').all()) {
    await expect(metric).toHaveCSS('font-size', '28px')
    await expect(metric).toHaveCSS('line-height', '36px')
  }
  const bounds = (await heading.boundingBox())!
  const tagline = (await page.locator('header > span').boundingBox())!
  expect(bounds.y - (tagline.y + tagline.height)).toBeLessThanOrEqual(12)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
  const background = (await banner.locator('.page-banner-backdrop').boundingBox())!
  expect(background.y).toBe(0)
  // Workspace tabs intentionally scroll locally; title/back/action controls must fit the page.
  for (const link of await banner.locator('.page-actions a').all()) {
    if (!(await link.isVisible())) continue
    const box = (await link.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    if (viewport.width < 768) expect(box.height).toBeGreaterThanOrEqual(44)
  }
  for (const navigation of await banner.locator('.workspace-navigation').all()) {
    const box = (await navigation.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    await expect(navigation).toHaveCSS('overflow-x', 'auto')
    for (const link of await navigation.locator('a').all()) {
      await expect(link).toHaveCSS('font-size', '14px')
      await expect(link).toHaveCSS('line-height', '20px')
      if (viewport.width < 768)
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
  }
}

async function matrix(page: Page, routes: Route[], testInfo: TestInfo) {
  for (const locale of ['en', 'ar']) {
    if (locale === 'ar') await arabic(page)
    for (const width of locale === 'en' ? [1920, 1366, 375] : [1366, 375]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
      for (const route of routes) {
        await header(page, route)
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: testInfo.outputPath(`${route.name}-${locale}-${width}.png`) })
        const typography = await page.evaluate(() => {
          const selectors = [
            'main h1',
            '.page-heading-copy > p',
            '[data-sidebar="menu-button"]',
            'main input:not([type="hidden"])',
            'main .text-metric',
            'main .help-disclosure > summary',
            'main [data-slot="button"]',
            'main p.text-section-title, main dd.text-section-title',
          ]
          return selectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)]
              .filter((node) => node.getBoundingClientRect().height > 0)
              .map((node) => {
                const css = getComputedStyle(node)
                return {
                  selector,
                  text: node.textContent?.trim(),
                  size: css.fontSize,
                  lineHeight: css.lineHeight,
                  weight: css.fontWeight,
                  family: css.fontFamily,
                }
              }),
          )
        })
        await writeFile(
          testInfo.outputPath(`${route.name}-${locale}-${width}-type.json`),
          JSON.stringify(typography, null, 2),
        )
      }
    }
  }
}

test('transfer detail uses the shared replenishment header', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const owner = await workspace(page)
  const data = await fixture<Chain>('header-transfer.py', [
    owner.organization,
    owner.user,
    owner.approver,
  ])
  await page.goto(`/replenishment/redistribution/review/${data.lines[0].proposal}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Transfer proposal · BATCH-1' }),
  ).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: testInfo.outputPath('transfer-proposal-en-1366.png') })
  await expect(page.locator('[data-page-banner="replenishment"]')).toHaveCount(1)
  const routes = [
    {
      name: 'transfer-proposal',
      path: `/replenishment/redistribution/review/${data.lines[0].proposal}`,
    },
    { name: 'transfer-draft', path: `/replenishment/redistribution/${data.redistribution}` },
    {
      name: 'transfer-dates',
      path: `/replenishment/redistribution/dates/${data.lines[0].scenario}`,
    },
    {
      name: 'transfer-freight',
      path: `/replenishment/redistribution/freight/${data.lines[0].estimate}`,
    },
    {
      name: 'transfer-handoff',
      path: `/replenishment/redistribution/handoffs/${data.lines[0].handoff}`,
    },
    { name: 'transfer-create', path: `/replenishment/redistribution/new?draft=${data.draft}` },
    {
      name: 'transfer-dates-create',
      path: `/replenishment/redistribution/dates/new?draft=${data.redistribution}`,
    },
    {
      name: 'transfer-freight-create',
      path: `/replenishment/redistribution/freight/new?scenario=${data.lines[0].scenario}`,
    },
    { name: 'transfer-batch-create', path: '/replenishment/redistribution/batches/new' },
    {
      name: 'transfer-batch-preview',
      path: `/replenishment/redistribution/batches/preview?handoff=${data.lines[0].handoff}`,
    },
  ].map((route) => ({ ...route, pattern: 'replenishment' }))
  for (const route of routes) await header(page, route)
  await header(page, {
    name: 'transfer-selection-invalid',
    path: '/replenishment/redistribution/batches/new?handoff=invalid',
    pattern: 'replenishment',
  })
  await header(page, {
    name: 'transfer-preview-invalid',
    path: '/replenishment/redistribution/batches/preview',
    pattern: 'replenishment',
  })
  await matrix(page, [routes[0], routes[6]], testInfo)
  await page.setViewportSize({ width: 1366, height: 768 })
  await header(page, routes[0])
  const back = page.locator('.page-back a')
  await back.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/replenishment\/redistribution\/review$/)
  await expect(page.locator('[data-page-banner="replenishment"]')).toHaveCount(1)

  // The original transfer fixture deliberately has only minimal policy evidence. Its full
  // evidence page exercises the generic error boundary, never a fabricated production metric.
  await page.goto(`/forecasts/policies/${data.malformedPolicyRun}`)
  await expect(
    page.getByRole('heading', { name: 'تعذّر تحميل هذه الصفحة', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-page-banner="forecasts"]')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('forecast-error-ar-1366.png') })
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/forecasts/policies/${data.malformedPolicyRun}`,
    ),
    page.getByRole('button', { name: 'حاول مرة أخرى', exact: true }).click(),
  ])
  await expect(
    page.getByRole('heading', { name: 'تعذّر تحميل هذه الصفحة', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'العودة إلى لوحة التحكم', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('ordinary purchase details, creation and previews retain the section header', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const owner = await workspace(page)
  const data = await fixture<Chain>('header-purchasing.py', [
    owner.organization,
    owner.user,
    owner.approver,
  ])
  const routes = [
    { name: 'purchase-draft', path: `/replenishment/${data.draft}` },
    { name: 'purchase-supplier', path: `/replenishment/suppliers/${data.supplier}` },
    { name: 'purchase-delivery', path: `/replenishment/deliveries/${data.delivery}` },
    { name: 'purchase-cost', path: `/replenishment/costs/${data.estimate}` },
    { name: 'purchase-proposal', path: `/replenishment/review/${data.lines[0].proposal}` },
    { name: 'purchase-handoff', path: `/replenishment/handoffs/${data.lines[0].handoff}` },
    { name: 'purchase-batch-create', path: '/replenishment/batches/new' },
    { name: 'purchase-batch-invalid', path: '/replenishment/batches/new?handoff=invalid' },
    {
      name: 'purchase-batch-preview',
      path: `/replenishment/batches/preview?handoff=${data.lines[0].handoff}`,
    },
    { name: 'purchase-supplier-create', path: `/replenishment/suppliers/new?draft=${data.draft}` },
    {
      name: 'purchase-delivery-create',
      path: `/replenishment/deliveries/new?scenario=${data.supplier}`,
    },
    { name: 'purchase-cost-create', path: `/replenishment/costs/new?delivery=${data.delivery}` },
  ].map((route) => ({ ...route, pattern: 'replenishment' }))
  for (const route of routes) await header(page, route)
  await header(page, {
    name: 'purchase-preview-invalid',
    path: '/replenishment/batches/preview',
    pattern: 'replenishment',
  })
  await matrix(page, [routes[4], routes[11]], testInfo)
})

test('forecast and event details, lists and forms retain their section headers', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const owner = await workspace(page)
  const data = await fixture<EventChain>('header-events.py', [
    owner.organization,
    owner.user,
    owner.approver,
  ])
  const forecastRoutes = [
    { name: 'forecast-results', path: `/forecasts/results/${data.run}` },
    { name: 'policy-evidence', path: `/forecasts/policies/${data.policy_run}` },
    { name: 'policy-detail', path: `/forecasts/workbench/${data.policy}` },
    {
      name: 'policy-stock',
      path: `/forecasts/workbench/${data.policy}/stock?basis=calculated&day=2026-10-10`,
    },
    { name: 'forecast-create', path: '/forecasts/new' },
    { name: 'classification-create', path: '/forecasts/classify' },
    { name: 'preparation-create', path: '/forecasts/prepare' },
    { name: 'forecast-quality', path: '/forecasts/quality' },
    { name: 'event-list', path: `/forecasts/events?forecast=${data.forecast}` },
    { name: 'event-create', path: `/forecasts/events/new?forecast=${data.forecast}` },
    { name: 'event-detail', path: `/forecasts/events/${data.event}` },
    { name: 'event-policy-list', path: `/forecasts/events/policies?event=${data.event}` },
    {
      name: 'event-policy-create',
      path: `/forecasts/events/policies/new?event=${data.event}&policy=${data.policy}`,
    },
    { name: 'event-policy-detail', path: `/forecasts/events/policies/${data.eventPolicy}` },
  ].map((route) => ({ ...route, pattern: 'forecasts' }))
  const purchaseRoutes = [
    { name: 'event-draft', path: `/replenishment/events/${data.draft}` },
    { name: 'event-draft-create', path: `/replenishment/events/new?scenario=${data.eventPolicy}` },
    { name: 'event-supplier', path: `/replenishment/events/suppliers/${data.eventSupplier}` },
    {
      name: 'event-supplier-create',
      path: `/replenishment/events/suppliers/new?draft=${data.draft}`,
    },
    { name: 'event-delivery', path: `/replenishment/events/deliveries/${data.eventDelivery}` },
    {
      name: 'event-delivery-create',
      path: `/replenishment/events/deliveries/new?scenario=${data.eventSupplier}`,
    },
    { name: 'event-cost', path: `/replenishment/events/costs/${data.eventCost}` },
    {
      name: 'event-cost-create',
      path: `/replenishment/events/costs/new?delivery=${data.eventDelivery}`,
    },
    { name: 'event-proposal', path: `/replenishment/events/review/${data.proposal}` },
    { name: 'event-handoff', path: `/replenishment/events/handoffs/${data.handoff}` },
    { name: 'event-batches', path: '/replenishment/events/batches' },
    { name: 'event-batch-create', path: '/replenishment/events/batches/new' },
    { name: 'event-batch-invalid', path: '/replenishment/events/batches/new?handoff=invalid' },
    { name: 'event-preview-invalid', path: '/replenishment/events/batches/preview' },
    {
      name: 'event-preview',
      path: `/replenishment/events/batches/preview?handoff=${data.handoff}`,
    },
  ].map((route) => ({ ...route, pattern: 'replenishment' }))
  for (const route of [...forecastRoutes, ...purchaseRoutes]) await header(page, route)
  await matrix(page, [forecastRoutes[2], purchaseRoutes[8]], testInfo)
})

test('master-data create/edit, imports and audit use the shared header and recovery state', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const owner = await workspace(page)
  const item = randomUUID()
  const location = randomUUID()
  const supplier = randomUUID()
  await seedRows('items', [
    {
      id: item,
      organization_id: owner.organization,
      code: `PART-${'A'.repeat(56)}`,
      name_en: 'Header fixture with a long part identifier',
      name_ar: 'قطعة اختبار بعنوان طويل',
      product_group: 'Test',
      unit_of_measure: 'EA',
      unit_cost: 1,
      currency: 'AED',
    },
  ])
  await seedRows('locations', [
    {
      id: location,
      organization_id: owner.organization,
      code: 'DXB',
      name_en: 'Dubai',
      name_ar: 'دبي',
      location_type: 'branch',
      country_code: 'AE',
      timezone: 'Asia/Dubai',
    },
  ])
  await seedRows('suppliers', [
    {
      id: supplier,
      organization_id: owner.organization,
      code: 'SUP',
      name_en: 'Supplier',
      country_code: 'AE',
      currency: 'AED',
      lead_time_days_p50: 3,
      lead_time_days_p90: 5,
    },
  ])
  const lists = [
    '/items',
    '/items/brands',
    '/items/supersessions',
    '/items/interchanges',
    '/locations',
    '/locations/network',
    '/locations/calendars',
    '/locations/holidays',
    '/suppliers',
    '/suppliers/supplier-items',
    '/suppliers/fx-rates',
  ]
  for (const path of lists) {
    await header(page, { name: 'master-list', path, pattern: path.split('/')[1] })
    await header(page, { name: 'master-create', path: `${path}/new`, pattern: path.split('/')[1] })
  }
  const routes = [
    { name: 'item-edit', path: `/items/${item}`, pattern: 'items' },
    { name: 'location-edit', path: `/locations/${location}`, pattern: 'locations' },
    { name: 'supplier-edit', path: `/suppliers/${supplier}`, pattern: 'suppliers' },
    { name: 'import-create', path: '/imports/new', pattern: 'imports' },
    { name: 'audit', path: '/audit', pattern: 'settings' },
  ]
  for (const route of routes) await header(page, route)
  await matrix(page, [routes[0], routes[3]], testInfo)
  const missing = await page.goto('/items/not-a-uuid')
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة', exact: true })).toBeVisible()
  await expect(page.locator('[data-page-banner="items"]')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('not-found-ar-375.png') })
})

test('existing imports loading preserves artwork without adding tabs', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await workspace(page)
  const routes = [
    { name: 'import-list', path: '/imports', pattern: 'imports' },
    { name: 'import-create', path: '/imports/new', pattern: 'imports' },
  ]
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  try {
    for (const route of routes) {
      await header(page, route)
      await page.evaluate(() => document.fonts.ready)
      await network.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 200,
        downloadThroughput: 1000,
        uploadThroughput: -1,
      })
      const loading = page.locator('main [aria-busy="true"]').filter({
        has: page.locator('[data-page-banner="imports"]'),
      })
      try {
        await page.reload({ waitUntil: 'commit' })
        await expect(loading.locator('.page-heading-copy p span')).toBeVisible({ timeout: 30_000 })
        await expect(loading.locator('.workspace-navigation')).toHaveCount(0)
        const bounds = (await loading.locator('.page-banner-backdrop').boundingBox())!
        expect(bounds.y).toBe(0)
        expect(bounds.height).toBe(100)
        await expect(loading.locator('.page-heading-copy span').first()).toHaveCSS(
          'animation-name',
          'none',
        )
        await page.screenshot({ path: testInfo.outputPath(`loading-${route.name}-1366.png`) })
        await expect(loading).toBeVisible()
      } finally {
        await network.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
      }
      await expect(loading).toHaveCount(0)
    }
  } finally {
    await network.detach()
  }
})
