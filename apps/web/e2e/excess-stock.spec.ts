import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test.use({ actionTimeout: 30_000 })

async function expectEvidenceTypography(page: Page) {
  const heading = page.getByRole('heading', { level: 1 })
  await expectPageTitle(heading)
  const family = await page.locator('html').evaluate((node) => getComputedStyle(node).fontFamily)
  const values = page.locator('main .text-evidence-value:visible')
  expect(await values.count()).toBeGreaterThan(0)
  for (const value of await values.all()) {
    await expectEvidenceValue(value)
    await expect(value).toHaveCSS('font-family', family)
  }
}

test('excess assessments keep explicit maxima, exact history and scoped responsive evidence', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const password = `Excess-${key}`
  const email = `excess-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `excess-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `excess-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `excess-${key}`
  await createOrganization(page, { name: 'Excess stock planning', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seeded = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/excess-stock.py'),
      dsn,
      org,
      user,
      viewer,
      branch,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const fixture = JSON.parse(seeded.stdout) as {
    location: string
    lines: { item: string; policy: string }[]
    override: string
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/replenishment/excess')
  await page.getByRole('link', { name: 'New assessment', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Selected items (0/50)' })).toBeVisible()
  for (const width of [375, 768, 1024, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: testInfo.outputPath(`excess-picker-${width}.png`),
        fullPage: true,
      })
  }
  const help = page.getByRole('button', { name: 'About excess-stock assessments', exact: true })
  await help.click()
  await expect(page.getByRole('dialog')).toContainText('not a reconstruction')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  const candidateTable = page.getByRole('region', { name: 'Policy and maximum choices' })
  await candidateTable
    .getByRole('row')
    .filter({ hasText: 'Approved revision 1' })
    .getByRole('radio', { name: 'Select EXCESS-1', exact: true })
    .check()
  await candidateTable.getByRole('radio', { name: 'Select EXCESS-2', exact: true }).check()
  await candidateTable.getByRole('radio', { name: 'Select EXCESS-3', exact: true }).check()
  await page.getByRole('button', { name: 'Add selected items', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Selected items (3/50)' })).toBeVisible()
  await page.getByRole('link', { name: 'Preview assessment', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/excess\/preview\?/)
  const previewUrl = page.url()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Assessment unavailable')
  await expect(page.getByRole('button', { name: 'Save assessment' })).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set unit_of_measure='EA' where organization_id=%s",(sys.argv[2],))`)
  await page.reload()
  await expect(page.getByRole('status')).toContainText('All selected lines are comparable')
  await expect(page.getByText('38.25 KWD', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Assessment line comparisons' })).toContainText(
    'Approved revision 1',
  )
  const details = page.locator('summary').filter({ hasText: /^Inspect EXCESS-1$/ })
  await details.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Override reasons: Seasonal maximum · Reviewed')).toBeVisible()
  await page.keyboard.press('Enter')
  for (const width of [375, 768, 1024, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectEvidenceTypography(page)
    await expect(page.locator('tbody tr').first()).toHaveCSS('font-size', '14px')
    const region = page.getByRole('region', { name: 'Assessment line comparisons' })
    await region.focus()
    if (await region.evaluate((e) => e.scrollWidth > e.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
      await region.evaluate((e) => {
        e.scrollLeft = 0
      })
    }
    await page.screenshot({ path: testInfo.outputPath(`excess-${width}.png`), fullPage: true })
  }
  await page.getByLabel('Assessment reason', { exact: true }).fill('Quarterly stock review')
  await page.getByRole('checkbox').check()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=31.001 where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[0].item}'))`)
  await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('changed')
  await page.goto(previewUrl)
  await page.getByLabel('Assessment reason', { exact: true }).fill('Quarterly stock review')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/excess\/[0-9a-f-]+$/)
  const savedUrl = page.url()
  await expect(page.getByText('39.375 KWD', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=999 where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(page.getByText('39.375 KWD', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Saved assessments', exact: true }).click()
  await page.getByLabel('Search', { exact: true }).fill('Quarterly')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Quarterly stock review' })).toBeVisible()
  for (const width of [1920, 1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.screenshot({ path: testInfo.outputPath('excess-history-375.png'), fullPage: true })
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(savedUrl)
  await expect(viewerPage.getByText('39.375 KWD', { exact: true })).toBeVisible()
  await viewerPage.goto(previewUrl)
  await expect(viewerPage.getByRole('button', { name: 'Save assessment' })).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  // The route's loading boundary can send a 200 before the streamed notFound result.
  // Assert the denied UI and absence of saved evidence, rather than the initial response status.
  await branchPage.goto(savedUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible()
  await expect(branchPage.getByText('39.375 KWD', { exact: true })).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.getByText('39.375 KWD', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s',(sys.argv[2],'${branch}'))`)
  await branchPage.reload()
  await expect(
    branchPage.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible()
  await expect(branchPage.getByText('39.375 KWD', { exact: true })).toHaveCount(0)
  await branchContext.close()
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(savedUrl)
  for (const width of [375, 1366, 1440]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectEvidenceTypography(page)
    await page.screenshot({ path: testInfo.outputPath(`excess-ar-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
