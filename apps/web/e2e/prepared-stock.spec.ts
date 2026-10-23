import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('saved interchangeable group compares complete stock and diagnoses missing members', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `pool-${key}@example.com`
  const password = `Pool-${key}`
  const user = await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `pool-${key}`
  await createOrganization(page, { name: `Pool ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local group fixture only')
  const runPython = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  // Data setup uses postgres; enqueue uses authenticated claims and computation uses the worker role.
  const { stdout } = await runPython(`
import sys,json,psycopg
from uuid import uuid4
from zeespare_engine.worker import process_one
dsn,org,user=sys.argv[1:]
location,a,b=[uuid4() for _ in range(3)]
with psycopg.connect(dsn) as db:
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'POOL','Pool branch','branch','SA','Asia/Riyadh')",(location,org))
    for item,code,qty in [(a,'POOL-A',1),(b,'POOL-B',2)]:
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,%s,'Test','EA',99,'SAR')",(item,org,code,code))
        db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,unit_of_measure) select %s,%s,%s,d::date,%s,'EA' from generate_series('2026-07-01'::date,'2026-10-01'::date,'1 day') d",(org,item,location,qty))
    db.execute("insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction) values(%s,%s,%s,'two_way')",(org,a,b))
    for item,qty,alloc,cost,ccy in [(a,30,2,'1.125','KWD'),(b,10,1,'2','SAR')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-01',%s,%s,%s,%s,'EA')",(org,item,location,qty,alloc,cost,ccy))
def enqueue(sql,args):
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
def work():
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute('set role zeespare_worker')
        assert process_one(db)
run=enqueue("select public.preparation_enqueue(%s,'POOL','2026-07-01','2026-10-01',%s,true,array['POOL-A'])",(org,uuid4()))
work()
with psycopg.connect(dsn) as db:
    prepared=db.execute('select id from public.demand_preparations where run_id=%s',(run,)).fetchone()[0]
run=enqueue('select public.forecast_prepared_enqueue(%s,%s,%s,7,true)',(org,prepared,uuid4()))
work()
with psycopg.connect(dsn) as db:
    forecast=db.execute('select id from public.forecast_results where run_id=%s',(run,)).fetchone()[0]
run=enqueue('select public.policy_enqueue(%s,%s,%s,3,4,0.95)',(org,forecast,uuid4()))
work()
with psycopg.connect(dsn) as db:
    policy=db.execute('select id from public.inventory_policies where run_id=%s',(run,)).fetchone()[0]
    print(policy)
`)
  const policy = stdout.trim()
  await page.goto(`/forecasts/workbench/${policy}`)
  await page
    .getByRole('link', { name: 'Compare stock with calculated maximum', exact: true })
    .click()
  await expect(page.getByText('Comparison available', { exact: true })).toBeVisible()
  await expect(page.getByText('16 EA', { exact: true })).toBeVisible()
  await expect(page.getByText('Pooled available stock: 37 EA', { exact: true })).toBeVisible()
  const members = page.getByRole('table', { name: 'Group stock members', exact: true })
  await expect(members.getByRole('row')).toHaveCount(3)
  await expect(members.getByRole('row').nth(1)).toContainText('33.75 KWD')
  await expect(members.getByRole('row').nth(2)).toContainText('20 SAR')
  await expect(page.getByText(/^Value above maximum:/)).toHaveCount(0)
  await members.getByText('Inspect source identities', { exact: true }).first().click()
  await expect(
    members
      .getByRole('row')
      .nth(1)
      .getByText(/Recorded rows: 93;/),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('prepared-stock-comparison.png'),
    fullPage: true,
  })
  await runPython(`
import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.stock_snapshots where organization_id=%s and item_id in(select id from public.items where organization_id=%s and code='POOL-B')",(sys.argv[2],sys.argv[2]))
`)
  await page.reload()
  await expect(
    page.getByText('Unavailable: at least one item has no stock snapshot on or before this date.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(members.getByRole('row')).toHaveCount(3)
  await expect(members.getByText('Snapshot missing', { exact: true })).toBeVisible()
  await expect(page.getByText('16 EA', { exact: true })).toHaveCount(0)
  await expect(
    page.getByLabel('Physical inventory value by currency', { exact: true }),
  ).toHaveCount(0)
})
