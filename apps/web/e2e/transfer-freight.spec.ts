import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('transfer freight preserves quoted amounts, date warnings and both-location access at five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const email = `freight-${key}@example.com`
  const password = `Dates-${key}`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `freight-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `freight-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `freight-${key}`
  await createOrganization(page, { name: `Transfer dates ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const sourceCode = `SOURCE-${'A'.repeat(57)}`
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seeded = await python(`
import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
dsn,org,user,viewer,branch=sys.argv[1:]
destination,source,item,supplier=[uuid4() for _ in range(4)]
policies=[]
with psycopg.connect(dsn) as db:
    for actor,role in [(viewer,'viewer'),(branch,'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,actor,role))
    for loc,code in [(destination,'DESTINATION'),(source,'${sourceCode}')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,%s,'branch','SA','Asia/Riyadh')",(loc,org,code,code))
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(org,branch,destination))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'DATE-ITEM','Transfer item','Test','EA',1,'SAR')",(item,org))
    for loc,qty in [(destination,'12'),(source,'35.125')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,2,1,'SAR','EA')",(org,item,loc,qty))
    evidence={'options':{'lead_time':3,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
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
  await page.goto(`/replenishment/redistribution/dates/${dates.scenario}`)
  await page.getByRole('link', { name: 'Estimate transfer freight', exact: true }).click()
  await expect(
    page.getByText('Unavailable: freight terms are not configured.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save freight estimate', exact: true }),
  ).toHaveCount(0)
  await page.goto(`/locations/network/${dates.lane}`)
  await page.getByLabel('Freight basis', { exact: true }).selectOption('per_unit')
  await page.getByLabel('Freight cost', { exact: true }).fill('1.234')
  await page.getByLabel('Freight currency', { exact: true }).selectOption('SAR')
  await page.getByLabel('Freight unit', { exact: true }).selectOption('EA')
  await page.getByLabel('Freight valid from', { exact: true }).fill('2026-10-11')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(`/replenishment/redistribution/freight/new?scenario=${dates.scenario}`)
  await expect(
    page.getByText('Unavailable: confirm freight applicability.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: /I confirm that these freight terms/ }).check()
  await page.getByRole('button', { name: 'Refresh freight preview', exact: true }).click()
  await expect(page.getByText('Freight estimate available', { exact: true })).toBeVisible()
  await expect(page.getByText(/SAR\s*11\.11/, { exact: false })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Slow receipt (p90)' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'overdue or late inbound' })).toBeVisible()
  const previewUrl = page.url()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=2.345 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save freight estimate', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Inputs changed' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh freight preview', exact: true }).click()
  await expect(page.getByText(/SAR\s*21\.11/, { exact: false })).toBeVisible()
  await page.getByText('Freight terms and calculation', { exact: true }).focus()
  await page.keyboard.press('Enter')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`transfer-freight-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByRole('button', { name: 'Save freight estimate', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved transfer freight estimate', exact: true }),
  ).toBeVisible()
  const savedUrl = page.url()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=99,is_active=false where organization_id=%s',(sys.argv[2],))
    db.execute('update public.work_calendars set is_active=false where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(page.getByText(/SAR\s*21\.11/, { exact: false })).toBeVisible()
  await page.goto(
    `/replenishment/redistribution/freight?scenario=${dates.scenario}&q=SOURCE&page=999`,
  )
  await expect(page.getByText('1 freight estimate', { exact: true })).toBeVisible()
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await page.getByLabel('Search items or locations', { exact: true }).fill('UNKNOWN')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('0 freight estimates', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set is_active=true where organization_id=%s',(sys.argv[2],))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(savedUrl)
  await expect(
    viewerPage.getByRole('heading', { name: 'Saved transfer freight estimate', exact: true }),
  ).toBeVisible()
  await viewerPage.goto(previewUrl)
  await expect(viewerPage.getByText('Freight estimate available', { exact: true })).toBeVisible()
  await expect(
    viewerPage.getByRole('button', { name: 'Save freight estimate', exact: true }),
  ).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto('/replenishment/redistribution/freight')
  await expect(branchPage.getByText('0 freight estimates', { exact: true })).toBeVisible()
  for (const url of [savedUrl, previewUrl]) {
    await branchPage.goto(url)
    await expect(
      branchPage.getByRole('region', { name: 'Transfer freight preview', exact: true }),
    ).toHaveCount(0)
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[5],'${fixture.source}'))`)
  await branchPage.goto(savedUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Saved transfer freight estimate', exact: true }),
  ).toBeVisible()
  await branchContext.close()
})
