import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })

test('purchase handoffs preserve exact downloads, history and access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `draft-${key}@example.com`
  const password = `Draft-${key}`
  const user = await createConfirmedUser(email, password)
  const approverEmail = `purchase-reviewer-${key}@example.com`
  const viewerEmail = `purchase-viewer-${key}@example.com`
  const approver = await createConfirmedUser(approverEmail, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `draft-${key}`
  await createOrganization(page, { name: `Draft ${key}`, slug })
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
  const { stdout } = await runPython(`
import sys,json,psycopg
from uuid import uuid4
from maqdar_engine.worker import process_one
dsn,org,user=sys.argv[1:]
location,item,supplier=[uuid4() for _ in range(3)]
with psycopg.connect(dsn) as db:
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'DRAFT','Draft branch','branch','SA','Asia/Riyadh')",(location,org))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'DRAFT-ITEM','Item','Test','EA',1,'SAR')",(item,org))
    db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',3,3)",(supplier,org))
    db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,unit_of_measure) select %s,%s,%s,d::date,2,'EA' from generate_series('2026-07-01'::date,'2026-10-10'::date,'1 day') d",(org,item,location))
    db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',12,2,1,'SAR','EA')",(org,item,location))
    for code,day,qty in [('OVERDUE','2026-10-09','3.25'),('LATE','2026-10-18','2.75')]:
        db.execute("insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,unit_of_measure) values(%s,%s,'1',%s,%s,%s,%s,%s,1,'SAR','EA')",(org,code,item,location,supplier,day,qty))
def enqueue(sql,args):
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
def work():
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute('set role maqdar_worker')
        assert process_one(db)
run=enqueue("select public.forecast_enqueue(%s,'DRAFT','2026-07-01','2026-10-10',%s,true,array['DRAFT-ITEM'],7)",(org,uuid4()))
work()
with psycopg.connect(dsn) as db:
    forecast=db.execute('select id from public.forecast_results where run_id=%s',(run,)).fetchone()[0]
run=enqueue('select public.policy_enqueue(%s,%s,%s,3,4,0.95)',(org,forecast,uuid4()))
work()
with psycopg.connect(dsn) as db:
    policy=db.execute('select id from public.inventory_policies where run_id=%s',(run,)).fetchone()[0]
    calendar=db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'ALL','Every day','SA','{}',false) returning id",(org,)).fetchone()[0]
    db.execute('update public.suppliers set work_calendar_id=%s where organization_id=%s',(calendar,org))
    db.execute('update public.locations set work_calendar_id=%s where organization_id=%s',(calendar,org))
    db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from) values(%s,%s,%s,3,10,6,1.005,'SAR','EA','2026-10-10')",(org,supplier,item))
draft_preview=enqueue("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(org,policy))
draft=enqueue("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(org,policy,uuid4(),draft_preview['fingerprint']))
supplier_preview=enqueue("select public.supplier_scenario_preview(%s,%s,'SUP',true)",(org,draft))
scenario=enqueue("select public.supplier_scenario_save(%s,%s,'SUP',true,%s,%s)",(org,draft,uuid4(),supplier_preview['fingerprint']))
estimates=[]
for day in ['2026-10-10','2026-10-11']:
    report=enqueue('select public.delivery_scenario_preview(%s,%s,%s,true)',(org,scenario,day))
    delivery=enqueue('select public.delivery_scenario_save(%s,%s,%s,true,%s,%s)',(org,scenario,day,uuid4(),report['fingerprint']))
    report=enqueue('select public.purchase_cost_preview(%s,%s,true)',(org,delivery))
    estimates.append(str(enqueue('select public.purchase_cost_save(%s,%s,true,%s,%s)',(org,delivery,uuid4(),report['fingerprint']))))
print(json.dumps(dict(estimates=estimates,draft=str(draft))))
`)
  const { estimates, draft } = JSON.parse(stdout.trim()) as { estimates: string[]; draft: string }

  const approve = async () => {
    const result = await runPython(`import sys,json,psycopg
from uuid import uuid4
def call(user,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.purchase_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${estimates[0]}',uuid4(),'=1+1'))
call('${approver}','select public.purchase_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Independent review'))
print(proposal)`)
    return result.stdout.trim()
  }
  const first = await approve()
  const savedEstimate = JSON.parse(
    (
      await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(json.dumps(db.execute('select report from public.purchase_cost_estimates where organization_id=%s and id=%s',(sys.argv[2],'${estimates[0]}')).fetchone()[0]))`)
    ).stdout.trim(),
  )
  await page.goto(`/replenishment/review/${first}`)
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/handoffs\/[0-9a-f-]+$/)
  await expect(
    page.getByRole('heading', { name: 'Purchase handoff · DRAFT-ITEM', exact: true }),
  ).toBeVisible()
  const handoffUrl = page.url()
  const handoffId = handoffUrl.split('/').at(-1)!
  const jsonPath = `/api/purchase-handoffs/${handoffId}/json`
  const csvPath = `/api/purchase-handoffs/${handoffId}/csv`
  const jsonResponse = await page.request.get(jsonPath)
  expect(jsonResponse.status()).toBe(200)
  expect(jsonResponse.headers()['cache-control']).toBe('private, no-store')
  const originalJson = await jsonResponse.text()
  const payload = JSON.parse(originalJson)
  expect(payload.purpose).toBe('planning_only')
  expect(payload.proposal.id).toBe(first)
  expect(payload.proposal.reason).toBe('=1+1')
  expect(payload.estimate).toEqual(savedEstimate)
  expect(payload.estimate.source.quantity).toMatch(/^12(?:\.0+)?$/)
  expect(payload.estimate.subtotal).toBe('12.06')
  expect(payload.proposal.draft_id).toBe(draft)
  const originalCsv = await (await page.request.get(csvPath)).text()
  expect(originalCsv).toContain(`"'=1+1"`)
  expect(originalCsv).toContain('"12.06"')
  const downloading = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download JSON', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe(`purchase-handoff-${handoffId}.json`)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString('utf8')).toBe(originalJson)
  await page.screenshot({
    path: resolve(process.cwd(), '../../test-results/step15-handoff.png'),
    fullPage: true,
  })

  await page.goto(`/replenishment/review/${first}`)
  await expect(page.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Open saved handoff', exact: true }).click()
  await expect(page).toHaveURL(handoffUrl)
  const second = await approve()
  await page.goto(`/replenishment/review/${second}`)
  // A change after rendering is rejected by the save RPC.
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'no longer matches' })).toBeVisible()
  await page.goto(handoffUrl)
  await expect(page.getByRole('status').filter({ hasText: 'Historical approval' })).toBeVisible()
  await expect(
    page.getByText('Current price evidence no longer matches', { exact: false }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonPath)).text()).toBe(originalJson)
  expect(await (await page.request.get(csvPath)).text()).toBe(originalCsv)
  await page.goto(
    '/replenishment/handoffs?q=DRAFT-ITEM&supplier=SUP&location=DRAFT&selection=historical',
  )
  await expect(page.getByRole('link', { name: 'Inspect DRAFT-ITEM', exact: true })).toHaveCount(1)
  await page.goto('/replenishment/handoffs?selection=current')
  await expect(page.getByText('No handoffs match these filters.', { exact: false })).toBeVisible()
  await page.goto('/replenishment/handoffs?page=999&size=25')
  await expect(page).toHaveURL(/\/replenishment\/handoffs$/)

  const readerContext = await browser.newContext()
  const reader = await readerContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(handoffUrl)
  await expect(reader.getByRole('link', { name: 'Download JSON', exact: true })).toBeVisible()
  expect(await (await reader.request.get(jsonPath)).text()).toBe(originalJson)
  await reader.goto(`/replenishment/review/${second}`)
  await expect(reader.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(sys.argv[2],'${viewer}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(404)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${viewer}','${payload.estimate.location_id}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(200)
  await readerContext.close()
  const anonymous = await browser.newContext()
  expect(
    (
      await anonymous.request.get(new URL(jsonPath, handoffUrl).href, {
        headers: { accept: 'application/json' },
      })
    ).status(),
  ).toBe(401)
  await anonymous.close()
  const invariants = await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(json.dumps([db.execute('select count(*) from public.'+table+' where organization_id=%s',(sys.argv[2],)).fetchone()[0] for table in ['purchase_handoffs','stock_snapshots','open_orders','receipts']]))`)
  expect(JSON.parse(invariants.stdout.trim())).toEqual([1, 1, 2, 0])
  await testInfo.attach('handoff-json', { body: originalJson, contentType: 'application/json' })
})
