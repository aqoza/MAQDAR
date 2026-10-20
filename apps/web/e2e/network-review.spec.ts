import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('network proposals require independent whole-network review and retain scoped history at five widths and RTL', async ({
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
    for loc,qty,allocated in [(source,'35.125','2.250'),(first,'12','2'),(second,'14','2')]:
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
  const submit = async (estimate: string, reason: string) => {
    await page.goto(`/replenishment/network/freight/${estimate}`)
    await page.getByLabel('Proposal reason', { exact: true }).fill(reason)
    await page.getByRole('button', { name: 'Submit network proposal', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Network proposal · NETWORK-ITEM', exact: true }),
    ).toBeVisible()
    return page.url()
  }
  await page.goto('/replenishment/network')
  await page.getByRole('link', { name: 'Network transfer review', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Network transfer review', exact: true }),
  ).toBeVisible()
  const estimate = await saveEstimate()
  const first = await submit(estimate, 'Review the complete warehouse allocation')
  await expect(page.getByRole('button', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true })).toHaveCount(0)
  const reviewContext = await browser.newContext()
  const reviewPage = await reviewContext.newPage()
  await signInWithPassword(reviewPage, approverEmail, password)
  await reviewPage.goto(first)
  await expect(reviewPage.getByRole('combobox', { name: 'Decision', exact: true })).toHaveValue(
    'approved',
  )
  const table = reviewPage.getByRole('region', { name: 'Branch freight estimates', exact: true })
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await reviewPage.setViewportSize({ width, height: 900 })
    expect(
      await reviewPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect(await reviewPage.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      '16px',
    )
    expect(
      await reviewPage
        .locator('.text-evidence-value')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px')
    await table.focus()
    await expect(table).toBeFocused()
    if (width === 375) {
      await reviewPage.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    }
    await reviewPage.screenshot({
      path: testInfo.outputPath(`network-review-${width}.png`),
      fullPage: true,
    })
  }
  // A stale open review form cannot approve changed freight.
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.network_links set freight_cost=2 where organization_id=%s and currency='SAR'",(sys.argv[2],))`)
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Independent review')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewPage.getByRole('alert').filter({ hasText: /Freight, lane or location evidence changed/ }),
  ).toBeVisible()
  await reviewPage.reload()
  await expect(
    reviewPage.getByRole('option', { name: 'Approve complete proposal', exact: true }),
  ).toHaveAttribute('disabled', '')
  await expect(reviewPage.getByRole('combobox', { name: 'Decision', exact: true })).toHaveValue(
    'rejected',
  )
  await reviewPage
    .getByLabel('Decision reason', { exact: true })
    .fill('Changed quote requires a new estimate')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewPage.getByRole('heading', { name: 'Revision 1 · Rejected', exact: true }),
  ).toBeVisible()
  const refreshed = await saveEstimate()
  const second = await submit(refreshed, 'Updated freight evidence')
  await reviewPage.goto(second)
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('All branches reviewed')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewPage.getByRole('status').filter({ hasText: 'Selected planning proposal' }),
  ).toBeVisible()

  const pending = await submit(refreshed, 'Alternative complete proposal')
  await reviewPage.goto(second)
  await expect(
    reviewPage.getByRole('status').filter({ hasText: 'Selected planning proposal' }),
  ).toBeVisible()
  await page.goto(pending)
  await page.getByLabel('Decision reason', { exact: true }).fill('Withdraw this alternative')
  await page.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Revision 3 · Withdrawn', exact: true }),
  ).toBeVisible()
  const latest = await submit(refreshed, 'Final reviewed planning selection')
  await reviewPage.goto(latest)
  await reviewPage.getByLabel('Decision reason', { exact: true }).fill('Select the later revision')
  await reviewPage.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewPage.getByRole('heading', { name: 'Revision 4 · Approved', exact: true }),
  ).toBeVisible()
  await reviewPage.goto(second)
  await expect(reviewPage.getByText(/Historical approval/)).toBeVisible()
  await reviewPage.goto(latest)
  await reviewContext.addCookies([{ name: 'locale', value: 'ar', url: new URL(latest).origin }])
  await reviewPage.reload()
  await expect(reviewPage.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await reviewPage.setViewportSize({ width, height: 900 })
    expect(
      await reviewPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await reviewPage.screenshot({
      path: testInfo.outputPath(`network-review-ar-${width}.png`),
      fullPage: true,
    })
  }
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  expect((await branchPage.goto(latest))?.status()).toBe(404)
  await branchPage.goto('/replenishment/network/review?q=BRANCH-B')
  await expect(
    branchPage.getByRole('link', { name: 'Inspect proposal for NETWORK-ITEM', exact: true }),
  ).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations values(%s,%s,%s)",(sys.argv[2],sys.argv[4],'${fixture.second}'))`)
  await branchPage.goto(latest)
  await expect(
    branchPage.getByRole('heading', { name: 'Network proposal · NETWORK-ITEM', exact: true }),
  ).toBeVisible()
  await expect(
    branchPage.getByRole('button', { name: 'Record decision', exact: true }),
  ).toHaveCount(0)
  await branchPage.goto(
    `/replenishment/network/review?allocation=${parent}&q=BRANCH-B&source=WAREHOUSE&status=approved`,
  )
  await expect(
    branchPage.getByRole('link', { name: 'Inspect proposal for NETWORK-ITEM', exact: true }),
  ).toHaveCount(2)
  await expect(
    branchPage.getByRole('cell', { name: 'Selected planning proposal', exact: true }),
  ).toHaveCount(1)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await branchPage.setViewportSize({ width, height: 900 })
    expect(
      await branchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await branchPage.screenshot({
      path: testInfo.outputPath(`network-review-history-${width}.png`),
      fullPage: true,
    })
  }
  // A later schedule can be inspected/rejected/withdrawn, but not approved with late receipts.
  const lateDate = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute("select public.network_date_preview(%s,%s,'2026-10-20',true)",(sys.argv[2],'${parent}')).fetchone()[0]
    saved=db.execute("select public.network_date_save(%s,%s,'2026-10-20',true,%s,%s)",(sys.argv[2],'${parent}',uuid4(),report['fingerprint'])).fetchone()[0]
print(saved)`)
  const flagged = await submit(
    await saveEstimate(lateDate.stdout.trim()),
    'Inspect late branch receipts',
  )
  await reviewContext.clearCookies()
  await signInWithPassword(reviewPage, approverEmail, password)
  await reviewPage.goto(flagged)
  await expect(
    reviewPage.getByRole('alert').filter({ hasText: /Approval requires clear saved/ }),
  ).toBeVisible()
  await expect(
    reviewPage.getByRole('option', { name: 'Approve complete proposal', exact: true }),
  ).toHaveAttribute('disabled', '')
  await expect(reviewPage.getByRole('combobox', { name: 'Decision', exact: true })).toHaveValue(
    'rejected',
  )
  await page.goto(flagged)
  await page
    .getByLabel('Decision reason', { exact: true })
    .fill('Resolve timing in another scenario')
  await page.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Revision 5 · Withdrawn', exact: true }),
  ).toBeVisible()
  await branchContext.close()
  await reviewContext.close()
})
