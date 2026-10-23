import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('captured driver forecasts queue, publish and retain scoped evidence in both languages', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(30_000)
  const key = randomUUID(),
    password = `DriverForecast-${key}`,
    email = `df-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `df-viewer-${key}@example.com`,
    branchEmail = `df-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `df-${key}`
  await createOrganization(page, { name: 'Driver forecasts', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 120_000,
    })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
sys.path.insert(0,'tests')
from test_driver_forecasting import fixture
from zeespare_engine.forecasting import forecast
task=fixture(); item=task['items'][0]; org=sys.argv[2]; owner=sys.argv[3]
with psycopg.connect(sys.argv[1]) as db:
    location=db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'DF-L','Driver location','branch','SA','Asia/Riyadh') returning id",(org,)).fetchone()[0]
    other=db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'DF-OTHER','Other location','branch','SA','Asia/Riyadh') returning id",(org,)).fetchone()[0]
    ident=db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'DF-P','Driver part','Test','EA',1,'SAR') returning id",(org,)).fetchone()[0]
    item.update(item_id=str(ident),item_code='DF-P',item_name='Driver part',unit_provenance=dict(method='source-units-v1',status='consistent',unit='EA',rows=140,unknown_rows=0,units=['EA']))
    output=forecast(dict(task,method='baseline-v1'))[0]
    run=db.execute("insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,created_by,kind,options,status,finished_at,result) values(%s,%s,%s,'2026-01-01',%s,%s,'forecast',%s,'succeeded',now(),'{}') returning id",(org,location,uuid4(),task['to_date'],owner,Jsonb(dict(method='baseline-v1',horizon=14,history_complete=True)))).fetchone()[0]
    f=db.execute("insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,'DF-P','Driver part','selected',%s,%s,%s) returning id",(org,run,location,ident,output['model'],Jsonb(dict(total=output['total'],scores=output['scores'])),Jsonb(dict(source=item,output=output)))).fetchone()[0]
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(org,sys.argv[5],other))
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=owner,org_id=org,role='authenticated')),))
    data=dict(item_code='DF-P',location_code='DF-L',driver_name='Synthetic temperature',unit='C',source='Synthetic test source',history_from='2026-01-01',cutoff=task['to_date'],forecast_to='2026-06-03',confirmed=True,rows=task['driver']['report']['input']['rows'])
    report=db.execute('select public.external_driver_preview(%s,%s)',(org,Jsonb(data))).fetchone()[0]
    dataset=db.execute('select public.external_driver_save(%s,%s,%s,%s)',(org,Jsonb(data),uuid4(),report['fingerprint'])).fetchone()[0]
    print(json.dumps(dict(dataset=str(dataset),forecast=str(f),item=str(ident))))`)
    const ids = JSON.parse(seeded.stdout) as { dataset: string; forecast: string; item: string }
    await page.goto(`/forecasts/drivers/${ids.dataset}`)
    await page.getByRole('link', { name: 'Create driver forecast', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/drivers/${ids.dataset}/forecast$`))
    await page
      .getByRole('combobox', { name: 'Captured source forecast', exact: true })
      .selectOption(ids.forecast)
    await expect(page.getByRole('checkbox')).not.toBeChecked()
    const formUrl = page.url()
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(formUrl).origin }])
      await page.goto(formUrl)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        await expect(page.locator('p.text-evidence-value').first()).toHaveCSS('font-size', '14px')
        if (width === 375) {
          expect(
            (await page.getByRole('checkbox').locator('..').boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44)
        }
        await page.screenshot({
          path: testInfo.outputPath(`driver-forecast-form-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(formUrl).origin }])
    await page.goto(formUrl)
    await page
      .getByRole('combobox', { name: 'Captured source forecast', exact: true })
      .selectOption(ids.forecast)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Queue driver forecast', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts$/)
    await expect(page.getByRole('table').getByText('Queued', { exact: true })).toBeVisible()
    await expect(page.getByRole('table')).toContainText('Captured external driver')
    const completed = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
from zeespare_engine.driver_forecasting import forecast
with psycopg.connect(sys.argv[1]) as db:
    run=db.execute("select id from public.planning_runs where organization_id=%s and options->>'method'='driver-v1'",(sys.argv[2],)).fetchone()[0]
    token=uuid4()
    db.execute("update public.planning_runs set status='running',attempts=1 where id=%s",(run,))
    db.execute("update planning.leases set token=%s,expires_at=now()+interval '15 minutes' where run_id=%s",(token,run))
    db.execute('set local role zeespare_worker')
    task=db.execute('select app.planning_task(%s,%s)',(run,token)).fetchone()[0]
    result=forecast(task)
    assert db.execute('select app.forecast_finish(%s,%s,%s)',(run,token,Jsonb(result))).fetchone()[0]
    print(run)`)
    const run = completed.stdout.trim()
    const resultUrl = `/forecasts/results/${run}?item=${ids.item}`
    await page.goto(resultUrl)
    await expect(
      page.getByRole('heading', { name: 'Captured driver and availability checks', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', {
        name: 'Driver checks for model selection and final fit',
        exact: true,
      }),
    ).toContainText('Available')
    await expect(
      page.getByRole('link', { name: 'Create planned-event scenario', exact: true }),
    ).toHaveCount(0)
    await page.getByText('Inspect driver model coefficients', { exact: true }).click()
    await expect(
      page
        .getByRole('region', {
          name: 'Driver checks for model selection and final fit',
          exact: true,
        })
        .getByRole('columnheader')
        .first(),
    ).toHaveCSS('font-size', '12px')
    await expect(
      page
        .getByRole('region', {
          name: 'Driver checks for model selection and final fit',
          exact: true,
        })
        .locator('caption'),
    ).toHaveCSS('font-size', '12px')
    await expect(page.getByText('Server import time:', { exact: false }).first()).toHaveCSS(
      'font-size',
      '12px',
    )
    await expect(page.getByText('Slope per supplied driver unit', { exact: true })).toBeVisible()
    await page.getByText('Inspect copied driver dataset', { exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Daily driver evidence', exact: true }),
    ).toContainText('Planned')
    const region = page.getByRole('region', {
      name: 'Driver checks for model selection and final fit',
      exact: true,
    })
    await region.focus()
    await expect(region).toBeFocused()
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(formUrl).origin }])
      await page.goto(resultUrl)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page.screenshot({
          path: testInfo.outputPath(`driver-forecast-result-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(formUrl).origin }])
    await page.goto('/forecasts/quality?method=driver-v1')
    await expect(
      page.getByRole('table').getByText('Captured external driver', { exact: true }),
    ).toBeVisible()
    for (const [account, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        other = await context.newPage()
      await signInWithPassword(other, account, password)
      expect((await other.goto(resultUrl))?.status()).toBe(allowed ? 200 : 404)
      expect((await other.goto(formUrl))?.status()).toBe(404)
      await context.close()
    }
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))
    for user in sys.argv[3:]: db.execute('delete from auth.users where id=%s',(user,))`)
  }
})
