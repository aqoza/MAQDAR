import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event replenishment confirms independent demand, retains evidence and fits five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Event-draft-${key}`,
    email = `event-draft-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `ed-viewer-${key}@example.com`,
    viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `ed-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `ed-${key}`
  await createOrganization(page, { name: 'Event replenishment', slug, arabicEnabled: true })
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
      resolve(process.cwd(), 'e2e/fixtures/event-replenishment.py'),
      dsn,
      org,
      user,
    ],
    {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    },
  )
  const source = JSON.parse(seeded.stdout.trim()) as { scenario: string; other_location: string }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute('insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)',(sys.argv[2],'${branch}','${source.other_location}'))`)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/forecasts/events/policies/${source.scenario}`)
  await page
    .getByRole('link', { name: 'Create event-adjusted replenishment draft', exact: true })
    .click()
  const backorders = page.getByLabel('Additional unallocated backorders', { exact: true })
  const orders = page.getByLabel(/I confirm that all remaining open inbound/)
  const event = page.getByLabel(/I confirm that these event additions/)
  const preview = page.getByRole('button', {
    name: 'Preview replenishment comparison',
    exact: true,
  })
  const save = page.getByRole('button', { name: 'Save event replenishment draft', exact: true })
  await backorders.fill('0.002')
  await orders.check()
  await preview.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Confirm that the event additions' }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  await event.check()
  await preview.click()
  await expect(page.getByText('1.006 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('3.265 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('2.259 EA', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Overdue inbound lines: 1.' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Arrivals after the protection period ending 2026-10-15: 1.' }),
  ).toBeVisible()
  await event.uncheck()
  await expect(save).toHaveCount(0)
  await event.check()
  await backorders.fill('0.003')
  await expect(save).toHaveCount(0)
  await backorders.fill('0.002')
  await orders.uncheck()
  await expect(save).toHaveCount(0)
  await orders.check()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-replenishment-${width}.png`),
      fullPage: true,
    })
  }
  const evidence = page
    .locator('summary')
    .filter({ hasText: 'Stock, inbound and calculation evidence' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Included open inbound lines', exact: true }),
  ).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=6 where organization_id=%s',(sys.argv[2],))`)
  await save.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Evidence changed' })).toBeVisible()
  await preview.click()
  await expect(page.getByText('2.265 EA', { exact: true })).toBeVisible()
  await save.click()
  await expect(page).toHaveURL(/\/replenishment\/events\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved event-adjusted replenishment draft', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Event replenishment history', exact: true }).click()
  await page.getByRole('link', { name: 'Event-adjusted gap: 2.265 EA', exact: true }).click()
  await expect(page).toHaveURL(savedUrl)
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: new URL(savedUrl).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText('2.265 EA', { exact: true })).toBeVisible()
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-replenishment-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=10 where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(page.getByText('2.265 EA', { exact: true })).toBeVisible()
  const readContext = await browser.newContext(),
    reader = await readContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(savedUrl)
  await expect(reader.getByText('2.265 EA', { exact: true })).toBeVisible()
  await reader.goto(`/replenishment/events/new?scenario=${source.scenario}`)
  await expect(
    reader.getByText('Your role can inspect saved drafts. An editor is required to create one.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    reader.getByRole('button', { name: 'Preview replenishment comparison', exact: true }),
  ).toHaveCount(0)
  await readContext.close()
  const branchContext = await browser.newContext(),
    restricted = await branchContext.newPage()
  await signInWithPassword(restricted, branchEmail, password)
  expect((await restricted.goto(savedUrl))?.status()).toBe(404)
  await branchContext.close()
  expect(errors).toEqual([])
})
