import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { expectRepeatedDownloads } from './helpers/downloads'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { expectPageTitle } from './helpers/typography'

test.use({ actionTimeout: 15_000 })
test('event batches preserve complete comparisons, overlap and scoped history at five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const password = `Batch-${key}`
  const email = `batch-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`batch-approver-${key}@example.com`, password)
  const viewerEmail = `batch-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `batch-${key}`
  await createOrganization(page, { name: `Event batch ${key}`, slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const runPython = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${approver}','approver'),('${viewer}','viewer')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))`)
  const seeded = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/event-handoff-batches.py'),
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
  const selection = (indexes: number[], path = 'new') =>
    `/replenishment/events/batches/${path}?${indexes.map((i) => `handoff=${lines[i].handoff}`).join('&')}`
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const checkWidths = async (name: string) => {
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('[data-page-banner="replenishment"]')).toHaveCount(1)
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      await page.screenshot({
        path: testInfo.outputPath(`event-batch-${name}-${width}.png`),
        fullPage: true,
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.goto('/replenishment/events/handoffs')
  await page.getByRole('link', { name: 'Event batches', exact: true }).click()
  await page.getByRole('link', { name: 'Choose batch lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose batch lines', exact: true })).toBeVisible()
  await expect(
    page.getByRole('table', { name: 'Available handoffs' }).getByRole('row'),
  ).toHaveCount(26)
  await checkWidths('picker')
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await page.getByRole('checkbox', { name: 'Select EVENT-BATCH-001', exact: true }).check()
  await page.getByRole('button', { name: 'Add checked lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 of 50 lines selected' })).toBeVisible()
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('heading', { name: '1 of 50 lines selected' })).toBeVisible()
  await page.getByLabel('Search item or event', { exact: true }).fill('EVENT-BATCH-002')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page).toHaveURL(/q=EVENT-BATCH-002/)
  await expect(
    page.getByRole('table', { name: 'Available handoffs' }).getByRole('checkbox'),
  ).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '1 of 50 lines selected' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select EVENT-BATCH-002', exact: true }).check()
  await page.getByRole('button', { name: 'Add checked lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2 of 50 lines selected' })).toBeVisible()
  await page.getByRole('link', { name: 'Preview batch', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preview batch', exact: true })).toBeVisible()
  await expect(page.getByText('SAR 14.80', { exact: true })).toBeVisible()
  await expect(page.getByText('SAR 11.10', { exact: true })).toBeVisible()
  await checkWidths('preview')
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/events\/batches\/[0-9a-f-]+$/)
  await checkWidths('detail')
  const help = page.getByRole('button', { name: 'Method and assumptions', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(help).toBeFocused()
  const batchUrl = page.url()
  const id = batchUrl.split('/').at(-1)!
  const jsonPath = `/api/event-handoff-batches/${id}/json`
  const csvPath = `/api/event-handoff-batches/${id}/csv`
  const originalJson = await (await page.request.get(jsonPath)).text()
  const originalCsv = await (await page.request.get(csvPath)).text()
  const payload = JSON.parse(originalJson)
  expect(payload.summary.subtotal).toBe('14.80')
  expect(payload.summary.baseline_subtotal).toBe('11.10')
  expect(payload.summary.cost_increase).toBe('3.70')
  expect(payload.selected_quantity_basis).toBe('full_event_adjusted')
  expect(payload.lines).toHaveLength(2)
  expect(payload.lines.map((line: { handoff_id: string }) => line.handoff_id)).toEqual(
    [lines[0].handoff, lines[1].handoff].sort(),
  )
  for (const line of payload.lines) {
    const single = await page.request.get(`/api/event-purchase-handoffs/${line.handoff_id}/json`)
    expect(line).toEqual(await single.json())
    expect(line.estimate.adjusted.quantity).toBe('6')
    expect(line.estimate.baseline.quantity).toBe('4.5')
  }
  expect(originalCsv).toContain('"\'=1+1"')
  expect(originalCsv).toContain('"KG"')
  await expectRepeatedDownloads(page, `event-purchase-handoff-batch-${id}`, {
    json: originalJson,
    csv: originalCsv,
  })
  await page.goto(selection([1, 0], 'preview'))
  await page.getByRole('link', { name: 'Open existing batch', exact: true }).click()
  await expect(page).toHaveURL(batchUrl)
  await page.goto(selection([1, 2], 'preview'))
  await expect(
    page.getByText('1 other batch contains at least one of these lines.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/events\/batches\/[0-9a-f-]+$/)
  await page.goto(batchUrl)
  await expect(
    page.getByText('1 other batch contains at least one of these lines.', { exact: true }),
  ).toBeVisible()

  await page.goto(selection([0, 2], 'preview'))
  await expect(page.getByRole('button', { name: 'Save batch', exact: true })).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s and item_id=%s',(sys.argv[2],'${lines[2].item}'))`)
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Current price evidence no longer matches' }),
  ).toBeVisible()
  await runPython(`import sys,json,psycopg
from uuid import uuid4
def call(user,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.event_purchase_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${lines[0].estimate}',uuid4(),'Replacement'))
call('${approver}','select public.event_purchase_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))`)
  await page.goto(batchUrl)
  await expect(
    page.getByRole('status').filter({ hasText: 'Contains historical or unavailable approvals' }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonPath)).text()).toBe(originalJson)
  expect(await (await page.request.get(csvPath)).text()).toBe(originalCsv)
  await page.goto(
    '/replenishment/events/batches?q=EVENT-BATCH-001&supplier=EVENT-SUP&location=EVENT-DC&selection=historical',
  )
  await expect(
    page.getByRole('link', { name: 'Inspect batch for EVENT-SUP', exact: true }),
  ).toHaveCount(1)
  await checkWidths('history')
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-batch-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await page.goto('/replenishment/events/batches?page=999')
  await expect(page).toHaveURL(/\/replenishment\/events\/batches$/)
  const readerContext = await browser.newContext()
  const reader = await readerContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(batchUrl)
  expect(await (await reader.request.get(jsonPath)).text()).toBe(originalJson)
  await reader.goto('/replenishment/events/batches/new')
  await expect(reader).toHaveURL(/\/replenishment\/events\/batches$/)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(sys.argv[2],'${viewer}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(404)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${viewer}','${location}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(200)
  await readerContext.close()
  const anonymous = await browser.newContext()
  expect(
    (
      await anonymous.request.get(new URL(jsonPath, batchUrl).href, {
        headers: { accept: 'application/json' },
      })
    ).status(),
  ).toBe(401)
  await anonymous.close()
  const invariants = await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(json.dumps([db.execute('select count(*) from public.'+table+' where organization_id=%s',(sys.argv[2],)).fetchone()[0] for table in ['event_purchase_handoff_batches','event_purchase_handoffs','stock_snapshots','open_orders','receipts']]))`)
  expect(JSON.parse(invariants.stdout.trim())).toEqual([2, 30, 31, 2, 0])
  // Genuine independent one-line packages exercise pagination without weakening immutable fixtures.
  await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    for handoff in ${JSON.stringify(lines.slice(3).map((line) => line.handoff))}:
        db.execute('select public.event_purchase_handoff_batch_create(%s,%s::uuid[])',(sys.argv[2],[handoff]))`)
  await page.goto('/replenishment/events/batches?page=2')
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5)
  await page.getByRole('link', { name: 'Previous', exact: true }).click()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(26)
  await page.goto('/replenishment/events/batches?q=ABSENT-EVENT')
  await expect(page.getByText('No batches match these filters.', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
