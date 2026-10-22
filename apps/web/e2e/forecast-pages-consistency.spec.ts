import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('forecast forms, histories and saved evidence share compact laptop, mobile and RTL roles', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const email = `forecast-pages-${key}@example.com`
  const password = `Forecast-pages-${key}`
  const owner = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`forecast-approver-${key}@example.com`, password)
  await signInWithPassword(page, email, password)
  const slug = `forecast-pages-${key}`
  await createOrganization(page, { name: 'Forecast pages QA', slug, arabicEnabled: true })
  const organization = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname)) {
    throw new Error('Forecast visual fixtures require the local database')
  }
  const seeded = await promisify(execFile)(
    'uv',
    ['run', 'python', resolve('e2e/fixtures/header-events.py'), dsn, organization, owner, approver],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const data: {
    run: string
    forecast: string
    item: string
    policy_run: string
    policy: string
    event: string
    eventPolicy: string
  } = JSON.parse(seeded.stdout.trim())
  const routes = [
    { name: 'forecast-create', path: '/forecasts/new', capture: true },
    { name: 'classification-create', path: '/forecasts/classify' },
    { name: 'preparation-create', path: '/forecasts/prepare' },
    { name: 'workbench', path: '/forecasts?tab=workbench', capture: true },
    {
      name: 'forecast-result',
      path: `/forecasts/results/${data.run}?item=${data.item}`,
      capture: true,
    },
    { name: 'policy-evidence', path: `/forecasts/policies/${data.policy_run}` },
    { name: 'policy-detail', path: `/forecasts/workbench/${data.policy}`, capture: true },
    {
      name: 'stock-evidence',
      path: `/forecasts/workbench/${data.policy}/stock?basis=calculated&day=2026-10-10`,
    },
    { name: 'event-evidence', path: `/forecasts/events/${data.event}` },
    { name: 'event-create', path: `/forecasts/events/new?forecast=${data.forecast}` },
    { name: 'event-policy', path: `/forecasts/events/policies/${data.eventPolicy}`, capture: true },
    { name: 'drivers-empty', path: '/forecasts/drivers', capture: true },
    { name: 'driver-create', path: '/forecasts/drivers/new' },
    { name: 'installed-empty', path: '/forecasts/installed-base', capture: true },
    { name: 'installed-create', path: '/forecasts/installed-base/new' },
    { name: 'demand-empty', path: '/forecasts/installed-base/demand' },
    { name: 'simulation-empty', path: '/forecasts/simulations' },
    { name: 'simulation-create', path: `/forecasts/simulations/new?policy=${data.policy}` },
  ]
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const measurements = []
  for (const locale of ['en', 'ar']) {
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 })
      for (const route of routes) {
        await page.goto(route.path)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        // Embedded panels retain their own headings beneath the single illustrated banner.
        const banner = page.locator('[data-page-banner="forecasts"]')
        const heading = banner.locator('h1')
        await expect(banner).toHaveCount(1)
        await expect(heading).toHaveCount(1)
        await expect(heading).not.toHaveText(/not found|Unable to load|تعذّر تحميل|غير موجودة/)
        await expect(heading).toHaveCSS('font-size', '16px')
        await expect(heading).toHaveCSS('line-height', '24px')
        for (const visibleHeading of await page.locator('main h1:visible').all()) {
          await expect(visibleHeading).toHaveCSS('font-size', '16px')
          await expect(visibleHeading).toHaveCSS('line-height', '24px')
        }
        const roles = await page.locator('main').evaluate((main) => {
          const visible = (element: Element) => element.getBoundingClientRect().height > 0
          const measure = (selector: string) =>
            [...main.querySelectorAll(selector)].filter(visible).map((element) => {
              const css = getComputedStyle(element)
              return {
                text: element.textContent?.trim(),
                size: css.fontSize,
                lineHeight: css.lineHeight,
                weight: css.fontWeight,
              }
            })
          return {
            tableHeads: measure('thead th'),
            values: measure('.text-evidence-value'),
            subsections: measure('.text-subsection-title'),
            captions: measure('.text-xs'),
          }
        })
        expect(
          roles.tableHeads.every(
            (role) => role.size === '12px' && role.lineHeight === '16px' && role.weight === '500',
          ),
        ).toBe(true)
        expect(
          roles.values.every(
            (role) => role.size === '14px' && role.lineHeight === '20px' && role.weight === '600',
          ),
        ).toBe(true)
        expect(
          roles.subsections.every(
            (role) => role.size === '14px' && role.lineHeight === '20px' && role.weight === '600',
          ),
        ).toBe(true)
        expect(
          roles.captions.every((role) => role.size === '12px' && role.lineHeight === '16px'),
        ).toBe(true)
        if (
          [
            'workbench',
            'forecast-result',
            'policy-evidence',
            'policy-detail',
            'event-create',
            'event-evidence',
            'event-policy',
          ].includes(route.name)
        ) {
          expect(roles.tableHeads.length, route.name).toBeGreaterThan(0)
        }
        if (['stock-evidence', 'event-evidence', 'event-policy'].includes(route.name)) {
          expect(roles.values.length, route.name).toBeGreaterThanOrEqual(2)
          expect(roles.captions.length, route.name).toBeGreaterThan(0)
        }
        if (['forecast-result', 'event-evidence', 'event-policy'].includes(route.name)) {
          expect(roles.subsections.length, route.name).toBeGreaterThanOrEqual(2)
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        const inputs = page.locator(
          'main input:visible:not([type="hidden"], [type="checkbox"], [type="radio"], [type="file"], [aria-hidden="true"][tabindex="-1"]), main select:visible, main textarea:visible',
        )
        for (const input of await inputs.all()) {
          await expect(input).toHaveCSS('font-size', width < 768 ? '16px' : '14px')
          // Chromium reports "normal" for its native select text despite the shared CSS rule.
          if ((await input.evaluate((element) => element.tagName)) !== 'SELECT') {
            await expect(input).toHaveCSS('line-height', width < 768 ? '24px' : '20px')
          }
          const bounds = (await input.boundingBox())!
          expect(bounds.x).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
          if (width < 768) expect(bounds.height).toBeGreaterThanOrEqual(44)
        }
        if (width < 768) {
          for (const summary of await page.locator('main summary:visible').all()) {
            expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
          }
        }
        measurements.push({ locale, width, route: route.name, ...roles })
        if (route.capture) {
          await page.evaluate(() => document.fonts.ready)
          await page.screenshot({
            path: testInfo.outputPath(`${route.name}-${locale}-${width}.png`),
            fullPage: route.name === 'forecast-result',
          })
        }
      }
    }
  }
  // Non-vacuous fixtures prove the saved-record checks exercised actual evidence.
  expect(measurements.some((sample) => sample.values.length > 0)).toBe(true)
  expect(measurements.some((sample) => sample.tableHeads.length > 0)).toBe(true)
  expect(measurements.some((sample) => sample.subsections.length > 0)).toBe(true)
  await writeFile(testInfo.outputPath('typography.json'), JSON.stringify(measurements, null, 2))
  expect(errors).toEqual([])
})
