import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('transfer review records independent decisions and history with both-location access at five widths', async ({
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
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
  const submit = async (estimate: string, reason: string) => {
    await page.goto(`/replenishment/redistribution/freight/${estimate}`)
    await page.getByLabel('Proposal reason', { exact: true }).fill(reason)
    await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Transfer proposal · DATE-ITEM', exact: true }),
    ).toBeVisible()
    return page.url()
  }
  const estimate = await saveEstimate()
  const first = await submit(estimate, 'Move surplus to support destination demand')
  await expect(page.getByRole('button', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true })).toHaveCount(0)
  const reviewContext = await browser.newContext()
  const reviewPage = await reviewContext.newPage()
  await signInWithPassword(reviewPage, approverEmail, password)
  await reviewPage.goto(first)
  await expect(reviewPage.getByRole('combobox', { name: 'Decision', exact: true })).toHaveValue(
    'approved',
  )
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=2 where organization_id=%s',(sys.argv[2],))`)
  // A form rendered before the terms change must still fail at the server gate.
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Review before rate change')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewPage.getByRole('alert').filter({ hasText: 'Freight or location evidence changed' }),
  ).toBeVisible()
  await reviewPage.reload()
  await expect(reviewPage.locator('option[value="approved"]')).toHaveJSProperty('disabled', true)
  await reviewPage
    .getByLabel('Decision reason', { exact: true })
    .fill('Refresh changed freight evidence')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByRole('heading', { name: /Proposal 1 · Rejected/ })).toBeVisible()
  const second = await submit(await saveEstimate(), 'Updated freight evidence reviewed')
  await reviewPage.goto(second)
  await reviewPage
    .getByLabel('Decision reason', { exact: true })
    .fill('Independent review of both locations')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByText('Selected for this draft', { exact: true })).toBeVisible()
  const third = await submit(await saveEstimate(), 'Alternate selection for same draft')
  await reviewPage.goto(third)
  await reviewPage
    .getByLabel('Decision reason', { exact: true })
    .fill('Select latest reviewed estimate')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(reviewPage.getByText('Selected for this draft', { exact: true })).toBeVisible()
  await reviewPage.goto(second)
  await expect(reviewPage.getByText(/A later approved proposal is selected/)).toBeVisible()
  const future = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute("select public.transfer_date_preview(%s,%s,'2026-10-20',true)",(sys.argv[2],'${fixture.draft}')).fetchone()[0]
    saved=db.execute("select public.transfer_date_save(%s,%s,'2026-10-20',true,%s,%s)",(sys.argv[2],'${fixture.draft}',uuid4(),report['fingerprint'])).fetchone()[0]
print(saved)`)
  const flagged = await submit(
    await saveEstimate(future.stdout.trim()),
    'Late delivery needs review',
  )
  await reviewPage.goto(flagged)
  await expect(
    reviewPage.getByRole('alert').filter({ hasText: 'both typical and slow receipt scenarios' }),
  ).toBeVisible()
  await expect(reviewPage.locator('option[value="approved"]')).toHaveJSProperty('disabled', true)
  await page.getByLabel('Decision reason', { exact: true }).fill('Withdraw until timing resolved')
  await page.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Proposal 4 · Withdrawn/ })).toBeVisible()
  const pending = await submit(await saveEstimate(), 'Keyboard and responsive review')
  await reviewPage.goto(pending)
  await reviewPage.getByLabel('Decision reason', { exact: true }).focus()
  await reviewPage.keyboard.type('Keyboard review evidence')
  await reviewPage.keyboard.press('Tab')
  await expect(
    reviewPage.getByRole('button', { name: 'Record decision', exact: true }),
  ).toBeFocused()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await reviewPage.setViewportSize({ width, height: 900 })
    expect(
      await reviewPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await reviewPage.screenshot({
      path: testInfo.outputPath(`transfer-review-detail-${width}.png`),
      fullPage: true,
    })
  }
  await page.goto(
    `/replenishment/redistribution/review?draft=${fixture.draft}&q=DATE-ITEM&source=${sourceCode}&location=DESTINATION&page=999`,
  )
  await expect(page.getByText('5 proposals', { exact: true })).toBeVisible()
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const table = page.getByRole('region', { name: 'Transfer proposal review', exact: true })
    await table.focus()
    await expect(table).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.screenshot({
      path: testInfo.outputPath(`transfer-review-history-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .getByRole('combobox', { name: 'Proposal status', exact: true })
    .selectOption('approved')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('2 proposals', { exact: true })).toBeVisible()
  await page.getByLabel('Search items or locations', { exact: true }).fill('UNKNOWN')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('0 proposals', { exact: true })).toBeVisible()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(pending)
  await expect(
    viewerPage.getByRole('heading', { name: 'Transfer proposal · DATE-ITEM', exact: true }),
  ).toBeVisible()
  await expect(
    viewerPage.getByRole('button', { name: 'Record decision', exact: true }),
  ).toHaveCount(0)
  await viewerPage.goto(`/replenishment/redistribution/freight/${estimate}`)
  await expect(
    viewerPage.getByRole('button', { name: 'Submit proposal', exact: true }),
  ).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto('/replenishment/redistribution/review')
  await expect(branchPage.getByText('0 proposals', { exact: true })).toBeVisible()
  await branchPage.goto(pending)
  await expect(
    branchPage.getByRole('heading', { name: 'Transfer proposal · DATE-ITEM', exact: true }),
  ).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[5],'${fixture.source}'))`)
  await branchPage.goto(pending)
  await expect(
    branchPage.getByRole('heading', { name: 'Transfer proposal · DATE-ITEM', exact: true }),
  ).toBeVisible()
  await branchContext.close()
  await reviewContext.close()
})
