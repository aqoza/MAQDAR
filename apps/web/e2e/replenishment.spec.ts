import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('replenishment, supplier and delivery scenarios retain evidence and reject changed previews', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `draft-${key}@example.com`
  const password = `Draft-${key}`
  const user = await createConfirmedUser(email, password)
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
    print(db.execute('select id from public.inventory_policies where run_id=%s',(run,)).fetchone()[0])
`)
  const policy = stdout.trim()
  await page.goto(`/forecasts/workbench/${policy}`)
  await page
    .getByRole('link', { name: 'Draft replenishment with calculated maximum', exact: true })
    .click()
  await expect(page).toHaveURL(`/replenishment/new?policy=${policy}&basis=calculated`)
  const previewUrl = page.url()
  await page.getByLabel('Additional unallocated backorders', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await expect(
    page.getByText('Unavailable: confirm order completeness and synchronization.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await expect(page.getByText('Draft available', { exact: true })).toBeVisible()
  await expect(page.getByText('2 EA', { exact: true })).toBeVisible()
  const lines = page.getByRole('table', { name: 'Outstanding inbound lines', exact: true })
  await expect(lines.getByRole('row')).toHaveCount(3)
  await expect(lines.getByText('Overdue at cutoff', { exact: true })).toBeVisible()
  await expect(lines.getByText('After protection period', { exact: true })).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=11 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save draft evidence', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Refresh the preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await expect(page.getByText('3 EA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft evidence', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved replenishment draft', exact: true }),
  ).toBeVisible()
  const savedUrl = page.url()
  const { stdout: termsId } = await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency) select %s,s.id,i.id,3,10,6,1,'SAR' from public.suppliers s join public.items i on i.organization_id=s.organization_id where s.organization_id=%s returning id",(sys.argv[2],sys.argv[2])).fetchone()[0])`)
  await page.getByRole('link', { name: 'Create supplier MOQ/pack scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/suppliers\/new\?draft=/)
  const supplierPreviewUrl = page.url()
  await page.getByLabel('Supplier code', { exact: true }).fill('SUP')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Refresh supplier preview', exact: true }).click()
  await expect(
    page.getByText('Unavailable: the supplier or draft unit is unknown.', { exact: true }),
  ).toBeVisible()
  // Supplying units through maintenance enables the scenario without catalog inference.
  await page.goto(`/suppliers/supplier-items/${termsId.trim()}`)
  await page.getByLabel('Supplied unit', { exact: true }).selectOption('EA')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(`${supplierPreviewUrl}&supplier=SUP`)
  await expect(
    page.getByText('Unavailable: confirm that the MOQ/pack terms apply at the draft cutoff.', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Refresh supplier preview', exact: true }).click()
  await expect(page.getByText('12 EA', { exact: true })).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set pack_size=7 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save supplier scenario', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Refresh the supplier preview' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Refresh supplier preview', exact: true }).click()
  await expect(page.getByText('14 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('11 EA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save supplier scenario', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Saved supplier scenario', exact: true }),
  ).toBeVisible()
  const scenarioUrl = page.url()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for code,days,table in [('SEND',[6,7],'suppliers'),('RECEIVE',[4,5],'locations')]:
        cal=db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,%s,'SA',%s,false) returning id",(sys.argv[2],code,code,days)).fetchone()[0]
        db.execute('update public.'+table+' set work_calendar_id=%s where organization_id=%s',(cal,sys.argv[2]))`)
  await page.getByRole('link', { name: 'Create delivery-date scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/deliveries\/new\?scenario=/)
  const deliveryPreviewUrl = page.url()
  await page.getByRole('button', { name: 'Refresh delivery preview', exact: true }).click()
  await expect(
    page.getByText('Unavailable: confirm calendar applicability for the selected period.', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Refresh delivery preview', exact: true }).click()
  await expect(page.getByText('Delivery-date scenario available', { exact: true })).toBeVisible()
  await expect(page.getByText('2026-10-17', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Policy recalculation required:', { exact: false })).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) select organization_id,id,'2026-10-12','2026-10-16','closure','Supplier shutdown' from public.work_calendars where organization_id=%s and code='SEND'",(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save delivery-date scenario', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Refresh the delivery preview' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Refresh delivery preview', exact: true }).click()
  await expect(page.getByText('2026-10-24', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Save delivery-date scenario', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/deliveries\/[a-f0-9-]+$/)
  const deliveryUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved delivery-date scenario', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('delivery-scenario.png'), fullPage: true })
  await page.getByRole('link', { name: 'Inspect source supplier scenario', exact: true }).click()
  await expect(page).toHaveURL(scenarioUrl)
  await expect(page.getByText('1 saved delivery-date scenario', { exact: true })).toBeVisible()
  await page
    .getByRole('link', { name: 'Inspect date scenario for 2026-10-10', exact: true })
    .click()
  await expect(page).toHaveURL(deliveryUrl)
  await page.getByRole('link', { name: 'Estimate purchase cost', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/costs\/new\?delivery=/)
  const costPreviewUrl = page.url()
  await expect(
    page.getByText('Unavailable: a finite price-valid-from date is required', { exact: true }),
  ).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.supplier_items set unit_price=1.005,valid_from='2026-10-19' where organization_id=%s",(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Preview purchase cost', exact: true }).click()
  await expect(
    page.getByText(
      'Confirm that the displayed price applies to the saved quantity and adjusted order date',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByText('1.005 SAR / EA', { exact: true })).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Preview purchase cost', exact: true }).click()
  await expect(page.getByText('Purchase-cost estimate available', { exact: true })).toBeVisible()
  await expect(page.getByText('14 EA', { exact: true })).toBeVisible()
  await expect(page.getByText(/SAR\s14\.07/, { exact: true })).toBeVisible()
  await expect(page.getByText('Policy recalculation required:', { exact: false })).toBeVisible()
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=1.015 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save purchase-cost estimate', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Price evidence changed.' })).toBeVisible()
  await page.getByRole('button', { name: 'Preview purchase cost', exact: true }).click()
  await expect(page.getByText(/SAR\s14\.21/, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save purchase-cost estimate', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/costs\/[a-f0-9-]+$/)
  const costUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Saved purchase-cost estimate', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('purchase-cost.png'), fullPage: true })
  await page.getByRole('link', { name: 'Source delivery scenario', exact: true }).click()
  await expect(page).toHaveURL(deliveryUrl)
  await expect(page.getByText('1 saved estimates', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Inspect cost for 2026-10-19', exact: true }).click()
  await expect(page).toHaveURL(costUrl)
  await page.goto(scenarioUrl)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=99 where organization_id=%s',(sys.argv[2],))
    db.execute('update public.supplier_items set pack_size=100,unit_price=2 where organization_id=%s',(sys.argv[2],))
    db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(sys.argv[2],sys.argv[3]))`)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.holiday_overrides where organization_id=%s',(sys.argv[2],))`)
  await page.goto(costUrl)
  await expect(page.getByText(/SAR\s14\.21/, { exact: true })).toBeVisible()
  await expect(page.getByText('Policy recalculation required:', { exact: false })).toBeVisible()
  await page.goto(`${costPreviewUrl}&confirmed=true`)
  await expect(page.getByText(/SAR\s28\.00/, { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save purchase-cost estimate', exact: true }),
  ).toHaveCount(0)
  await page.goto(deliveryUrl)
  await expect(page.getByText('2026-10-24', { exact: true }).first()).toBeVisible()
  await page.goto(`${deliveryPreviewUrl}&requested=2026-10-10&confirmed=true`)
  await expect(page.getByText('2026-10-17', { exact: true }).first()).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save delivery-date scenario', exact: true }),
  ).toHaveCount(0)
  await page.goto(scenarioUrl)
  await page.reload()
  await expect(page.getByText('14 EA', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('supplier-scenario.png'), fullPage: true })
  await page.getByRole('link', { name: 'Inspect source replenishment draft', exact: true }).click()
  await expect(page).toHaveURL(savedUrl)
  await expect(page.getByText('1 saved scenario', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Inspect SUP', exact: true }).click()
  await expect(page).toHaveURL(scenarioUrl)
  await page.goto(`${supplierPreviewUrl}&supplier=SUP&confirmed=true`)
  await expect(page.getByText('Supplier scenario available', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save supplier scenario', exact: true }),
  ).toHaveCount(0)
  await page.goto(savedUrl)
  await expect(page.getByText('3 EA', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('replenishment-draft.png'), fullPage: true })
  await page.getByRole('link', { name: 'All replenishment drafts', exact: true }).click()
  await page.getByLabel('Search item code', { exact: true }).fill('DRAFT-ITEM')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByText('1 saved drafts', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Inspect DRAFT-ITEM', exact: true }).click()
  await expect(page).toHaveURL(savedUrl)
  await page.goto(`${previewUrl}&backorders=4&confirmed=true`)
  await expect(page.getByText('Draft available', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save draft evidence', exact: true })).toHaveCount(
    0,
  )
})
