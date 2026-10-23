import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event purchase costs retain fixed evidence and exact prices across five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Event-cost-${key}`,
    email = `event-cost-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `ec-viewer-${key}@example.com`,
    viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `ec-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `ec-${key}`
  await createOrganization(page, { name: 'Event costs', slug, arabicEnabled: true })
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
    ['run', 'python', resolve(process.cwd(), 'e2e/fixtures/event-costs.py'), dsn, org, user],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const source = JSON.parse(seeded.stdout.trim()) as { delivery: string; other_location: string }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute('insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)',(sys.argv[2],'${branch}','${source.other_location}'))`)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/replenishment/events/deliveries/${source.delivery}`)
  await page.getByRole('link', { name: 'Create event cost comparison', exact: true }).click()
  const confirmed = page.getByLabel(
    /I confirm that this unit price applies to both saved quantities/,
  )
  const preview = page.getByRole('button', { name: 'Preview purchase costs', exact: true })
  const save = page.getByRole('button', { name: 'Save event cost comparison', exact: true })
  const table = () =>
    page.getByRole('table', { name: 'Event purchase-cost comparison', exact: true })
  const row = (name: string) =>
    table()
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
  await preview.click()
  await expect(
    page.getByRole('status').filter({ hasText: 'A known price-valid-from date is required.' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.supplier_items set valid_from='2026-10-11' where organization_id=%s",(sys.argv[2],))`)
  await preview.click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Confirm that this price applies to both saved quantities' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  await confirmed.check()
  await preview.click()
  await expect(row('Baseline')).toContainText(/SAR\s*3\.70/)
  await expect(row('Event-adjusted')).toContainText(/SAR\s*5\.55/)
  await expect(row('Event-adjusted')).toContainText('4.5 EA')
  await expect(row('Event-adjusted')).toContainText('2026-10-11')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Policy recalculation is required' }),
  ).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'overdue or late inbound' })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Positive event additions' }),
  ).toBeVisible()
  await confirmed.uncheck()
  await expect(save).toHaveCount(0)
  await confirmed.check()
  await preview.click()
  await expect(preview).toBeEnabled()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: testInfo.outputPath(`event-costs-${width}.png`), fullPage: true })
  }
  const evidence = page.locator('summary').filter({ hasText: 'Price evidence and calculation' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('3.702', { exact: true })).toBeVisible()
  await expect(page.getByText('5.553', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2,pack_size=100,lead_time_days=50 where organization_id=%s',(sys.argv[2],))
    db.execute('update public.work_calendars set observe_public_holidays=true where organization_id=%s',(sys.argv[2],))
    db.execute('update public.stock_snapshots set quantity=100 where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.open_orders where organization_id=%s',(sys.argv[2],))`)
  await save.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Price or source evidence changed' }),
  ).toBeVisible()
  await preview.click()
  await expect(row('Baseline')).toContainText(/SAR\s*6\.00/)
  await expect(row('Event-adjusted')).toContainText(/SAR\s*9\.00/)
  await expect(row('Event-adjusted')).toContainText('4.5 EA')
  await expect(row('Event-adjusted')).toContainText('2026-10-11')
  await expect(page.getByText('2026-10-14', { exact: true }).first()).toBeVisible()
  await save.click()
  await expect(page).toHaveURL(/\/replenishment\/events\/costs\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved event cost comparison', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Event cost history', exact: true }).click()
  await expect(page.getByText('Autumn service campaign', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Increase over baseline: SAR\s*3\.00/ }).click()
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
      path: testInfo.outputPath(`event-costs-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=3,valid_from=null where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(row('Event-adjusted')).toContainText(/SAR\s*9\.00/)
  await page.goto(`/replenishment/events/costs/new?delivery=${source.delivery}`)
  await confirmed.check()
  await preview.click()
  await expect(
    page.getByRole('status').filter({ hasText: 'A known price-valid-from date is required.' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  const readContext = await browser.newContext(),
    reader = await readContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(savedUrl)
  await expect(
    reader.getByRole('heading', { name: 'Saved event cost comparison', exact: true }),
  ).toBeVisible()
  await reader.goto(`/replenishment/events/costs/new?delivery=${source.delivery}`)
  await expect(
    reader.getByText(
      'You can inspect saved comparisons. An owner, admin or planner must create a new comparison.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    reader.getByRole('button', { name: 'Preview purchase costs', exact: true }),
  ).toHaveCount(0)
  await readContext.close()
  const branchContext = await browser.newContext(),
    restricted = await branchContext.newPage()
  await signInWithPassword(restricted, branchEmail, password)
  expect((await restricted.goto(savedUrl))?.status()).toBe(404)
  await branchContext.close()
  expect(errors).toEqual([])
})
