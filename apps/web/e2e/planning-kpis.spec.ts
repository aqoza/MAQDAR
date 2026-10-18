import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('KPI filters distinguish missing stock and expose saved forecast evidence with branch scope', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const key = randomUUID()
  const password = `Kpi-${key}`
  const email = `kpi-${key}@example.com`
  const branchEmail = `kpi-branch-${key}@example.com`
  await createConfirmedUser(email, password)
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `kpi-${key}`
  await createOrganization(page, { name: `KPI ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local KPI fixture only')
  await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      '-c',
      `
import sys, psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
dsn, org, branch = sys.argv[1:]
with psycopg.connect(dsn) as db:
    locations=[uuid4(),uuid4()]
    for i,l in enumerate(locations):
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,'KPI location','branch','SA','Asia/Riyadh')",(l,org,f'KPI-{i}'))
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(org,branch))
    db.execute("insert into public.membership_locations values(%s,%s,%s)",(org,branch,locations[0]))
    db.execute("insert into public.user_settings(user_id,active_organization_id) values(%s,%s)",(branch,org))
    for i in range(3):
        item=uuid4()
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'KPI item','KPI','EA',1,'KWD')",(item,org,f'STOCK-{i}'))
        if i<2:
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency) values(%s,%s,%s,%s,%s,%s,1.125,'KWD')",(org,item,locations[0],'2026-10-09' if i==0 else '2026-10-01',2 if i==0 else 1,0 if i==0 else 2))
    for i in range(28):
        run,item=uuid4(),uuid4()
        location=locations[1] if i==27 else locations[0]
        model='mean' if i<26 else None
        status='selected' if model else 'insufficient'
        scores=[dict(model='mean',rmse='123456789012345678.123',mae='1.125',bias='-0.125',folds=[dict(rmse='123456789012345678.123',mae='1.125',bias='-0.125')])] if model else []
        folds=[dict(train_from='2026-01-01',train_to='2026-07-09',test_from='2026-07-10',test_to='2026-08-06')]
        source=dict(start_day='2026-01-01',end_day='2026-10-01',introduced_on=None,discontinued_on=None,demand=[])
        output=dict(status=status,model=model,total='28' if model else None,scores=scores,folds=folds,forecast=[])
        if i==0:
            source['preparation']=dict(id=str(uuid4()),run_id=str(uuid4()),group_id=str(uuid4()),unit='EA',original_from='2026-01-01',comparison='fixed-group-v1')
            output['comparison']='fixed-group-v1'
            output['evaluation']=dict(status='available',model='naive',train_to='2026-09-03',test_from='2026-09-04',test_to='2026-10-01',count=28,coverage80='0.75',coverage95='0.9')
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-01','forecast','succeeded',%s,'{}',now())",(run,org,location,uuid4(),Jsonb(dict(method='regional-v1' if i==0 else 'baseline-v1',horizon=28))))
        db.execute("insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,%s,'Saved KPI item',%s,%s,%s,%s)",(org,run,location,item,f'SAVED-{i:02}',status,model,Jsonb(dict(total=output['total'],scores=scores)),Jsonb(dict(source=source,output=output))))
`,
      dsn,
      org,
      branch,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 30_000 },
  )
  await page.goto('/dashboard?day=2026-10-10&location=KPI-0')
  const availability = page
    .getByRole('heading', { name: 'Observed stock availability', exact: true })
    .locator('..')
  await expect(availability).toContainText('50%')
  await expect(availability).toContainText('1 / 2 observed')
  await expect(page.getByText('1 older than 7 days.', { exact: false })).toBeVisible()
  await expect(page.locator('.dashboard-currencies summary')).toContainText('3.375')
  await page.getByLabel('Reporting date', { exact: true }).fill('2026-09-01')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(availability).toContainText('Unavailable')
  await expect(availability).toContainText('0 / 0 observed')
  await page.getByRole('link', { name: 'Saved forecast quality', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/quality\?location=KPI-0$/)
  await page.getByRole('link', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/quality$/)
  await expect(page.getByRole('link', { name: 'Next', exact: true })).not.toHaveAttribute(
    'href',
    /location=/,
  )
  const table = page.getByRole('table', { name: 'Saved forecast quality', exact: true })
  await expect(table.getByRole('row')).toHaveCount(26)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(4)
  await page.getByLabel('Search item code or name', { exact: true }).fill('SAVED-00')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('123,456,789,012,345,678.123')
  await expect(table).toContainText('-0.125')
  await page.getByText('Inspect SAVED-00', { exact: true }).click()
  await expect(table).toContainText('Fixed saved-group comparison in EA')
  await expect(table).toContainText('Evaluation model: Last observation')
  await expect(table).toContainText('2026-09-04 – 2026-10-01 (28 days)')
  await expect(table).toContainText('80% bands: 75%')
  await expect(table).toContainText('95% bands: 90%')
  await page.goto('/forecasts/quality?status=insufficient&page=99999')
  await expect(page).not.toHaveURL(/99999/)
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table.getByRole('row').nth(1)).toContainText('—')
  await page.goto('/forecasts/quality?q=SAVED-01')
  await page.getByRole('link', { name: 'SAVED-01', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/results\/[0-9a-f-]+\?item=/)
  await expect(page.getByRole('heading', { name: 'Forecast results', exact: true })).toBeVisible()
  const branchContext = await browser.newContext()
  try {
    const branchPage = await branchContext.newPage()
    await signInWithPassword(branchPage, branchEmail, password)
    await branchPage.goto('/forecasts/quality?location=KPI-1')
    await expect(
      branchPage.getByText('No saved forecast results match these filters.', { exact: true }),
    ).toBeVisible()
    await branchPage.goto('/dashboard?day=2026-10-10')
    await expect(
      branchPage
        .getByRole('heading', { name: 'Observed stock availability', exact: true })
        .locator('..'),
    ).toContainText('1 / 2 observed')
  } finally {
    await branchContext.close()
  }
})
