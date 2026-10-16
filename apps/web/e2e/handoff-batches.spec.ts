import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })
test('handoff batches preserve lines, overlap, history and scoped downloads', async ({
  page,
  browser,
}) => {
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
  const selection = (indexes: number[], path = 'new') =>
    `/replenishment/batches/${path}?${indexes.map((i) => `handoff=${lines[i].handoff}`).join('&')}`
  await page.goto('/replenishment/handoffs')
  await page.getByRole('link', { name: 'Purchase handoff batches', exact: true }).click()
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
  await expect(page.getByText('SAR 36.18', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/batches\/[0-9a-f-]+$/)
  const batchUrl = page.url()
  const id = batchUrl.split('/').at(-1)!
  const jsonPath = `/api/handoff-batches/${id}/json`
  const csvPath = `/api/handoff-batches/${id}/csv`
  const originalJson = await (await page.request.get(jsonPath)).text()
  const originalCsv = await (await page.request.get(csvPath)).text()
  const payload = JSON.parse(originalJson)
  expect(payload.summary.subtotal).toBe('36.18')
  expect(payload.lines).toHaveLength(2)
  expect(payload.lines.map((line: { handoff_id: string }) => line.handoff_id)).toEqual(
    [lines[0].handoff, lines[1].handoff].sort(),
  )
  for (const line of payload.lines) {
    const single = await page.request.get(`/api/purchase-handoffs/${line.handoff_id}/json`)
    expect(line).toEqual(await single.json())
  }
  expect(originalCsv).toContain('"\'=1+1"')
  expect(originalCsv).toContain('"KG"')
  const downloading = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download JSON', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe(`purchase-handoff-batch-${id}.json`)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString('utf8')).toBe(originalJson)
  await page.goto(selection([1, 0], 'preview'))
  await page.getByRole('link', { name: 'Open existing batch', exact: true }).click()
  await expect(page).toHaveURL(batchUrl)
  await page.goto(selection([1, 2], 'preview'))
  await expect(
    page.getByText('1 other batch contains at least one of these lines.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/batches\/[0-9a-f-]+$/)
  await page.goto(batchUrl)
  await expect(
    page.getByText('1 other batch contains at least one of these lines.', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: resolve(process.cwd(), '../../test-results/step15b-batch.png'),
    fullPage: true,
  })
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
proposal=call(sys.argv[3],'select public.purchase_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${lines[0].estimate}',uuid4(),'Replacement'))
call('${approver}','select public.purchase_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))`)
  await page.goto(batchUrl)
  await expect(
    page.getByRole('status').filter({ hasText: 'Contains historical or unavailable approvals' }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonPath)).text()).toBe(originalJson)
  expect(await (await page.request.get(csvPath)).text()).toBe(originalCsv)
  await page.goto(
    '/replenishment/batches?q=BATCH-1&supplier=SUP&location=BATCH&selection=historical',
  )
  await expect(page.getByRole('link', { name: 'Inspect batch for SUP', exact: true })).toHaveCount(
    1,
  )
  await page.goto('/replenishment/batches?page=999')
  await expect(page).toHaveURL(/\/replenishment\/batches$/)
  const readerContext = await browser.newContext()
  const reader = await readerContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(batchUrl)
  expect(await (await reader.request.get(jsonPath)).text()).toBe(originalJson)
  await reader.goto('/replenishment/batches/new')
  await expect(reader).toHaveURL(/\/replenishment\/batches$/)
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
    print(json.dumps([db.execute('select count(*) from public.'+table+' where organization_id=%s',(sys.argv[2],)).fetchone()[0] for table in ['purchase_handoff_batches','purchase_handoffs','stock_snapshots','open_orders','receipts']]))`)
  expect(JSON.parse(invariants.stdout.trim())).toEqual([2, 3, 3, 0, 0])
})
