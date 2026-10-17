import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('transfer handoffs retain exact downloads and both-location history at five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID()
  const email = `review-${key}@example.com`
  const password = `Dates-${key}`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `review-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `review-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  const approverEmail = `review-approver-${key}@example.com`
  const approver = await createConfirmedUser(approverEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `review-${key}`
  await createOrganization(page, { name: `Transfer dates ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const sourceCode = `SOURCE-${'A'.repeat(57)}`
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)(
      'uv',
      ['run', 'python', '-c', code, dsn, org, user, viewer, branch, approver],
      {
        cwd: resolve(process.cwd(), '../../engine'),
        timeout: 100_000,
      },
    )
  const seeded = await python(`
import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
dsn,org,user,viewer,branch,approver=sys.argv[1:]
destination,source,item,supplier=[uuid4() for _ in range(4)]
policies=[]
with psycopg.connect(dsn) as db:
    for actor,role in [(viewer,'viewer'),(branch,'branch_user'),(approver,'approver')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,actor,role))
    for loc,code in [(destination,'DESTINATION'),(source,'${sourceCode}')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,%s,'branch','SA','Asia/Riyadh')",(loc,org,code,code))
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(org,branch,destination))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'DATE-ITEM','Transfer item','Test','EA',1,'SAR')",(item,org))
    for loc,qty in [(destination,'12'),(source,'35.125')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,2,1,'SAR','EA')",(org,item,loc,qty))
    evidence={'options':{'lead_time':10,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
    for loc in [destination,source]:
        run,policy=uuid4(),uuid4()
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())",(run,org,loc,uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'DATE-ITEM','EA','available',%s,%s)",(policy,org,run,loc,uuid4(),item,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
        policies.append(policy)
    db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')",(org,source,destination))
    db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',3,3)",(supplier,org))
    db.execute("insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,unit_of_measure) values(%s,'LATE','1',%s,%s,%s,'2026-10-18',2,1,'SAR','EA')",(org,item,destination,supplier))
with psycopg.connect(dsn) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    report=db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(org,policies[0])).fetchone()[0]
    draft=db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(org,policies[0],uuid4(),report['fingerprint'])).fetchone()[0]
    report=db.execute("select public.redistribution_preview(%s,%s,%s,'calculated',null,'4.125',true,true)",(org,draft,policies[1])).fetchone()[0]
    saved=db.execute("select public.redistribution_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)",(org,draft,policies[1],uuid4(),report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(draft=str(saved),source=str(source))))
`)
  const fixture = JSON.parse(seeded.stdout.trim()) as { draft: string; source: string }
  const dateResult = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    calendar=db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'FREIGHT','Synthetic freight','SA',array[5,6],false) returning id",(sys.argv[2],)).fetchone()[0]
    db.execute('update public.locations set work_calendar_id=%s where organization_id=%s',(calendar,sys.argv[2]))
    lane=db.execute('select id from public.network_links where organization_id=%s',(sys.argv[2],)).fetchone()[0]
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute("select public.transfer_date_preview(%s,%s,'2026-10-10',true)",(sys.argv[2],'${fixture.draft}')).fetchone()[0]
    saved=db.execute("select public.transfer_date_save(%s,%s,'2026-10-10',true,%s,%s)",(sys.argv[2],'${fixture.draft}',uuid4(),report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(scenario=str(saved),lane=str(lane))))`)
  const dates = JSON.parse(dateResult.stdout.trim()) as { scenario: string; lane: string }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-11' where organization_id=%s",(sys.argv[2],))`)
  const saveEstimate = async (scenario = dates.scenario) => {
    const result = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute('select public.transfer_freight_preview(%s,%s,true)',(sys.argv[2],'${scenario}')).fetchone()[0]
    saved=db.execute('select public.transfer_freight_save(%s,%s,true,%s,%s)',(sys.argv[2],'${scenario}',uuid4(),report['fingerprint'])).fetchone()[0]
print(saved)`)
    return result.stdout.trim()
  }
  const approve = async (estimate: string) => {
    const result = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    proposal=db.execute('select public.transfer_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${estimate}',uuid4(),'Move surplus for demand')).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[6],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.transfer_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Independently checked'))
print(proposal)`)
    return result.stdout.trim()
  }
  const proposal = await approve(await saveEstimate())
  const reviewUrl = `/replenishment/redistribution/review/${proposal}`
  await page.goto(reviewUrl)
  const save = page.getByRole('button', { name: 'Save transfer handoff', exact: true })
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Transfer handoff · DATE-ITEM', exact: true }),
  ).toBeVisible()
  const firstUrl = page.url()
  const handoffId = firstUrl.split('/').at(-1)!
  const jsonPath = `/api/transfer-handoffs/${handoffId}/json`
  const json = await page.request.get(jsonPath)
  expect(json.status()).toBe(200)
  expect(json.headers()['cache-control']).toBe('private, no-store')
  const originalJson = await json.body()
  const payload = JSON.parse(originalJson.toString('utf8'))
  expect(payload).toMatchObject({
    schema_version: 'transfer-handoff-v1',
    purpose: 'planning_only',
    proposal: { id: proposal },
  })
  expect(payload.estimate.source.source.quantity).toBe('9.000')
  expect(payload.estimate.source.dispatch.date).toBe('2026-10-11')
  expect(payload.estimate.source.receipts.p50.search.date).toBe('2026-10-13')
  expect(payload.estimate.source.receipts.p90.search.date).toBe('2026-10-15')
  expect(payload.estimate.subtotal).toBe('11.11')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download JSON', exact: true }).click()
  const downloaded = await downloadEvent
  expect(downloaded.suggestedFilename()).toBe(`transfer-handoff-${handoffId}.json`)
  const stream = await downloaded.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(originalJson)
  const csv = await page.request.get(`/api/transfer-handoffs/${handoffId}/csv`)
  const originalCsv = await csv.body()
  expect(originalCsv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  expect(originalCsv.toString('utf8')).toContain(
    '"typical_receipt_date","slow_lead_time_days","slow_receipt_date"',
  )
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`transfer-handoff-detail-${width}.png`),
      fullPage: true,
    })
  }
  await page.goto(reviewUrl)
  await expect(
    page.getByRole('link', { name: 'Open saved transfer handoff', exact: true }),
  ).toBeVisible()
  await expect(save).toHaveCount(0)
  const second = await approve(await saveEstimate())
  await page.goto(`/replenishment/redistribution/review/${second}`)
  await expect(save).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=2 where organization_id=%s',(sys.argv[2],))`)
  await save.click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Freight, lane or location evidence changed' }),
  ).toBeVisible()
  const third = await approve(await saveEstimate())
  await page.goto(`/replenishment/redistribution/review/${third}`)
  await save.click()
  await expect(
    page.getByRole('heading', { name: 'Transfer handoff · DATE-ITEM', exact: true }),
  ).toBeVisible()
  await page.goto(firstUrl)
  await expect(page.getByText('Historical selection', { exact: true })).toBeVisible()
  await expect(page.getByText(/Freight, lane or location evidence changed/)).toBeVisible()
  expect(await (await page.request.get(jsonPath)).body()).toEqual(originalJson)
  expect(await (await page.request.get(`/api/transfer-handoffs/${handoffId}/csv`)).body()).toEqual(
    originalCsv,
  )
  await page.goto(
    `/replenishment/redistribution/handoffs?q=DATE-ITEM&source=${sourceCode}&location=DESTINATION&page=999`,
  )
  await expect(page.getByText('2 handoffs', { exact: true })).toBeVisible()
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const table = page.getByRole('region', { name: 'Transfer handoffs', exact: true })
    await table.focus()
    await expect(table).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.screenshot({
      path: testInfo.outputPath(`transfer-handoff-history-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .getByRole('combobox', { name: 'Draft selection', exact: true })
    .selectOption('historical')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('1 handoffs', { exact: true })).toBeVisible()
  await page.getByLabel('Search items or locations', { exact: true }).fill('MISSING')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('0 handoffs', { exact: true })).toBeVisible()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  expect((await viewerPage.request.get(jsonPath)).status()).toBe(401)
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(firstUrl)
  await expect(viewerPage.getByRole('link', { name: 'Download JSON', exact: true })).toBeVisible()
  expect(await (await viewerPage.request.get(jsonPath)).body()).toEqual(originalJson)
  await viewerPage.goto(`/replenishment/redistribution/review/${third}`)
  await expect(
    viewerPage.getByRole('button', { name: 'Save transfer handoff', exact: true }),
  ).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  expect((await branchPage.request.get(jsonPath)).status()).toBe(404)
  await branchPage.goto('/replenishment/redistribution/handoffs')
  await expect(branchPage.getByText('0 handoffs', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[5],'${fixture.source}'))`)
  await branchPage.goto(firstUrl)
  await expect(branchPage.getByRole('link', { name: 'Download CSV', exact: true })).toBeVisible()
  expect(await (await branchPage.request.get(jsonPath)).body()).toEqual(originalJson)
  await branchContext.close()
})
