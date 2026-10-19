import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect as baseExpect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { expectPageTitle } from './helpers/typography'

const expect = baseExpect.configure({ timeout: 30_000 })

test('policy simulation freezes recorded sales, exposes two exact ledgers and preserves scoped history', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const nonce = randomUUID(),
    password = `Simulation-${nonce}`
  const email = `simulation-${nonce}@example.com`
  const viewerEmail = `simulation-viewer-${nonce}@example.com`
  const branchEmail = `simulation-branch-${nonce}@example.com`
  await createConfirmedUser(email, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `simulation-${nonce}`
  await createOrganization(page, { name: 'Simulation test', slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local simulation test only')
  const python = (script: string) =>
    promisify(execFile)('uv', ['run', 'python', '-X', 'utf8', '-c', script, dsn, org], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 30_000,
    })
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
from datetime import date,timedelta
from psycopg.types.json import Jsonb
org=sys.argv[2]
location,item,run,policy,forecast,source=[uuid4() for _ in range(6)]
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'SIM','Simulation location','branch','SA','Asia/Riyadh')",(location,org))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'SIM-ITEM','Simulation item','Test','EA',1,'SAR')",(item,org))
    period=lambda n,target: dict(days=n,forecast='2',quantile=target,target=target,safety_stock='4')
    output=dict(status='available',lead_time=period(1,'2'),protection=period(3,'6'),residual_count=21,positive_days=90,samples=5000,seed='fixture',calibration=[])
    evidence=dict(method='policy-v1',options=dict(lead_time=1,review_interval=2,service_level='0.95'),forecast=dict(id=str(forecast),run_id=str(source),item_id=str(item),method='baseline-v1',to_date='2026-10-01',horizon=7,
        source=dict(unit_provenance=dict(method='source-units-v1',status='consistent',unit='EA',rows=90,unknown_rows=0,units=['EA'])),output=dict(model='naive',forecast=[dict(date=str(date(2026,10,2)+timedelta(days=n)),quantity='1') for n in range(7)])),output=output)
    db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())",(run,org,location,uuid4()))
    db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'SIM-ITEM','EA','available',%s,%s)",(policy,org,run,location,forecast,item,Jsonb(output),Jsonb(evidence)))
    for n in range(4):
        db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity,unit_of_measure) values(%s,%s,%s,%s,4,1.125,'EA')",(org,item,location,date(2026,10,2)+timedelta(days=n)))
