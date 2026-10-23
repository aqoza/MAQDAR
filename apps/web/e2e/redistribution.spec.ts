import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('redistribution keeps exact evidence, requires both locations and fits five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const email = `redistribution-${key}@example.com`
  const password = `Draft-${key}`
  const user = await createConfirmedUser(email, password)
  const viewerEmail = `redistribution-viewer-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `redistribution-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `redistribution-${key}`
  await createOrganization(page, { name: `Redistribution ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const sourceCode = `SOURCE-${'A'.repeat(57)}`
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'TRANSFER-ITEM','Transfer item','Test','EA',1,'SAR')",(item,org))
    for loc,qty,allocated in [(destination,'12','2'),(source,'35.125','2.250')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,%s,1,'SAR','EA')",(org,item,loc,qty,allocated))
    evidence={'options':{'lead_time':3,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
    for index,loc in enumerate([destination]+[source]*26):
        run,policy=uuid4(),uuid4()
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())",(run,org,loc,uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'TRANSFER-ITEM','EA','available',%s,%s)",(policy,org,run,loc,uuid4(),item,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
        policies.append(policy)
    db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')",(org,source,destination))
    db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',3,3)",(supplier,org))
    db.execute("insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,unit_of_measure) values(%s,'LATE','1',%s,%s,%s,'2026-10-18',2,1,'SAR','EA')",(org,item,destination,supplier))
    revisions=[]
    for revision in range(1,27):
        proposal=uuid4()
        db.execute("insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id) values(%s,%s,%s,%s,%s,%s,%s,1,21,'Review','approved',%s,now(),'Approved',%s)",(proposal,org,policies[1],source,revision,uuid4(),user,viewer,uuid4()))
        revisions.append(proposal)
with psycopg.connect(dsn) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    report=db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(org,policies[0])).fetchone()[0]
    draft=db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(org,policies[0],uuid4(),report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(draft=str(draft),source=str(source),policy=str(policies[1]),revision=str(revisions[0]))))
`)
  const fixture = JSON.parse(seeded.stdout.trim()) as {
    draft: string
    source: string
    policy: string
    revision: string
  }
  await page.goto(`/replenishment/${fixture.draft}`)
  await page.getByRole('link', { name: 'Create redistribution draft', exact: true }).click()
  await expect(page.getByText('26 source policies', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: `Choose ${sourceCode} policy`, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`policy=${fixture.policy}$`))
  await page
    .getByRole('combobox', { name: 'Source maximum selection', exact: true })
    .selectOption('calculated')
  await page.getByLabel('Source additional unallocated backorders', { exact: true }).fill('4.125')
  await page.getByRole('button', { name: 'Refresh redistribution preview', exact: true }).click()
  await expect(
    page.getByText('Unavailable: confirm source commitments at the shared cutoff.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save redistribution draft', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('checkbox', { name: /I confirm the source snapshot/ }).check()
  await page.getByRole('checkbox', { name: /I confirm the displayed directed lane/ }).check()
  await page.getByRole('button', { name: 'Refresh redistribution preview', exact: true }).click()
  await expect(page.getByText('Redistribution quantity available', { exact: true })).toBeVisible()
  await expect(page.getByText('8.75 EA', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('alert').filter({ hasText: 'overdue or late inbound' })).toBeVisible()
  await page.getByRole('link', { name: 'Older approved revisions', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Source maximum selection', exact: true })
    .selectOption(fixture.revision)
  await page.getByRole('button', { name: 'Refresh redistribution preview', exact: true }).click()
  await expect(page.getByText('7.75 EA', { exact: true })).toHaveCount(2)
  await page
    .getByRole('combobox', { name: 'Source maximum selection', exact: true })
    .selectOption('calculated')
  await page.getByRole('button', { name: 'Refresh redistribution preview', exact: true }).click()
  const previewUrl = page.url()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set quantity=36 where organization_id=%s and location_id=%s",(sys.argv[2],'${fixture.source}'))`)
  await page.getByRole('button', { name: 'Save redistribution draft', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Inputs changed' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh redistribution preview', exact: true }).click()
  await expect(page.getByText('9.625 EA', { exact: true })).toHaveCount(2)
  await page.getByText('Source units and evidence references', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Source stock snapshot', { exact: true })).toBeVisible()
  await page.getByText('Saved destination stock and inbound evidence', { exact: true }).click()
  await page.getByText('Captured directed lane settings', { exact: true }).click()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('region', { name: 'Source stock and maximum', exact: true }).focus()
    await expect(
      page.getByRole('region', { name: 'Source stock and maximum', exact: true }),
    ).toBeFocused()
    const inboundTable = page.getByRole('region', {
      name: 'Outstanding inbound lines',
      exact: true,
    })
    await inboundTable.focus()
    await expect(inboundTable).toBeFocused()
    if (width === 375) {
      expect(await inboundTable.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(
        0,
      )
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => inboundTable.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
      await inboundTable.evaluate((el) => {
        el.scrollLeft = 0
      })
    }
    await page.screenshot({ path: testInfo.outputPath(`preview-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Save redistribution draft', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved redistribution draft', exact: true }),
  ).toBeVisible()
  const savedUrl = page.url()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s and location_id=%s",(sys.argv[2],'${fixture.source}'))
    db.execute('update public.network_links set is_active=false where organization_id=%s',(sys.argv[2],))`)
  await page.reload()
  await expect(page.getByText('9.625 EA', { exact: true })).toHaveCount(2)
  await page.goto('/replenishment/redistribution?q=SOURCE')
  await expect(page.getByText('1 redistribution draft', { exact: true })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Search items or locations', { exact: true }).fill('UNKNOWN')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.goto('/replenishment/redistribution?page=100000')
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set quantity=36 where organization_id=%s and location_id=%s",(sys.argv[2],'${fixture.source}'))
    db.execute('update public.network_links set is_active=true where organization_id=%s',(sys.argv[2],))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(savedUrl)
  await expect(
    viewerPage.getByRole('heading', { name: 'Saved redistribution draft', exact: true }),
  ).toBeVisible()
  await viewerPage.goto(previewUrl)
  await expect(
    viewerPage.getByText('Redistribution quantity available', { exact: true }),
  ).toBeVisible()
  await expect(
    viewerPage.getByRole('button', { name: 'Save redistribution draft', exact: true }),
  ).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto('/replenishment/redistribution')
  await expect(branchPage.getByText('0 redistribution drafts', { exact: true })).toBeVisible()
  await branchPage.goto(savedUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Saved redistribution draft', exact: true }),
  ).toHaveCount(0)
  await branchPage.goto(previewUrl)
  await expect(branchPage.getByText('Source stock snapshot', { exact: true })).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[5],'${fixture.source}'))`)
  await branchPage.goto(savedUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Saved redistribution draft', exact: true }),
  ).toBeVisible()
  await branchContext.close()
})
