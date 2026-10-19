import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle } from './helpers/typography'

test.use({ actionTimeout: 30_000 })

test('stock locator separates observation evidence, ranks distance and preserves both-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const nonce = randomUUID()
  const email = `locator-${nonce}@example.com`
  const password = `Locator-${nonce}`
  const viewerEmail = `locator-viewer-${nonce}@example.com`
  const branchEmail = `locator-branch-${nonce}@example.com`
  await createConfirmedUser(email, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branch = await createConfirmedUser(branchEmail, password)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signInWithPassword(page, email, password)
  const slug = `locator-${nonce}`
  await createOrganization(page, { name: 'Acme stock locator', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const fixture = (action: string, codes: string[] = []) =>
    promisify(execFile)(
      'uv',
      [
        'run',
        'python',
        resolve(process.cwd(), 'e2e/fixtures/stock-locator.py'),
        dsn,
        org,
        viewer,
        branch,
        action,
        JSON.stringify(codes),
      ],
      { cwd: resolve(process.cwd(), '../../engine'), timeout: 60_000 },
    )
  await fixture('seed')
  const path = '/replenishment/stock-locator'
  const query = '?item=PART%2F1&receiving=RECEIVER&unit=EA&day=2026-10-17'
  await page.goto('/replenishment')
  await page.getByRole('link', { name: 'Stock locator', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stock locator', exact: true })).toBeVisible()
  await page.getByLabel('Exact item code').fill('PART/1')
  await page.getByLabel('Receiving location code').fill('RECEIVER')
  await page.getByLabel('Requested unit').selectOption('EA')
  await page.getByLabel('Stock as of').fill('2026-10-17')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(page.getByText('3 matching · 37 other observations', { exact: true })).toBeVisible()
  await expect(rows.first()).toContainText('NEAR')
  await expect(rows.first()).toContainText('900,719,925,474,099.001 EA')
  await expect(rows.first()).toContainText('Typical (p50): 0 days')
  await expect(rows.nth(1)).toContainText('FAR')
  await expect(rows.last()).toContainText('NO-GEO')
  await expect(rows.last()).toContainText('Unknown')
  const disclosure = rows.first().getByText('Inspect evidence', { exact: true })
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(rows.first().getByText('Snapshot ID', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectPageTitle(page.getByRole('heading', { level: 1 }))
    await expect(page.locator('thead th').first()).toHaveCSS('font-size', '12px')
    await expect(rows.first()).toHaveCSS('font-size', '14px')
    for (const control of await page
      .locator('main input:not([type=hidden]):visible, main select:visible')
      .all()) {
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    }
    const region = page.getByRole('region', { name: 'Stock locator results' })
    await region.focus()
    await expect(region).toBeFocused()
    if (await region.evaluate((element) => element.scrollWidth > element.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0)
    }
    await page.screenshot({
      path: testInfo.outputPath(`stock-locator-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByRole('combobox', { name: 'Observations', exact: true }).selectOption('other')
  await page.getByRole('combobox', { name: 'Rows', exact: true }).selectOption('100')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  await expect(rows).toHaveCount(37)
  await expect(rows.filter({ hasText: 'Stale observation' })).toHaveCount(1)
  await expect(rows.filter({ hasText: 'Different supplied unit' })).toHaveCount(1)
  await expect(rows.filter({ hasText: '-2.125 EA' })).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Rows', exact: true }).selectOption('25')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  await expect(rows).toHaveCount(25)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(rows).toHaveCount(12)
  await page.goto(path + query + '&view=other&page=100000')
  await expect(page).toHaveURL(/page=2$/)
  await page.getByLabel('Search source locations').fill('UNIT')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Page 1 of 1 · 2 observations', { exact: true })).toBeVisible()
  await page.goto(path + query.replace('unit=EA', 'unit=BOX'))
  await expect(page.getByRole('main').getByRole('alert')).toContainText('choose a unit')
  await page.goto(path + query.replace('RECEIVER', 'INACTIVE'))
  await expect(page.getByRole('main').getByRole('alert')).toContainText('unavailable')
  await page.goto(path + query.replace('unit=EA', 'unit=KG'))
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('UNIT-KG')
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(path + query)
  await expect(page.getByRole('main').getByRole('status')).toHaveCount(0)
  await expect(rows).toHaveCount(3)
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('region', { name: 'Stock locator results' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({
      path: testInfo.outputPath(`stock-locator-ar-${width}.png`),
      fullPage: true,
    })
  }
  expect(errors).toEqual([])
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(path + query)
  await expect(viewerPage.locator('tbody tr')).toHaveCount(3)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(path + query)
  await expect(branchPage.getByRole('main').getByRole('alert')).toContainText('unavailable')
  await fixture('scope', ['RECEIVER'])
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await expect(
    branchPage.getByText('0 matching · 0 other observations', { exact: true }),
  ).toBeVisible()
  await fixture('scope', ['RECEIVER', 'NEAR'])
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(1)
  await expect(branchPage.locator('tbody tr')).toContainText('NEAR')
  await fixture('scope', ['NEAR'])
  await branchPage.reload()
  await expect(branchPage.getByRole('main').getByRole('alert')).toContainText('unavailable')
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await branchContext.close()
})
