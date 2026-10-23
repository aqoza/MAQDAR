import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event supplier comparison preserves gaps and evidence across five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Event-supplier-${key}`,
    email = `event-supplier-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `es-viewer-${key}@example.com`,
    viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `es-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `es-${key}`
  await createOrganization(page, { name: 'Event suppliers', slug, arabicEnabled: true })
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
    ['run', 'python', resolve(process.cwd(), 'e2e/fixtures/event-suppliers.py'), dsn, org, user],
    {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    },
  )
  const source = JSON.parse(seeded.stdout.trim()) as { draft: string; other_location: string }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute('insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)',(sys.argv[2],'${branch}','${source.other_location}'))`)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/replenishment/events/${source.draft}`)
  await page.getByRole('link', { name: 'Create event supplier scenario', exact: true }).click()
  const supplier = page.getByLabel('Supplier code', { exact: true })
  const confirmed = page.getByLabel(/I confirm that these supplier MOQ/)
  const preview = page.getByRole('button', { name: 'Preview supplier comparison', exact: true })
  const save = page.getByRole('button', { name: 'Save event supplier scenario', exact: true })
  const adjusted = () =>
    page
      .getByRole('heading', { name: 'Event-adjusted rounded quantity', exact: true })
      .locator('..')
  await supplier.fill('EVENT-SUP')
  await preview.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Confirm that the supplier MOQ' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  await confirmed.check()
  await preview.click()
  await expect(adjusted().getByText('4.5 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('1.994 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('1.235 EA', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'overdue or late inbound' })).toBeVisible()
  await supplier.fill('OTHER')
  await expect(save).toHaveCount(0)
  await supplier.fill('EVENT-SUP')
  await confirmed.uncheck()
  await expect(save).toHaveCount(0)
  await confirmed.check()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-suppliers-${width}.png`),
      fullPage: true,
    })
  }
  const evidence = page
    .locator('summary')
    .filter({ hasText: 'Supplier terms, calculation and saved draft evidence' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('3.265 EA', { exact: true }).last()).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set pack_size=2 where organization_id=%s',(sys.argv[2],))
    db.execute('update public.stock_snapshots set quantity=100 where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.open_orders where organization_id=%s',(sys.argv[2],))`)
  await save.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'supplier evidence changed' }),
  ).toBeVisible()
  await preview.click()
  await expect(adjusted().getByText('4 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('0.735 EA', { exact: true })).toBeVisible()
  await save.click()
  await expect(page).toHaveURL(/\/replenishment\/events\/suppliers\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved event supplier scenario', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Event supplier history', exact: true }).click()
  await page
    .getByRole('link', { name: 'EVENT-SUP · 4 EA event-adjusted quantity', exact: true })
    .click()
  await expect(page).toHaveURL(savedUrl)
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: new URL(savedUrl).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-suppliers-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set pack_size=3 where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(adjusted().getByText('4 EA', { exact: true })).toBeVisible()
  const readContext = await browser.newContext(),
    reader = await readContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(savedUrl)
  await expect(
    reader.getByRole('heading', { name: 'Saved event supplier scenario', exact: true }),
  ).toBeVisible()
  await reader.goto(`/replenishment/events/suppliers/new?draft=${source.draft}`)
  await expect(
    reader.getByText(
      'You can inspect saved scenarios. An owner, admin or planner must create a new scenario.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    reader.getByRole('button', { name: 'Preview supplier comparison', exact: true }),
  ).toHaveCount(0)
  await readContext.close()
  const branchContext = await browser.newContext(),
    restricted = await branchContext.newPage()
  await signInWithPassword(restricted, branchEmail, password)
  expect((await restricted.goto(savedUrl))?.status()).toBe(404)
  await branchContext.close()
  expect(errors).toEqual([])
})
