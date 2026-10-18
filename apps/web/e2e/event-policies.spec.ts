import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event-policy scenarios preserve conditional evidence, permissions and five-width layouts', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Event-policy-${key}`,
    email = `event-policy-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `ep-viewer-${key}@example.com`,
    viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `ep-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `ep-${key}`
  await createOrganization(page, { name: 'Event policy planning', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seeded = await promisify(execFile)(
    'uv',
    ['run', 'python', resolve(process.cwd(), 'e2e/fixtures/event-policies.py'), dsn, org, user],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const source = JSON.parse(seeded.stdout.trim()) as {
    event: string
    policy: string
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
  await page.goto(`/forecasts/events/${source.event}`)
  await page.getByRole('link', { name: 'Compare event-adjusted policy', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Choose a calculated policy', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Use calculated policy', exact: true }).click()
  const reason = page.getByLabel('Reason for this policy scenario', { exact: true })
  await reason.fill('Cover the confirmed incremental service campaign.')
  await page.getByRole('button', { name: 'Preview policy comparison', exact: true }).click()
  await expect(page.getByText('3.011 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('8.264 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('1 → 1', { exact: true })).toHaveCount(2)
  await reason.fill('Updated planning reason')
  await expect(page.getByRole('button', { name: 'Save policy scenario', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Preview policy comparison', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save policy scenario', exact: true }),
  ).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-policy-${width}.png`),
      fullPage: true,
    })
  }
  const evidence = page
    .locator('summary')
    .filter({ hasText: 'Parameters, dates and source evidence' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByText(
      'Event additions beyond the protection period: 4 EA. They do not change these thresholds.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Event contributions by date', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save policy scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/events\/policies\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved event-adjusted policy scenario', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Event-policy history', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Updated planning reason', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Updated planning reason', exact: true }).click()
  await expect(page).toHaveURL(savedUrl)
  await expect(page.getByText('8.264 EA', { exact: true })).toBeVisible()
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: new URL(savedUrl).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText('8.264 EA', { exact: true })).toBeVisible()
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`event-policy-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
  // Fixture-only mutations prove a saved comparison remains immutable while new work fails closed.
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.inventory_policies set evidence=jsonb_set(evidence,%s,%s::jsonb) where id=%s',('{forecast,source,discontinued_on}','"2026-10-12"','${source.policy}'))
    db.execute('update public.planned_event_scenarios set report=jsonb_set(report,%s,%s::jsonb) where id=%s',('{source,evidence,source,discontinued_on}','"2026-10-12"','${source.event}'))`)
  await page.goto(`/forecasts/events/policies/new?event=${source.event}&policy=${source.policy}`)
  await page
    .getByLabel('Reason for this policy scenario', { exact: true })
    .fill('Inspect lifecycle')
  await page.getByRole('button', { name: 'Preview policy comparison', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'outside the saved item lifecycle' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save policy scenario', exact: true })).toHaveCount(
    0,
  )
  await page.goto(savedUrl)
  await expect(page.getByText('8.264 EA', { exact: true })).toBeVisible()
  const readContext = await browser.newContext(),
    reader = await readContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(savedUrl)
  await expect(reader.getByText('8.264 EA', { exact: true })).toBeVisible()
  await reader.goto(`/forecasts/events/policies/new?event=${source.event}&policy=${source.policy}`)
  await expect(
    reader.getByText(
      'Your role can inspect saved scenarios. An editor is required to create one.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    reader.getByRole('button', { name: 'Preview policy comparison', exact: true }),
  ).toHaveCount(0)
  await readContext.close()
  const branchContext = await browser.newContext(),
    restricted = await branchContext.newPage()
  await signInWithPassword(restricted, branchEmail, password)
  const response = await restricted.goto(savedUrl)
  expect(response?.status()).toBe(404)
  await branchContext.close()
  expect(errors).toEqual([])
})
