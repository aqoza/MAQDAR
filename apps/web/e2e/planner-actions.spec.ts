import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

async function workspace(page: Page, mode: 'purchase' | 'transfer') {
  const key = randomUUID(),
    password = `Actions-${key}`
  const email = `actions-${key}@example.com`,
    branchEmail = `actions-branch-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`actions-review-${key}@example.com`, password)
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `actions-${key}`
  await createOrganization(page, { name: 'Planner Action Centre QA', slug, arabicEnabled: true })
  const organization = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const result = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve('e2e/fixtures/planner-actions.py'),
      dsn,
      organization,
      owner,
      approver,
      branch,
      mode,
    ],
    { cwd: resolve('../../engine'), timeout: 120_000 },
  )
  return {
    email,
    password,
    branchEmail,
    ...(JSON.parse(result.stdout) as {
      pending: string
      approved: string | null
      location: string
      source: string | null
    }),
  }
}

async function checkLayout(page: Page, width: number) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '24px')
  await expect(page.locator('#planner-search-label:visible')).toHaveCSS('font-size', '14px')
  await expect(page.locator('[data-planner-actions]:visible input')).toHaveCSS(
    'font-size',
    width < 768 ? '16px' : '14px',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  for (const value of await page.locator('[data-planner-actions]:visible dd').all())
    await expect(value).toHaveCSS('font-size', '14px')
  if (width < 768)
    for (const target of await page
      .locator(
        '[data-planner-actions]:visible button:visible, [data-planner-actions] input:visible, [data-planner-actions] select:visible, [data-planner-actions] section a:visible',
      )
      .all())
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
}

test('real stock, reviews and next steps; searches, destinations, laptop/mobile and RTL', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  const account = await workspace(page, 'purchase')
  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Action centre', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Planner Action Centre', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-planner-actions]:visible [role=alert]')).toHaveCount(0)
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="stock"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="purchase"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="handoff"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="forecast"]'),
  ).toHaveCount(3)
  await expect(page.locator('main')).not.toContainText('FOREIGN-SECRET')
  await page.getByLabel('Search items or locations', { exact: true }).fill('no-match')
  await expect(page.getByText('No matching actions', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reset', exact: true }).first().click()
  await page.locator('[data-category="review"][aria-pressed]').click()
  await expect(page.locator('[data-planner-actions]:visible [data-action-kind]')).toHaveCount(1)
  await expect(
    page.getByRole('link', { name: 'Review purchase proposal', exact: true }),
  ).toHaveAttribute('href', `/replenishment/review/${account.pending}`)
  await page.getByRole('link', { name: 'Review purchase proposal', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Purchase review')
  await page.goto('/dashboard/actions')
  await page.locator('[data-planner-actions]:visible [data-action-kind="handoff"]').click()
  await expect(page.getByRole('link', { name: 'Open approved proposal' })).toHaveAttribute(
    'href',
    `/replenishment/review/${account.approved}`,
  )
  await page.getByLabel('Location in this queue', { exact: true }).selectOption('RESTRICTED')
  await expect(page.locator('[data-planner-actions]:visible [data-action-kind]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.locator('[data-planner-actions]:visible [data-action-kind="forecast"]').first().click()
  await page.getByRole('link', { name: 'Inspect forecast evidence', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/results\/[\w-]+\?item=/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
  await page.goto('/dashboard/actions')
  await page.locator('[data-planner-actions]:visible [data-action-kind="stock"]').click()
  await page.getByRole('link', { name: 'Review stock evidence', exact: true }).click()
  await expect(page).toHaveURL(/\/stock\?day=2026-10-10&basis=calculated/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Available stock above selected policy maximum',
  )
  for (const locale of ['en', 'ar']) {
    await context.addCookies([
      { name: 'locale', value: locale, url: testInfo.project.use.baseURL as string },
    ])
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/dashboard/actions')
      // Measure only the visible page, not Next's transient hidden streamed tree.
      await expect(page.locator('[data-planner-actions]:visible')).toHaveCount(1)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(
        page.locator('[data-planner-actions]:visible [data-action-kind="stock"]'),
      ).toBeVisible()
      await checkLayout(page, viewport.width)
      await page.screenshot({
        path: testInfo.outputPath(`planner-actions-${locale}-${viewport.width}.png`),
        fullPage: true,
      })
      if (viewport.width < 768) {
        await page.locator('[data-planner-actions]:visible input').fill('BATCH')
        const clear = page.getByRole('button', {
          name: locale === 'ar' ? 'مسح البحث' : 'Clear search',
          exact: true,
        })
        expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await clear.click()
        await expect(page.locator('[data-planner-actions]:visible input')).toBeFocused()
        await page.locator('[data-planner-actions]:visible [data-action-kind="purchase"]').click()
        await expect(page.locator('section[tabindex="-1"]:visible')).toBeFocused()
        await page.screenshot({
          path: testInfo.outputPath(`planner-action-detail-${locale}-${viewport.width}.png`),
          fullPage: true,
        })
      }
    }
  }
  await context.clearCookies()
  await page.setViewportSize({ width: 1366, height: 768 })
  await signInWithPassword(page, account.branchEmail, account.password)
  await page.goto('/dashboard/actions')
  await expect(page.locator('[data-planner-actions]:visible [role=alert]')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('RESTRICTED-SECRET')
  await expect(page.locator('main')).not.toContainText('FOREIGN-SECRET')
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="purchase"]'),
  ).toHaveCount(1)
  await expect(page.getByLabel('Location in this queue')).not.toContainText('RESTRICTED')
})

test('transfer queue preserves both-endpoint access; empty and signed-out states', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(150_000)
  const account = await workspace(page, 'transfer')
  await page.goto('/dashboard/actions')
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="transfer"]'),
  ).toHaveCount(1)
  await page.locator('[data-planner-actions]:visible [data-action-kind="transfer"]').click()
  await expect(
    page.getByRole('link', { name: 'Review transfer proposal', exact: true }),
  ).toHaveAttribute('href', `/replenishment/redistribution/review/${account.pending}`)
  await page.getByRole('link', { name: 'Review transfer proposal', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Transfer proposal')
  await context.clearCookies()
  await signInWithPassword(page, account.branchEmail, account.password)
  await page.goto('/dashboard/actions')
  await expect(
    page.locator('[data-planner-actions]:visible [data-action-kind="transfer"]'),
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'No actions in the loaded records' }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('planner-actions-empty.png'), fullPage: true })
  await context.clearCookies()
  await page.goto('/dashboard/actions')
  await expect(page).toHaveURL(/\/login/)
})
