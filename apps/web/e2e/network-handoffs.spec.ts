import { expectRepeatedDownloads } from './helpers/downloads'
import Papa from 'papaparse'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })

test('network handoffs preserve whole-network downloads, zero branches and all-location history at five widths and RTL', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID()
  const email = `network-${key}@example.com`
  const password = `Network-${key}`
  const user = await createConfirmedUser(email, password)
  const branchEmail = `network-branch-${key}@example.com`
  const branchUser = await createConfirmedUser(branchEmail, password)
  const approverEmail = `network-approver-${key}@example.com`
  const approver = await createConfirmedUser(approverEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `network-${key}`
  await createOrganization(page, { name: `Network ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user, branchUser], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seeded = await python(`
import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
dsn,org,user,branch_user=sys.argv[1:]
source,first,second,item=[uuid4() for _ in range(4)]
policies=[]
with psycopg.connect(dsn) as db:
    db.execute("update public.organizations set arabic_enabled=true where id=%s",(org,))
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(org,branch_user))
    for loc,code,kind,qty in [(source,'WAREHOUSE','central','35.125'),(first,'BRANCH-A','branch','12'),(second,'BRANCH-B','branch','14')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,%s,%s,'SA','Asia/Riyadh')",(loc,org,code,code,kind))
    for loc in [source,first]:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(org,branch_user,loc))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'NETWORK-ITEM','Network item','Test','EA',1,'SAR')",(item,org))
    evidence={'options':{'lead_time':10,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
    for loc,qty,allocated in [(source,'35.125','2.250'),(first,'12','2'),(second,'100','2')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,%s,1,'SAR','EA')",(org,item,loc,qty,allocated))
        run,policy=uuid4(),uuid4()
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())",(run,org,loc,uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'NETWORK-ITEM','EA','available',%s,%s)",(policy,org,run,loc,uuid4(),item,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
        policies.append(policy)
    for loc in [first,second]:
        db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')",(org,source,loc))
with psycopg.connect(dsn) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    for policy in policies[1:]:
        report=db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(org,policy)).fetchone()[0]
        db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(org,policy,uuid4(),report['fingerprint']))
print(json.dumps(dict(source=str(source),second=str(second))))
`)
  const fixture = JSON.parse(seeded.stdout.trim()) as { source: string; second: string }

  const scheduleSeed = await python(`
import sys,json,psycopg
from uuid import uuid4
dsn,org,user,branch_user=sys.argv[1:]
with psycopg.connect(dsn) as db:
    calendar=db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'NETWORK-DATES','Network dates','SA',array[6,7],true) returning id",(org,)).fetchone()[0]
    db.execute("update public.locations set work_calendar_id=%s where organization_id=%s",(calendar,org))
    source_policy=db.execute("select id from public.inventory_policies where organization_id=%s and location_id=%s",(org,'${fixture.source}')).fetchone()[0]
    drafts=[r[0] for r in db.execute("select id from public.replenishment_drafts where organization_id=%s",(org,)).fetchall()]
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    args=(org,drafts,source_policy)
    report=db.execute("select public.network_allocation_preview(%s,%s,%s,'calculated',null,'4.125',true,true)",args).fetchone()[0]
    parent=db.execute("select public.network_allocation_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)",(*args,uuid4(),report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(parent=str(parent))))
`)
  const { parent } = JSON.parse(scheduleSeed.stdout.trim()) as { parent: string }

  const freightSeed = await python(`
import sys,json,psycopg
from uuid import uuid4
dsn,org,user,branch_user=sys.argv[1:]
with psycopg.connect(dsn) as db:
    db.execute("update public.work_calendars set observe_public_holidays=false where organization_id=%s",(org,))
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    preview=db.execute("select public.network_date_preview(%s,%s,'2026-10-10',true)",(org,'${parent}')).fetchone()[0]
    scenario=db.execute("select public.network_date_save(%s,%s,'2026-10-10',true,%s,%s)",(org,'${parent}',uuid4(),preview['fingerprint'])).fetchone()[0]
with psycopg.connect(dsn) as db:
    db.execute("update public.network_links n set freight_basis='per_unit',freight_cost=1.235,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-12' from public.locations l where n.to_location_id=l.id and n.organization_id=%s and l.code='BRANCH-A'",(org,))
    db.execute("update public.network_links n set freight_basis='per_shipment',freight_cost=8.765,currency='KWD',freight_valid_from='2026-10-12' from public.locations l where n.to_location_id=l.id and n.organization_id=%s and l.code='BRANCH-B'",(org,))
print(json.dumps(dict(scenario=str(scenario))))
`)
  const { scenario } = JSON.parse(freightSeed.stdout.trim()) as { scenario: string }

  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')",(sys.argv[2],'${approver}'))`)
  const saveEstimate = async (dateScenario = scenario) => {
    const result = await python(`import sys,psycopg
from uuid import uuid4
import json
with psycopg.connect(sys.argv[1]) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute("select public.network_freight_preview(%s,%s,true)",(sys.argv[2],'${dateScenario}')).fetchone()[0]
    saved=db.execute("select public.network_freight_save(%s,%s,true,%s,%s)",(sys.argv[2],'${dateScenario}',uuid4(),report['fingerprint'])).fetchone()[0]
print(saved)`)
    return result.stdout.trim()
  }

  const estimate = await saveEstimate()
  const approve = async () => {
    const result = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    proposal=db.execute("select public.network_transfer_submit(%s,%s,%s,'Network handoff evidence')",(sys.argv[2],'${estimate}',uuid4())).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub='${approver}',org_id=sys.argv[2],role='authenticated')),))
    db.execute("select public.network_transfer_decide(%s,%s,%s,'approved','Every branch reviewed')",(sys.argv[2],proposal,uuid4()))
