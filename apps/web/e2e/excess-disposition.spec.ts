import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

test.use({ actionTimeout: 30_000 })
test('dispositions retain independent decisions, exact evidence and scoped responsive history', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID()
  const password = `Disposition-${key}`
  const email = `disposition-${key}@example.com`
  const author = await createConfirmedUser(email, password)
  const reviewerEmail = `disposition-reviewer-${key}@example.com`
  const reviewer = await createConfirmedUser(reviewerEmail, password)
  const branchEmail = `disposition-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  const viewerEmail = `disposition-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `disposition-${key}`
  await createOrganization(page, { name: 'Disposition review', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
      author,
      reviewer,
      branch,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const fixture = JSON.parse(seeded.stdout) as {
    location: string
    lines: { item: string; policy: string }[]
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='approver' where organization_id=%s and user_id=%s",(sys.argv[2],'${reviewer}'))
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'viewer')",(sys.argv[2],'${viewer}'))
    db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',('${viewer}',sys.argv[2]))`)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/replenishment/excess/new')
  const table = page.getByRole('region', { name: 'Policy and maximum choices' })
  await table
    .getByRole('row')
    .filter({ hasText: 'Approved revision 1' })
    .getByRole('radio', { name: 'Select EXCESS-1', exact: true })
    .check()
  await table.getByRole('radio', { name: 'Select EXCESS-2', exact: true }).check()
  await page.getByRole('button', { name: 'Add selected items', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Selected items (2/50)' })).toBeVisible()
  await page.getByRole('link', { name: 'Preview assessment', exact: true }).click()
  await page.getByLabel('Assessment reason', { exact: true }).fill('Disposition assessment')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
  await expect(page).toHaveURL(/\/excess\/[0-9a-f-]+$/)
  const assessmentUrl = page.url()
  await page.getByRole('link', { name: 'Propose disposition for EXCESS-1', exact: true }).click()
  await expect(page).toHaveURL(/\/review\/new\?/)
  const sourceUrl = page.url()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page
    .getByRole('combobox', { name: 'Disposition intent', exact: true })
    .selectOption('supplier_return')
  await page.getByLabel('Proposed quantity', { exact: true }).fill('17')
  await page.getByLabel('Proposal reason', { exact: true }).fill('Supplier return review')
  await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('no greater')
  await expect(page.getByRole('combobox', { name: 'Disposition intent', exact: true })).toHaveValue(
    'supplier_return',
  )
  await page.getByLabel('Proposed quantity', { exact: true }).fill('3.333')
  await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)
  const firstUrl = page.url()
  await expect(page.getByText('3.749625 KWD', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  const help = page.getByRole('button', { name: 'About disposition review', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Separate assessments')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
    await expect(page.getByText('3.749625 KWD', { exact: true }).locator('..')).toHaveCSS(
      'font-size',
      '16px',
    )
    await page.screenshot({ path: testInfo.outputPath(`disposition-${width}.png`), fullPage: true })
  }
  await page.goto(sourceUrl)
  await page
    .getByRole('combobox', { name: 'Disposition intent', exact: true })
    .selectOption('scrap')
  await page.getByLabel('Proposed quantity', { exact: true }).fill('1')
  await page.getByLabel('Proposal reason', { exact: true }).fill('Duplicate pending')
  await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('already has a pending')
  const reviewContext = await browser.newContext()
  const reviewPage = await reviewContext.newPage()
  reviewPage.on('pageerror', (e) => errors.push(e.message))
  await signInWithPassword(reviewPage, reviewerEmail, password)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=40 where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[1].item}'))`)
  await reviewPage.goto(firstUrl)
  await expect(
    reviewPage.getByText('The selected line’s as-of evidence still matches.', { exact: false }),
  ).toBeVisible()
  await reviewPage.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('approved')
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Independent return review')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByText('Selected planning proposal', { exact: true })).toBeVisible()
  const propose = async (reason: string, quantity: string) => {
    await page.goto(sourceUrl)
    await page
      .getByRole('combobox', { name: 'Disposition intent', exact: true })
      .selectOption('scrap')
    await page.getByLabel('Proposed quantity', { exact: true }).fill(quantity)
    await page.getByLabel('Proposal reason', { exact: true }).fill(reason)
    await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)
    return page.url()
  }
  await propose('Withdraw this proposal', '2')
  await page.getByLabel('Decision reason', { exact: true }).fill('Reconsidering')
  await page.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Revision 2 · Withdrawn/ })).toBeVisible()
  const replacement = await propose('Replacement proposal', '4')
  await reviewPage.goto(replacement)
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Independent replacement')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByText('Selected planning proposal', { exact: true })).toBeVisible()
  await reviewPage.goto(firstUrl)
  await expect(reviewPage.getByText('Historical approval', { exact: true })).toBeVisible()
  const stale = await propose('Changed cost proposal', '1')
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set unit_cost=1.126 where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[0].item}'))`)
  await reviewPage.goto(stale)
  await expect(reviewPage.getByRole('main').getByRole('alert')).toContainText('evidence changed')
  await expect(reviewPage.locator('option[value="approved"]')).toHaveJSProperty('disabled', true)
  await expect(reviewPage.getByRole('combobox', { name: 'Decision', exact: true })).toHaveValue(
    'rejected',
  )
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Refresh assessment')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByRole('heading', { name: /Revision 4 · Rejected/ })).toBeVisible()
  await page.goto(sourceUrl)
  await expect(page.getByRole('button', { name: 'Submit proposal', exact: true })).toHaveCount(0)
  await page.goto('/replenishment/excess/review')
  await page.getByLabel('Search', { exact: true }).fill('Replacement')
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('approved')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByText('1 proposal', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-history-${width}.png`),
      fullPage: true,
    })
  }
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(replacement)
  await expect(viewerPage.getByText('4.5 KWD', { exact: true })).toBeVisible()
  await viewerPage.goto(assessmentUrl)
  await expect(
    viewerPage.getByRole('link', { name: 'Propose disposition for EXCESS-1', exact: true }),
  ).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(replacement)
  await expect(
    branchPage.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible()
  await expect(branchPage.getByText('4.5 KWD', { exact: true })).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.getByText('4.5 KWD', { exact: true })).toBeVisible()
  await branchContext.close()
  await reviewContext.close()
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(replacement)
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-ar-${width}.png`),
      fullPage: true,
    })
  }
  const stock = await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(db.execute('select quantity::text,allocated_quantity::text from public.stock_snapshots where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[0].item}')).fetchone())`)
  expect(stock.stdout).toContain("('30.001', '2.000')")
  expect(errors).toEqual([])
})
