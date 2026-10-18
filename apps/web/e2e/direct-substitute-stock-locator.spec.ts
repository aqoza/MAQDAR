import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

test.use({ actionTimeout: 30_000 })

test('direct substitutes preserve direction, separate stock and both-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const nonce = randomUUID()
  const email = `substitute-${nonce}@example.com`
  const viewerEmail = `substitute-viewer-${nonce}@example.com`
  const branchEmail = `substitute-branch-${nonce}@example.com`
  const password = `Substitute-${nonce}`
  await createConfirmedUser(email, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `substitute-${nonce}`
  await createOrganization(page, { name: 'Acme direct substitutes', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const fixture = (action: string, codes: string[] = []) =>
    promisify(execFile)(
      'uv',
      [
        'run',
        'python',
        resolve(process.cwd(), 'e2e/fixtures/stock-locator.py'),
        process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        org,
        viewer,
        branch,
        action,
        JSON.stringify(codes),
      ],
      { cwd: resolve(process.cwd(), '../../engine'), timeout: 60_000 },
    )
  await fixture('seed')
  await fixture('substitutes')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const path = '/replenishment/stock-locator'
  const query = '?item=PART%2F1&receiving=RECEIVER&unit=EA&day=2026-10-17'
  const expanded = `${path}${query}&scope=substitutes`
  const rows = page.locator('tbody tr')
  const direct = rows.filter({ hasText: 'SUB-B' }).filter({ hasText: 'NEAR' })
  await page.goto(`${path}${query}`)
  await expect(rows).toHaveCount(3)
  await expect(page.getByLabel('Item scope')).toHaveValue('exact')
  await page.getByLabel('Item scope').selectOption('substitutes')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  await expect(rows).toHaveCount(6)
  await expect(page.getByText('6 matching · 114 other observations', { exact: true })).toBeVisible()
  await expect(
    page.getByText('3 items searched using current direct one-way relationships.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(rows.first()).toContainText('NEAR')
  await expect(rows.first()).toContainText('PART/1')
  await expect(rows.nth(1)).toContainText('SUB-B')
  await expect(direct).toContainText('900,719,925,474,099.001 EA')
  await expect(direct).toContainText('Current status: Phase out')
  await expect(direct).toContainText('Direct one-way substitute')
  await expect(rows.filter({ hasText: 'SUB-C' })).toContainText('Current status: Discontinued')
  const disclosure = direct.getByText('Inspect evidence', { exact: true })
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(direct.getByText('PART/1 → SUB-B', { exact: true })).toBeVisible()
  await expect(direct).toContainText('Recorded priority 99')
  await expect(
    direct.getByText('Recorded note: Check application <b>before issue</b>.', { exact: true }),
  ).toBeVisible()
  await expect(direct.locator('b')).toHaveCount(0)
  await page.keyboard.press('Enter')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
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
      await region.evaluate((element) => {
        element.scrollLeft = 0
      })
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: testInfo.outputPath(`direct-substitute-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByLabel('Observations').selectOption('all')
  await page.getByRole('button', { name: 'Find stock', exact: true }).click()
  await expect(rows).toHaveCount(25)
  await expect(page.getByText('Page 1 of 5 · 120 observations', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/scope=substitutes.*page=2/)
  await expect(page.getByText('Page 2 of 5 · 120 observations', { exact: true })).toBeVisible()
  await page.goto(`${expanded}&view=other&q=NEAR`)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('SUB-C')
  await expect(rows.first()).toContainText('Different supplied unit')
  await page.goto(expanded.replace('unit=EA', 'unit=KG'))
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'current catalog unit differs',
  )
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('PART/1')
  // Incoming links cannot be reversed, and the two modes never bridge into each other.
  await page.goto(expanded.replace('item=PART%2F1', 'item=SUB-C'))
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('SUB-C')
  await expect(
    page.getByText('1 item searched; no eligible direct substitutes', { exact: false }),
  ).toBeVisible()
  await page.goto(expanded.replace('scope=substitutes', 'scope=interchangeable'))
  await expect(rows).toHaveCount(4)
  await expect(rows.filter({ hasText: 'TWO-WAY' })).toHaveCount(1)
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(expanded)
  await expect(rows).toHaveCount(6)
  await direct.getByText('Inspect evidence', { exact: true }).click()
  await expect(direct.locator('bdi')).toHaveText('PART/1 → SUB-B')
  await expect(direct.locator('bdi')).toHaveCSS('direction', 'ltr')
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const overflowingCopy = await page.locator('main p').evaluateAll((paragraphs) =>
      paragraphs
        .filter((element) => !element.closest('table, details'))
        .flatMap((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const box = range.getBoundingClientRect()
          return box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1)
            ? [element.textContent]
            : []
        }),
    )
    expect(overflowingCopy).toEqual([])
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: testInfo.outputPath(`direct-substitute-ar-${width}.png`),
      fullPage: true,
    })
  }
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(expanded)
  await expect(viewerPage.locator('tbody tr')).toHaveCount(6)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await fixture('scope', ['RECEIVER'])
  await branchPage.goto(expanded)
  await expect(
    branchPage.getByText('0 matching · 0 other observations', { exact: true }),
  ).toBeVisible()
  await fixture('scope', ['RECEIVER', 'NEAR'])
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(2)
  await expect(
    branchPage.getByText('2 matching · 1 other observations', { exact: true }),
  ).toBeVisible()
  await fixture('scope', ['NEAR'])
  await branchPage.reload()
  await expect(branchPage.getByRole('main').getByRole('alert')).toContainText('unavailable')
  await branchContext.close()
  await fixture('substitute-oversize')
  await page.goto(expanded)
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'exceeds the 100-item limit',
  )
  await expect(rows).toHaveCount(0)
  await page.goto(`${path}${query}`)
  await expect(rows).toHaveCount(3)
  expect(errors).toEqual([])
})