print(proposal)`)
    return result.stdout.trim()
  }
  const proposal = await approve()
  await page.goto(`/replenishment/network/review/${proposal}`)
  await page.getByRole('button', { name: 'Save network handoff', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Network handoff · NETWORK-ITEM', exact: true }),
  ).toBeVisible()
  const detail = page.url()
  const handoff = detail.split('/').pop()!
  const json = await page.request.get(`/api/network-handoffs/${handoff}/json`)
  const csv = await page.request.get(`/api/network-handoffs/${handoff}/csv`)
  expect(json.status()).toBe(200)
  expect(csv.status()).toBe(200)
  expect(json.headers()['cache-control']).toBe('private, no-store')
  const originalJson = await json.body()
  const originalCsv = await csv.body()
  const payload = JSON.parse(originalJson.toString())
  expect(payload.schema_version).toBe('network-transfer-handoff-v1')
  expect(payload.proposal.id).toBe(proposal)
  expect(payload.estimate.lines).toHaveLength(2)
  const rows = Papa.parse<Record<string, string>>(originalCsv.toString(), {
    header: true,
    skipEmptyLines: true,
  })
  expect(rows.errors).toEqual([])
  const zero = rows.data.find((row) => row.destination_location_code === 'BRANCH-B')!
  expect(zero).toMatchObject({
    quantity: '0.000',
    transfer_status: 'no_transfer_needed',
    dispatch_date: '',
    typical_receipt_date: '',
    slow_receipt_date: '',
    subtotal: '',
    currency: 'KWD',
  })
  await expectRepeatedDownloads(page, `network-handoff-${handoff}`, {
    json: originalJson,
    csv: originalCsv,
  })
  const table = page.getByRole('region', { name: 'Branch freight estimates', exact: true })
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
    expect(
      await page
        .locator('.text-evidence-value')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px')
    await table.focus()
    await expect(table).toBeFocused()
    await page.screenshot({
      path: testInfo.outputPath(`network-handoff-${width}.png`),
      fullPage: true,
    })
  }
  await page.goto(`/replenishment/network/review/${proposal}`)
  await page.getByRole('link', { name: 'Open saved network handoff', exact: true }).click()
  await expect(page).toHaveURL(detail)
  const later = await approve()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.network_links set freight_cost=2 where organization_id=%s",(sys.argv[2],))`)
  await page.reload()
  await expect(
    page.getByRole('status', { name: '' }).filter({ hasText: 'Historical selection' }),
  ).toBeVisible()
  expect(await (await page.request.get(`/api/network-handoffs/${handoff}/json`)).body()).toEqual(
    originalJson,
  )
  expect(await (await page.request.get(`/api/network-handoffs/${handoff}/csv`)).body()).toEqual(
    originalCsv,
  )
  await page.goto(`/replenishment/network/review/${later}`)
  await page.getByRole('button', { name: 'Save network handoff', exact: true }).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /Current freight, lane or location evidence differs/ }),
  ).toBeVisible()
  await page.goto('/replenishment/network')
  await page.getByRole('link', { name: 'Network transfer handoffs', exact: true }).click()
  await page.getByLabel('Search item, warehouse or branch', { exact: true }).fill('BRANCH-B')
  await page
    .getByRole('combobox', { name: 'Draft selection', exact: true })
    .selectOption('historical')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open NETWORK-ITEM', exact: true })).toHaveCount(1)
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  expect((await branchPage.goto(detail))?.status()).toBe(404)
  for (const format of ['json', 'csv'])
    expect(
      (await branchPage.request.get(`/api/network-handoffs/${handoff}/${format}`)).status(),
    ).toBe(404)
  await branchPage.goto('/replenishment/network/handoffs')
  await expect(
    branchPage.getByRole('link', { name: 'Open NETWORK-ITEM', exact: true }),
  ).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations values(%s,%s,%s)",(sys.argv[2],sys.argv[4],'${fixture.second}'))`)
  await branchPage.goto(detail)
  await expect(
    branchPage.getByRole('heading', { name: 'Network handoff · NETWORK-ITEM', exact: true }),
  ).toBeVisible()
  await expectRepeatedDownloads(branchPage, `network-handoff-${handoff}`, {
    json: originalJson,
    csv: originalCsv,
  })
  await branchPage.goto(`/replenishment/network/review/${later}`)
  await expect(
    branchPage.getByRole('button', { name: 'Save network handoff', exact: true }),
  ).toHaveCount(0)
  await branchPage.goto('/replenishment/network/handoffs?q=BRANCH-B')
  await expect(
    branchPage.getByRole('link', { name: 'Open NETWORK-ITEM', exact: true }),
  ).toHaveCount(1)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await branchPage.setViewportSize({ width, height: 900 })
    expect(
      await branchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await branchPage.screenshot({
      path: testInfo.outputPath(`network-handoff-history-${width}.png`),
      fullPage: true,
    })
  }
  await branchContext.addCookies([{ name: 'locale', value: 'ar', url: new URL(detail).origin }])
  await branchPage.goto(detail)
  await expect(branchPage.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await branchPage.setViewportSize({ width, height: 900 })
    expect(
      await branchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await branchPage.screenshot({
      path: testInfo.outputPath(`network-handoff-ar-${width}.png`),
      fullPage: true,
    })
  }
  await branchContext.close()
})
