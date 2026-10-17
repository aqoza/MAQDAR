import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })
test('event scenarios retain baseline evidence, enforce access and fit all five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const password = `Event-${key}`
  const email = `event-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `event-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `event-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `event-${key}`
  await createOrganization(page, { name: 'Event planning', slug, arabicEnabled: true })
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
    ['run', 'python', resolve(process.cwd(), 'e2e/fixtures/planned-events.py'), dsn, org],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const source = JSON.parse(seeded.stdout.trim()) as {
    forecast: string
    run: string
    item: string
    location: string
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
  await page.goto(`/forecasts/results/${source.run}?item=${source.item}`)
  await page.getByRole('link', { name: 'Plan event demand', exact: true }).click()
  await page.getByLabel('Scenario name', { exact: true }).fill('Autumn service campaign')
  await page
    .getByLabel('Reason and assumptions', { exact: true })
    .fill('Explicit incremental demand from the campaign team.')
  await page.getByLabel('Additional demand on 2026-10-11', { exact: true }).fill('0.009')
  await page.getByLabel('Additional demand on 2026-10-12', { exact: true }).fill('2.250')
  await page.getByLabel('Additional demand on 2026-10-13', { exact: true }).fill('٠٫٠٠١')
  await page.getByRole('button', { name: 'Preview scenario', exact: true }).click()
  await expect(page.getByText('9.267 EA', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save event scenario', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('checkbox').check()
  await expect(
    page.getByRole('region', { name: 'Daily demand comparison', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview scenario', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save event scenario', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeChecked()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: testInfo.outputPath(`event-form-${width}.png`), fullPage: true })
  }
  const evidence = page.locator('summary').filter({ hasText: 'Original forecast evidence' })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Baseline-only daily uncertainty bands', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Scenario uncertainty has not been calculated.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save event scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/events\/[0-9a-f-]{36}$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Autumn service campaign', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('9.267 EA', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Planned-event history', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Autumn service campaign', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Plan event demand', exact: true }).click()
  await page.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('tender')
  await page.getByLabel('Scenario name', { exact: true }).fill('Tender ' + 'A'.repeat(193))
  await page.getByLabel('Reason and assumptions', { exact: true }).fill('Separate what-if case.')
  await page.getByLabel('Additional demand on 2026-10-11', { exact: true }).fill('1')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Preview scenario', exact: true }).click()
  await expect(page.getByText('8.007 EA', { exact: true })).toBeVisible()
  // Editing after preview must remove the stale save action immediately.
  await page
    .getByLabel('Additional demand on 2026-10-11', { exact: true })
    .fill('999999999999999.999')
  await expect(page.getByRole('button', { name: 'Save event scenario', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Preview scenario', exact: true }).click()
  await expect(page.getByText('1,000,000,000,000,007.006 EA', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('event-large-375.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save event scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/events\/[0-9a-f-]{36}$/)
  await expect(
    page.getByRole('heading', { name: 'Tender ' + 'A'.repeat(193), exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('event-long-name-375.png'), fullPage: true })
  await page.goto(savedUrl)
  await python(`import sys,psycopg
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.forecast_results set evidence=jsonb_set(evidence,'{source,unit_provenance,status}',%s) where id=%s",(Jsonb('unknown'),'${source.forecast}'))`)
  await page.reload()
  await expect(page.getByText('9.267 EA', { exact: true })).toBeVisible()
  await page.goto(`/forecasts/events/new?forecast=${source.forecast}`)
  await expect(page.getByRole('status')).toContainText('known demand units')
  await page.goto(savedUrl)
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: page.url() }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: testInfo.outputPath(`event-rtl-${width}.png`), fullPage: true })
  }
  for (const [address, allowed] of [
    [viewerEmail, true],
    [branchEmail, false],
  ] as const) {
    const context = await browser.newContext()
    const scoped = await context.newPage()
    await signInWithPassword(scoped, address, password)
    await scoped.goto(savedUrl)
    if (allowed) {
      await expect(
        scoped.getByRole('heading', { name: 'Autumn service campaign', exact: true }),
      ).toBeVisible()
      await scoped.getByRole('link', { name: 'Planned-event history', exact: true }).click()
      await expect(
        scoped.getByRole('link', { name: 'Plan event demand', exact: true }),
      ).toHaveCount(0)
    } else
      await expect(
        scoped.getByRole('heading', { name: 'Autumn service campaign', exact: true }),
      ).toHaveCount(0)
    await context.close()
  }
  expect(errors).toEqual([])
})
