import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle } from './helpers/typography'

test.use({ actionTimeout: 30_000 })
test('capacity retains exact evidence, checks selection and fits five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const password = `Capacity-${key}`
  const email = `capacity-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`capacity-approver-${key}@example.com`, password)
  const viewerEmail = `capacity-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `capacity-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `capacity-${key}`
  await createOrganization(page, { name: 'Acme capacity planning', slug, arabicEnabled: true })
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
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${approver}','approver'),('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))`)
  const seeded = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/handoff-batches.py'),
      dsn,
      org,
      user,
      approver,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const { lines, location } = JSON.parse(seeded.stdout.trim()) as {
    lines: { handoff: string; item: string; estimate: string; proposal: string }[]
    location: string
  }
  const prepared = await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    batch=db.execute('select public.purchase_handoff_batch_create(%s,%s::uuid[])',(sys.argv[2],['${lines[0].handoff}','${lines[1].handoff}'])).fetchone()[0]
print(batch)`)
  const batch = prepared.stdout.trim()
  const url = `/replenishment/capacity/new?batch=${batch}`
  const preview = `${url}&volume=10&payload=100&confirmed=true`
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/replenishment/batches/${batch}`)
  await page.getByRole('link', { name: 'Container capacity', exact: true }).click()
  await page.getByLabel('Usable volume (m³)', { exact: true }).fill('10')
  await page.getByLabel('Payload limit (kg)', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Check capacity' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Capacity unavailable')
  await expect(page.getByRole('button', { name: 'Save capacity scenario' })).toHaveCount(0)
  const measurements = async (volume = '0.000001', weight = '2.5') =>
    python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.supplier_items set shipping_weight_kg=%s,shipping_volume_m3=%s,shipping_valid_from='2026-10-10' where organization_id=%s",('${weight}','${volume}',sys.argv[2]))`)
  await measurements()
  await page.reload()
  await expect(page.locator('tbody')).toContainText('Confirm measurement applicability')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Check capacity' }).click()
  await expect(page.getByRole('status')).toContainText('Within entered capacity limits')
  await expect(page.getByText('90 kg', { exact: true })).toBeVisible()
  await expect(page.getByText('0.000036 m³', { exact: true })).toBeVisible()
  // Saved batch lines are sorted by their UUIDs, so locate the EA row rather than assuming order.
  const disclosure = page.locator('tbody tr').filter({ hasText: '18 EA' }).locator('summary')
  await disclosure.focus()
  await expect(disclosure).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('2.5 kg · 0.000001 m³ per EA', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectPageTitle(page.getByRole('heading', { level: 1 }))
    await expect(page.locator('tbody tr').first()).toHaveCSS('font-size', '14px')
    for (const control of await page.locator('main input:not([type=hidden]):visible').all()) {
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    }
    const region = page.getByRole('region', { name: 'Capacity line contributions' })
    await region.focus()
    if (await region.evaluate((e) => e.scrollWidth > e.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
      await region.evaluate((e) => {
        e.scrollLeft = 0
      })
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`capacity-${width}.png`), fullPage: true })
  }
  await measurements('999999999.999999', '999999999.999999')
  await page.goto(`${url}&volume=0.000001&payload=0.000001&confirmed=true`)
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.goto(preview)
  await measurements('0.2')
  await page.getByRole('button', { name: 'Save capacity scenario' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('changed')
  await page.goto(preview)
  await page.getByLabel('Usable volume (m³)', { exact: true }).fill('7.199999')
  await page.getByRole('button', { name: 'Check capacity' }).click()
  await expect(page.getByRole('status')).toContainText('Exceeds entered capacity limits')
  await page.getByRole('button', { name: 'Save capacity scenario' }).click()
  await expect(page).toHaveURL(/\/replenishment\/capacity\/[0-9a-f-]+$/)
  const savedUrl = page.url()
  await expect(page.getByText('7.2 m³', { exact: true })).toBeVisible()
  await measurements('0.3')
  await page.reload()
  await expect(page.getByText('7.2 m³', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Purchase batch', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved capacity scenarios' })).toBeVisible()
  await expect(page.locator(`a[href="${new URL(savedUrl).pathname}"]`)).toBeVisible()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(savedUrl)
  await expect(viewerPage.getByText('7.2 m³', { exact: true })).toBeVisible()
  await viewerPage.goto(preview)
  await expect(viewerPage.getByRole('button', { name: 'Save capacity scenario' })).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  const hidden = await branchPage.goto(savedUrl)
  expect(hidden?.status()).toBe(404)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${location}'))`)
  await branchPage.reload()
  await expect(branchPage.getByText('7.2 m³', { exact: true })).toBeVisible()
  await branchContext.close()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.purchase_proposals set status='rejected' where id=%s",('${lines[0].proposal}',))`)
  await page.goto(savedUrl)
  await expect(
    page.getByText('This batch has historical or unavailable selections.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('7.2 m³', { exact: true })).toBeVisible()
  await page.goto(preview)
  await expect(page.locator('tbody')).toContainText('Proposal no longer selected')
  await expect(page.getByRole('button', { name: 'Save capacity scenario' })).toHaveCount(0)
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(savedUrl)
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: testInfo.outputPath(`capacity-ar-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
