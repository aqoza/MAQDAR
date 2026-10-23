import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event delivery dates preserve quantities and calendar evidence across five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Event-supplier-${key}`,
    email = `event-delivery-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `es-viewer-${key}@example.com`,
    viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `es-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `es-${key}`
  await createOrganization(page, { name: 'Event deliveries', slug, arabicEnabled: true })
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
    ['run', 'python', resolve(process.cwd(), 'e2e/fixtures/event-deliveries.py'), dsn, org, user],
    {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    },
  )
  const source = JSON.parse(seeded.stdout.trim()) as {
    supplier_scenario: string
    other_location: string
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute('insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)',(sys.argv[2],'${branch}','${source.other_location}'))`)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/replenishment/events/suppliers/${source.supplier_scenario}`)
  await page.getByRole('link', { name: 'Create event delivery scenario', exact: true }).click()
  const requested = page.getByLabel('Requested order date', { exact: true })
  const confirmed = page.getByLabel(/I confirm that these supplier and receiving-location/)
  const preview = page.getByRole('button', { name: 'Preview delivery dates', exact: true })
  const save = page.getByRole('button', { name: 'Save event delivery scenario', exact: true })
  const comparison = () =>
    page.getByRole('table', { name: 'Event delivery comparison', exact: true })
  const adjusted = () =>
    comparison()
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Event-adjusted', exact: true }) })
  await preview.click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Confirm that the supplier and receiving calendars' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  await confirmed.check()
  await preview.click()
  await expect(adjusted().getByText('4.5 EA', { exact: true })).toBeVisible()
  await expect(adjusted().getByText('2026-10-11', { exact: true })).toBeVisible()
  await expect(adjusted().getByText('2026-10-14', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Policy recalculation is required' }),
  ).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'overdue or late inbound' })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Positive event additions' }),
  ).toContainText('2026-10-13 · 2.25 EA')
  const earlierDates = page.locator('summary').filter({ hasText: '2 event dates before receipt' })
  await earlierDates.click()
  await expect(page.getByText('2026-10-13 · 2.25 EA', { exact: true })).toBeVisible()
  await earlierDates.click()
  await requested.fill('2026-10-11')
  await expect(save).toHaveCount(0)
  await requested.fill('2026-10-10')
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
      path: testInfo.outputPath(`event-deliveries-${width}.png`),
      fullPage: true,
    })
  }
  const evidence = page
    .locator('summary')
    .filter({ hasText: 'Calendar adjustments and references' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Receiving-location calendar', exact: true }),
  ).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set weekend_days='{}' where organization_id=%s and code='SUP-CAL'",(sys.argv[2],))
    db.execute('update public.supplier_items set pack_size=100,lead_time_days=50 where organization_id=%s',(sys.argv[2],))
    db.execute('update public.stock_snapshots set quantity=100 where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.open_orders where organization_id=%s',(sys.argv[2],))`)
  await save.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'calendar or source evidence changed' }),
  ).toBeVisible()
  await preview.click()
  await expect(adjusted().getByText('2026-10-12', { exact: true })).toBeVisible()
  await expect(adjusted().getByText('4.5 EA', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Positive event additions' }),
  ).not.toContainText('2.25 EA')
  await save.click()
  await expect(page).toHaveURL(/\/replenishment\/events\/deliveries\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved event delivery scenario', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Event delivery history', exact: true }).click()
  await page
    .getByRole('link', {
      name: '4.5 EA event-adjusted quantity · Receipt: 2026-10-12',
      exact: true,
    })
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
      path: testInfo.outputPath(`event-deliveries-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.work_calendars set observe_public_holidays=true where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(adjusted().getByText('2026-10-12', { exact: true })).toBeVisible()
  await page.goto(`/replenishment/events/deliveries/new?scenario=${source.supplier_scenario}`)
  await confirmed.check()
  await preview.click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Unavailable: a date cannot be resolved' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  const readContext = await browser.newContext(),
    reader = await readContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(savedUrl)
  await expect(
    reader.getByRole('heading', { name: 'Saved event delivery scenario', exact: true }),
  ).toBeVisible()
  await reader.goto(`/replenishment/events/deliveries/new?scenario=${source.supplier_scenario}`)
  await expect(
    reader.getByText(
      'You can inspect saved scenarios. An owner, admin or planner must create a new scenario.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    reader.getByRole('button', { name: 'Preview delivery dates', exact: true }),
  ).toHaveCount(0)
  await readContext.close()
  const branchContext = await browser.newContext(),
    restricted = await branchContext.newPage()
  await signInWithPassword(restricted, branchEmail, password)
  expect((await restricted.goto(savedUrl))?.status()).toBe(404)
  await branchContext.close()
  expect(errors).toEqual([])
})