print(json.dumps(dict(policy=str(policy),run=str(run),location=str(location))))`)
    const fixture = JSON.parse(seeded.stdout) as { policy: string; run: string; location: string }
    const newUrl = `/forecasts/simulations/new?policy=${fixture.policy}`
    await page.goto(`/forecasts/workbench/${fixture.policy}`)
    await page.getByRole('link', { name: 'Simulate policy', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Create policy simulation', level: 1 }),
    ).toBeVisible()
    const form = page.getByRole('form', { name: 'Create policy simulation' })
    await form.getByLabel('Replay through').fill('2026-10-05')
    await form.getByLabel('Opening available stock').fill('-1')
    expect(
      await form
        .getByLabel('Opening available stock')
        .evaluate((element: HTMLInputElement) => element.checkValidity()),
    ).toBe(false)
    await form.getByLabel('Opening available stock').fill('2')
    await form.getByLabel('Alternative periodic maximum').fill('8')
    await form.getByRole('checkbox').nth(0).check()
    await form.getByRole('checkbox').nth(1).check()
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await expect(form.getByLabel('Opening available stock')).toHaveCSS(
        'font-size',
        width < 768 ? '16px' : '14px',
      )
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      if (width === 375)
        expect(
          (await form.getByRole('button', { name: 'Queue simulation' }).boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44)
      await page.screenshot({
        path: testInfo.outputPath(`simulation-form-${width}.png`),
        fullPage: true,
      })
    }
    await form.getByRole('button', { name: 'Queue simulation' }).click()
    await expect(page).toHaveURL(/\/forecasts\/simulations\/[0-9a-f-]+$/)
    const resultUrl = page.url()
    await expect(page.getByText('Queued', { exact: true })).toBeVisible()
    await page.goto(newUrl)
    await form.getByLabel('Replay through').fill('2026-10-05')
    await form.getByLabel('Opening available stock').fill('2')
    await form.getByLabel('Alternative periodic maximum').fill('8')
    await form.getByRole('checkbox').nth(0).check()
    await form.getByRole('checkbox').nth(1).check()
    await form.getByRole('button', { name: 'Queue simulation' }).click()
    await expect(form.getByRole('alert')).toHaveText(
      'A planning run is already active, or this request was reused with different inputs. Check the simulation history before trying again.',
      { timeout: 30_000 },
    )
    await expect(form.getByLabel('Opening available stock')).toHaveValue('2')
    await page.goto(resultUrl)
    await expect(page.getByText('Queued', { exact: true })).toBeVisible()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.demand_history set quantity=999 where organization_id=%s',(sys.argv[2],))`)
    await promisify(execFile)('uv', ['run', 'maqdar-worker', '--once'], {
      cwd: resolve(process.cwd(), '../../engine'),
      env: { ...process.env, MAQDAR_WORKER_DSN: dsn },
      timeout: 100_000,
    })
    await page.getByRole('button', { name: 'Refresh runs' }).click()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30_000 })
    const comparison = page.getByRole('table', { name: 'Recorded-sales comparison' })
    await expect(
      comparison.getByRole('row').filter({ hasText: 'Recorded sold quantity' }),
    ).toContainText('16')
    await expect(
      comparison.getByRole('row').filter({ hasText: 'Recorded sales met immediately' }),
    ).toContainText('37.5%')
    await expect(
      comparison.getByRole('row').filter({ hasText: 'Recorded sales met immediately' }),
    ).toContainText('62.5%')
    await expect(
      comparison.getByRole('row').filter({ hasText: 'Recorded lost sales (separate)' }),
    ).toContainText('4.5')
    await page.locator('summary').filter({ hasText: 'Saved policy — daily ledger' }).click()
    const ledger = page.getByRole('region', { name: 'Saved policy — daily ledger' })
    await expect(ledger.locator('tbody tr')).toHaveCount(4)
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await ledger.focus()
      await expect(ledger).toBeFocused()
      if (width === 375) {
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => ledger.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
      }
      await ledger.evaluate((node) => node.scrollTo({ left: 0 }))
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      await page.screenshot({
        path: testInfo.outputPath(`simulation-result-${width}.png`),
        fullPage: true,
      })
    }
    await page.goto(newUrl)
    await page.getByLabel('Opening available stock').fill('0')
    await page.getByLabel('Alternative periodic maximum').fill('0')
    await page.getByRole('checkbox').nth(0).check()
    await page.getByRole('checkbox').nth(1).check()
    await page.getByRole('button', { name: 'Queue simulation' }).click()
    await page.getByRole('button', { name: 'Cancel run', exact: true }).click()
    await expect(page).toHaveURL('/forecasts')
    await page.goto('/forecasts/simulations')
    await expect(page.locator('tbody tr')).toHaveCount(2)
    await expect(page.locator('tbody')).toContainText('Canceled')
    const viewerContext = await browser.newContext(),
      viewerPage = await viewerContext.newPage()
    await signInWithPassword(viewerPage, viewerEmail, password)
    await viewerPage.goto(newUrl)
    await expect(
      viewerPage.getByText('Only owners, administrators and planners can queue simulations.'),
    ).toBeVisible()
    await expect(viewerPage.getByRole('button', { name: 'Queue simulation' })).toHaveCount(0)
    await viewerPage.goto(resultUrl)
    await expect(viewerPage.getByRole('table', { name: 'Recorded-sales comparison' })).toBeVisible()
    await viewerContext.close()
    const branchContext = await browser.newContext(),
      branchPage = await branchContext.newPage()
    await signInWithPassword(branchPage, branchEmail, password)
    expect((await branchPage.goto(resultUrl))?.status()).toBe(404)
    await branchPage.goto('/forecasts/simulations')
    await expect(branchPage.locator('tbody tr')).toHaveCount(0)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
    await branchPage.goto(resultUrl)
    await expect(branchPage.getByRole('table', { name: 'Recorded-sales comparison' })).toBeVisible()
    await branchContext.close()
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
    await page.goto(resultUrl)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.locator('summary').filter({ hasText: 'السياسة المحفوظة — السجل اليومي' }).click()
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      await page.screenshot({
        path: testInfo.outputPath(`simulation-result-rtl-${width}.png`),
        fullPage: true,
      })
    }
    await page.goto(newUrl)
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      await page.screenshot({
        path: testInfo.outputPath(`simulation-form-rtl-${width}.png`),
        fullPage: true,
      })
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.planning_runs where id=%s',('${fixture.run}',))`)
    await page.goto(resultUrl)
    await expect(page.getByRole('table', { name: 'Recorded-sales comparison' })).toContainText(
      '37.5%',
    )
    expect((await page.goto(`/forecasts/workbench/${fixture.policy}`))?.status()).toBe(404)
  } finally {
    // Failed/retried specs must not leave a message for the next spec's --once worker.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.planning_runs set status='canceled',finished_at=clock_timestamp() where organization_id=%s and status in ('queued','running')",(sys.argv[2],))
    db.execute("delete from pgmq.q_planning where (message->>'run_id')::uuid in (select id from public.planning_runs where organization_id=%s)",(sys.argv[2],))`)
  }
})
