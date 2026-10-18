import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('policy workbench pages, filters, and records an independent review with immutable evidence', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const key = randomUUID()
  const password = `Review-${key}`
  const ownerEmail = `policy-owner-${key}@example.com`
  const approverEmail = `policy-approver-${key}@example.com`
  const viewerEmail = `policy-viewer-${key}@example.com`
  await createConfirmedUser(ownerEmail, password)
  const approver = await createConfirmedUser(approverEmail, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, ownerEmail, password)
  const slug = `policy-${key}`
  await createOrganization(page, { name: `Policy ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local workbench fixture only')
  // Only test setup uses a privileged connection. All proposals/decisions use browser sessions.
  await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      '-c',
      `
import sys, json, psycopg
from uuid import uuid4
from datetime import date, timedelta
from psycopg.types.json import Jsonb
dsn, org, approver, viewer = sys.argv[1:]
with psycopg.connect(dsn) as db:
    for user, role in [(approver, 'approver'), (viewer, 'viewer')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)', (org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)', (user,org))
    location=uuid4()
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'REVIEW','Review','branch','SA','Asia/Riyadh')",(location,org))
    for i in range(28):
        run, policy, forecast, source_run, item = [uuid4() for _ in range(5)]
        period=lambda days: dict(days=days,forecast=f'{days}.000',quantile=f'{days+1}.000',target=f'{days+1}.000',safety_stock='1.000')
        output=dict(status='available',lead_time=period(3),protection=period(7),residual_count=0,positive_days=90,samples=5000,seed='fixture',calibration=[])
        evidence=dict(method='policy-v1',options=dict(lead_time=3,review_interval=4,service_level='0.95'),forecast=dict(id=str(forecast),run_id=str(source_run),item_id=str(item),method='baseline-v1',to_date='2026-10-01',horizon=7,output=dict(model='naive',forecast=[dict(date=str(date(2026,10,2)+timedelta(days=n)),quantity='1.000') for n in range(7)])),output=output)
        if i==1:
            evidence['forecast']['source']=dict(unit_provenance=dict(method='source-units-v1',status='consistent',unit='EA',rows=90,unknown_rows=0,units=['EA']))
            db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'TARGET-01','Target','Test','EA',99,'SAR')",(item,org))
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-01',12,2,1.125,'KWD','EA')",(org,item,location))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())",(run,org,location,uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,%s,'EA','available',%s,%s)",(policy,org,run,location,forecast,item,f'TARGET-{i:02}',Jsonb(output),Jsonb(evidence)))
`,
      dsn,
      org,
      approver,
      viewer,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 30_000 },
  )
  await page.goto('/forecasts')
  await page.getByRole('tab', { name: 'Policy review workbench', exact: true }).click()
  const table = page.getByRole('table', { name: 'Policy review workbench', exact: true })
  await expect(table.getByRole('row')).toHaveCount(26)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(4)
  await page.getByLabel('Search item code', { exact: true }).fill('TARGET-01')
  await page.getByLabel('Location code', { exact: true }).fill('REVIEW')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  await page.getByRole('link', { name: 'Review TARGET-01', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/workbench\/[0-9a-f-]+$/)
  const reviewUrl = page.url()
  await page
    .getByRole('link', { name: 'Compare stock with calculated maximum', exact: true })
    .click()
  await expect(page.getByText('2 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('Value above maximum: 2.25 KWD', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to policy review', exact: true }).click()
  const comparison = page.getByRole('table', {
    name: 'Calculated and reviewed thresholds',
    exact: true,
  })
  await expect(comparison.getByRole('row').nth(1)).toContainText('4')
  const proposal = page.getByRole('form', { name: 'Propose threshold override', exact: true })
  await proposal.getByLabel('Proposed reorder-point reference', { exact: true }).fill('6.123')
  await proposal.getByLabel('Proposed periodic-review maximum', { exact: true }).fill('12.456')
  await proposal
    .getByLabel('Proposal reason', { exact: true })
    .fill('Campaign requires additional cover')
  await proposal.getByLabel('Proposed periodic-review maximum', { exact: true }).fill('5')
  await proposal.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  const maximum = proposal.getByLabel('Proposed periodic-review maximum', { exact: true })
  await expect(maximum).toHaveAttribute('aria-invalid', 'true')
  await expect(maximum).toHaveAccessibleDescription(
    'Must be at least the proposed reorder-point reference.',
  )
  await expect(maximum).toHaveValue('5')
  await expect(
    proposal.getByLabel('Proposed reorder-point reference', { exact: true }),
  ).toHaveValue('6.123')
  await expect(page.getByRole('heading', { name: /^Proposal 1/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('policy-validation.png'), fullPage: true })
  await maximum.fill('12.456')
  await proposal.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Proposal 1 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('form', { name: 'Review proposal', exact: true })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  await signInWithPassword(reviewer, approverEmail, password)
  await reviewer.goto(reviewUrl)
  await expect(
    reviewer.getByRole('heading', { name: 'Policy review · TARGET-01', exact: true }),
  ).toBeVisible()
  const decision = reviewer.getByRole('form', { name: 'Review proposal', exact: true })
  await expect(decision).toBeVisible()
  await decision.getByLabel('Decision reason', { exact: true }).fill('Demand evidence reviewed')
  await decision.getByRole('button', { name: 'Record decision', exact: true }).click()
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 1 · Approved', exact: true }),
  ).toBeVisible()
  await expect(
    reviewer
      .getByRole('table', { name: 'Calculated and reviewed thresholds', exact: true })
      .getByRole('row')
      .nth(2),
  ).toContainText('12.456')
  await reviewer.getByRole('link', { name: 'Compare stock using revision 1', exact: true }).click()
  await expect(reviewer.getByText('Comparison available', { exact: true })).toBeVisible()
  await expect(reviewer.getByText('0 EA', { exact: true })).toBeVisible()
  await reviewer.getByRole('button', { name: 'Compare stock', exact: true }).click()
  await expect(reviewer.getByText('0 EA', { exact: true })).toBeVisible()
  await reviewer.screenshot({ path: testInfo.outputPath('stock-comparison.png'), fullPage: true })
  await reviewerContext.close()
  await page.reload()
  await expect(comparison.getByRole('row').nth(1)).toContainText('4')
  await expect(comparison.getByRole('row').nth(2)).toContainText('6.123')
  await page
    .getByRole('link', { name: 'Inspect calculated policy and forecast evidence', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Inventory policy recommendation', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Review this policy', exact: true }).click()
  await expect(page).toHaveURL(reviewUrl)
  await page.screenshot({ path: testInfo.outputPath('workbench.png'), fullPage: true })
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(reviewUrl)
  await expect(
    viewerPage.getByRole('heading', { name: 'Proposal 1 · Approved', exact: true }),
  ).toBeVisible()
  await expect(
    viewerPage.getByRole('form', { name: 'Propose threshold override', exact: true }),
  ).toHaveCount(0)
  await expect(viewerPage.getByRole('form', { name: 'Review proposal', exact: true })).toHaveCount(
    0,
  )
  await viewerContext.close()
  await page.getByRole('link', { name: 'Back to policy workbench', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Latest proposal', exact: true })
    .selectOption('approved')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
})
