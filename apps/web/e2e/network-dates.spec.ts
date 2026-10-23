import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('network dates retain allocations, require complete calendars and preserve all-location access at five widths and RTL', async ({
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
  await signInWithPassword(page, email, password)
  const slug = `network-${key}`
  await createOrganization(page, { name: `Network ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
    evidence={'options':{'lead_time':3,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
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
  await page.goto(`/replenishment/network/${parent}`)
  await page.getByRole('link', { name: 'Plan network transfer dates', exact: true }).click()
  await page.getByLabel('Requested dispatch date', { exact: true }).fill('2099-10-10')
  await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
  await expect(
    page.getByText('Confirm that calendar settings apply.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save network dates', exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: /I confirm the warehouse and branch calendar/ }).check()
  await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
  await expect(
    page.getByText('Unavailable: warehouse dispatch could not be resolved.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save network dates', exact: true })).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set observe_public_holidays=false where organization_id=%s",(sys.argv[2],))`)
  await page.getByLabel('Requested dispatch date', { exact: true }).fill('2026-10-10')
  await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
  await expect(page.getByText('Network dates available', { exact: true })).toBeVisible()
  const table = page.getByRole('region', { name: 'Branch receipt scenarios', exact: true })
  await expect(table.getByText('4.712 EA', { exact: true })).toBeVisible()
  await expect(table.getByText('4.038 EA', { exact: true })).toBeVisible()
  await expect(table.getByText('2026-10-14', { exact: true })).toHaveCount(2)
  await expect(table.getByText('2026-10-16', { exact: true })).toHaveCount(2)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await table.focus()
    await expect(table).toBeFocused()
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
    expect(
      await page
        .locator('.text-evidence-value')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px')
    if (width === 375) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    }
    await page.screenshot({
      path: testInfo.outputPath(`network-dates-${width}.png`),
      fullPage: true,
      caret: 'initial',
    })
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set weekend_days=array[]::integer[] where organization_id=%s",(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save network dates', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Inputs changed' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
  await page.getByRole('button', { name: 'Save network dates', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved network transfer dates', exact: true }),
  ).toBeVisible()
  const saved = page.url()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set is_active=false where organization_id=%s",(sys.argv[2],))
    db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s",(sys.argv[2],))`)
  await page.reload()
  await expect(table.getByText('2026-10-12', { exact: true })).toHaveCount(2)
  await expect(table.getByText('4.712 EA', { exact: true })).toBeVisible()
  const disclosure = page
    .locator('summary')
    .filter({ hasText: /date and lane evidence/ })
    .first()
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Captured policy reference:/).first()).toBeVisible()
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`network-dates-ar-${width}.png`),
      fullPage: true,
      caret: 'initial',
    })
  }
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  expect((await branchPage.goto(saved))?.status()).toBe(404)
  expect(
    (await branchPage.goto(`/replenishment/network/dates/new?allocation=${parent}`))?.status(),
  ).toBe(404)
  await branchPage.goto('/replenishment/network/dates')
  await expect(
    branchPage.getByRole('link', { name: 'Inspect NETWORK-ITEM', exact: true }),
  ).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations values(%s,%s,%s)",(sys.argv[2],sys.argv[4],'${fixture.second}'))`)
  await branchPage.goto(saved)
  await expect(
    branchPage.getByRole('heading', { name: 'Saved network transfer dates', exact: true }),
  ).toBeVisible()
  await branchPage.goto(`/replenishment/network/dates?allocation=${parent}&q=BRANCH-B`)
  await expect(
    branchPage.getByRole('link', { name: 'Inspect NETWORK-ITEM', exact: true }),
  ).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await branchPage.setViewportSize({ width, height: 900 })
    expect(
      await branchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await branchContext.close()
})
