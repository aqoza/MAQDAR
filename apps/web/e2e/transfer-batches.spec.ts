import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { expectRepeatedDownloads } from './helpers/downloads'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })
test('handoff batches preserve lines, overlap, history and scoped downloads', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const password = `Batch-${key}`
  const email = `batch-${key}@example.com`
  const user = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`batch-approver-${key}@example.com`, password)
  const viewerEmail = `batch-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `batch-${key}`
  await createOrganization(page, { name: `Batch ${key}`, slug })
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
      resolve(process.cwd(), 'e2e/fixtures/transfer-batches.py'),
      dsn,
      org,
      user,
      approver,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const { lines, location, source } = JSON.parse(seeded.stdout.trim()) as {
    lines: { handoff: string; item: string; estimate: string; proposal: string }[]
    location: string
    source: string
  }
  const selection = (indexes: number[], path = 'new') =>
    `/replenishment/redistribution/batches/${path}?${indexes.map((i) => `handoff=${lines[i].handoff}`).join('&')}`
  await page.goto('/replenishment/redistribution/handoffs')
  await page.getByRole('link', { name: 'Transfer handoff batches', exact: true }).click()
  await page.getByRole('link', { name: 'Choose batch lines', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select BATCH-1', exact: true }).check()
  await page.getByRole('button', { name: 'Add checked lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 of 50 lines selected' })).toBeVisible()
  await page.getByLabel('Search item codes', { exact: true }).fill('BATCH-2')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page).toHaveURL(/q=BATCH-2/)
  await expect(
    page.getByRole('table', { name: 'Available handoffs' }).getByRole('checkbox'),
  ).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '1 of 50 lines selected' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select BATCH-2', exact: true }).check()
  await page.getByRole('button', { name: 'Add checked lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2 of 50 lines selected' })).toBeVisible()
  await page.getByRole('link', { name: 'Preview batch', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preview batch', exact: true })).toBeVisible()
  await expect(page.getByText('SAR 2.02', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/redistribution\/batches\/[0-9a-f-]+$/)
  const batchUrl = page.url()
  const id = batchUrl.split('/').at(-1)!
  const jsonPath = `/api/transfer-batches/${id}/json`
  const csvPath = `/api/transfer-batches/${id}/csv`
  const originalJson = await (await page.request.get(jsonPath)).text()
  const originalCsv = await (await page.request.get(csvPath)).text()
  const payload = JSON.parse(originalJson)
  expect(payload.summary.subtotal).toBe('2.02')
  expect(payload.lines).toHaveLength(2)
  expect(payload.lines.map((line: { handoff_id: string }) => line.handoff_id)).toEqual(
    [lines[0].handoff, lines[1].handoff].sort(),
  )
  for (const line of payload.lines) {
    const single = await page.request.get(`/api/transfer-handoffs/${line.handoff_id}/json`)
    expect(line).toEqual(await single.json())
  }
  expect(originalCsv).toContain('"\'=1+1"')
  expect(originalCsv).toContain('"KG"')
  await expectRepeatedDownloads(page, `transfer-handoff-batch-${id}`, {
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
  await expect(page).toHaveURL(/\/replenishment\/redistribution\/batches\/[0-9a-f-]+$/)
  await page.goto(batchUrl)
  await expect(
    page.getByText('1 other batch contains at least one of these lines.', { exact: true }),
  ).toBeVisible()
  const checkWidths = async (screen: string) => {
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const table = page
        .getByRole('region', {
          name:
            screen === 'detail' || screen === 'preview'
              ? 'Saved line evidence'
              : 'Transfer handoff batches',
          exact: true,
        })
        .and(page.locator('[tabindex="0"]'))
      await table.focus()
      await expect(table).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await page.screenshot({
        path: testInfo.outputPath(`transfer-batch-${screen}-${width}.png`),
        fullPage: true,
      })
    }
  }
  await checkWidths('detail')
  await page.goto('/replenishment/redistribution/batches')
  await checkWidths('history')
  await page.goto(selection([0], 'new'))
  await checkWidths('picker')
  await page.goto(selection([0, 2], 'preview'))
  await expect(page.getByRole('button', { name: 'Save batch', exact: true })).toBeVisible()
  await checkWidths('preview')
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=2 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Freight, lane or location evidence changed' }),
  ).toBeVisible()
  await runPython(`import sys,json,psycopg
from uuid import uuid4
def call(user,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=1.005 where organization_id=%s',(sys.argv[2],))
scenario=call(sys.argv[3],'select scenario_id from public.transfer_freight_estimates where organization_id=%s and id=%s',(sys.argv[2],'${lines[0].estimate}'))
report=call(sys.argv[3],'select public.transfer_freight_preview(%s,%s,true)',(sys.argv[2],scenario))
estimate=call(sys.argv[3],'select public.transfer_freight_save(%s,%s,true,%s,%s)',(sys.argv[2],scenario,uuid4(),report['fingerprint']))
proposal=call(sys.argv[3],'select public.transfer_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],estimate,uuid4(),'Replacement'))
call('${approver}','select public.transfer_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))`)
  await page.goto(batchUrl)
  await expect(
    page.getByRole('status').filter({ hasText: 'Contains historical or unavailable approvals' }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonPath)).text()).toBe(originalJson)
  expect(await (await page.request.get(csvPath)).text()).toBe(originalCsv)
  await page.goto(
    '/replenishment/redistribution/batches?q=BATCH-1&source=SOURCE&location=DESTINATION&selection=historical',
  )
  await expect(
    page.getByRole('link', { name: 'Inspect batch for SOURCE', exact: true }),
  ).toHaveCount(1)
  await page.goto('/replenishment/redistribution/batches?page=999')
  await expect(page).toHaveURL(/\/replenishment\/redistribution\/batches$/)
  const readerContext = await browser.newContext()
  const reader = await readerContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(batchUrl)
  expect(await (await reader.request.get(jsonPath)).text()).toBe(originalJson)
  await reader.goto('/replenishment/redistribution/batches/new')
  await expect(reader).toHaveURL(/\/replenishment\/redistribution\/batches$/)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(sys.argv[2],'${viewer}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(404)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${viewer}','${location}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(404)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${viewer}','${source}'))`)
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
    print(json.dumps([db.execute('select count(*) from public.'+table+' where organization_id=%s',(sys.argv[2],)).fetchone()[0] for table in ['transfer_handoff_batches','transfer_handoffs','stock_snapshots','open_orders','receipts']]))`)
  expect(JSON.parse(invariants.stdout.trim())).toEqual([2, 3, 6, 0, 0])
})
