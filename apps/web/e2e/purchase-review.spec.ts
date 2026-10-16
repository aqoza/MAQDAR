import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })

test('purchase review preserves evidence, independent decisions and selected history', async ({
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
  const submit = async (estimate: string, reason: string) => {
    await page.goto(`/replenishment/costs/${estimate}`)
    const form = page.getByRole('form', { name: 'Propose purchase estimate', exact: true })
    await form.getByLabel('Proposal reason', { exact: true }).fill(reason)
    await form.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  }
  await submit(estimates[0], 'Demand and supplier evidence reviewed')
  await expect(
    page.getByRole('heading', { name: 'Proposal 1 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/review\/[0-9a-f-]+$/)
  const firstUrl = page.url()
  await expect(page.getByRole('form', { name: 'Review proposal', exact: true })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  // The pending guard spans alternate delivery/price estimates of the same draft.
  await submit(estimates[1], 'Alternative delivery')
  await expect(
    page.getByRole('alert').filter({ hasText: 'already has a pending proposal' }),
  ).toBeVisible()
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  await signInWithPassword(reviewer, approverEmail, password)
  const decide = async (decision: 'approved' | 'rejected', reason: string) => {
    const form = reviewer.getByRole('form', { name: 'Review proposal', exact: true })
    await expect(form).toBeVisible()
    await expect(
      form.getByRole('option', {
        name: decision === 'approved' ? 'Approve' : 'Reject',
        exact: true,
      }),
    ).toHaveJSProperty('disabled', false)
    await form.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision)
    await form.getByLabel('Decision reason', { exact: true }).fill(reason)
    await form.getByRole('button', { name: 'Record decision', exact: true }).click()
  }
  await reviewer.goto(firstUrl)
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 1 · Awaiting review', exact: true }),
  ).toBeVisible()
  await decide('approved', 'Independent review complete')
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 1 · Approved', exact: true }),
  ).toBeVisible()
  await expect(
    reviewer.getByText('Selected approval for this draft', { exact: true }),
  ).toBeVisible()
  await reviewer
    .getByRole('link', { name: 'Inspect saved purchase-cost estimate', exact: true })
    .click()
  await expect(
    reviewer.getByRole('heading', { name: 'Saved purchase-cost estimate', exact: true }),
  ).toBeVisible()
  await expect(
    reviewer.getByRole('form', { name: 'Propose purchase estimate', exact: true }),
  ).toHaveCount(0)
  await submit(estimates[1], 'Later delivery for review')
  await expect(
    page.getByRole('heading', { name: 'Proposal 2 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/review\/[0-9a-f-]+$/)
  await reviewer.goto(page.url())
  await expect(reviewer.getByRole('option', { name: 'Approve', exact: true })).toHaveJSProperty(
    'disabled',
    true,
  )
  await expect(
    reviewer.getByRole('alert').filter({ hasText: 'Approval is unavailable' }),
  ).toBeVisible()
  await decide('rejected', 'Requires a compatible policy')
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 2 · Rejected', exact: true }),
  ).toBeVisible()
  await submit(estimates[0], 'Check price freshness')
  await expect(
    page.getByRole('heading', { name: 'Proposal 3 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/review\/[0-9a-f-]+$/)
  const staleUrl = page.url()
  // Load a currently valid approval form, then change evidence before submitting.
  await reviewer.goto(staleUrl)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(sys.argv[2],))`)
  await decide('approved', 'Attempt changed-price approval')
  await expect(
    reviewer.getByRole('alert').filter({ hasText: 'Current price evidence differs' }),
  ).toBeVisible()
  await page.reload()
  const withdrawal = page.getByRole('form', { name: 'Withdraw proposal', exact: true })
  await withdrawal.getByLabel('Decision reason', { exact: true }).fill('Refresh price evidence')
  await withdrawal.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Proposal 3 · Withdrawn', exact: true }),
  ).toBeVisible()
  await submit(estimates[0], 'Stale estimate must fail')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Current price evidence differs' }),
  ).toBeVisible()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(firstUrl)
  await expect(
    viewerPage.getByText('Selected approval for this draft', { exact: true }),
  ).toBeVisible()
  await expect(viewerPage.getByRole('form')).toHaveCount(0)
  await viewerContext.close()
  await reviewer.screenshot({ path: testInfo.outputPath('purchase-review.png'), fullPage: true })
  await reviewerContext.close()
  await page.goto('/replenishment')
  await page.getByRole('link', { name: 'Purchase proposal review', exact: true }).click()
  const table = page.getByRole('table', { name: 'Purchase proposal review', exact: true })
  await expect(table.getByRole('row')).toHaveCount(4)
  await page.getByLabel('Search item code', { exact: true }).fill('DRAFT-ITEM')
  await page.getByLabel('Supplier code', { exact: true }).fill('SUP')
  await page.getByLabel('Location code', { exact: true }).fill('DRAFT')
  await page
    .getByRole('combobox', { name: 'Proposal status', exact: true })
    .selectOption('approved')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('Selected approval for this draft')
  // Synthetic terminal history exercises server pagination, without touching source evidence.
  await runPython(`import sys,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==2
    assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==1
    for revision in range(4,29):
        db.execute("insert into public.purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason,status,decided_by,decided_at,decision_reason,decision_request_id) select organization_id,estimate_id,draft_id,location_id,%s,%s,submitted_by,'Pagination fixture','withdrawn',submitted_by,now(),'Pagination fixture',%s from public.purchase_proposals where organization_id=%s and revision=1",(revision,uuid4(),uuid4(),sys.argv[2]))`)
  await page.goto(`/replenishment/review?draft=${draft}`)
  await expect(table.getByRole('row')).toHaveCount(26)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(4)
})
