import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect as baseExpect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { expectPageTitle } from './helpers/typography'

const expect = baseExpect.configure({ timeout: 30_000 })
test.use({ actionTimeout: 30_000 })

test('calendar comparisons capture evidence, reject stale previews and preserve scoped responsive results', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const nonce = randomUUID(),
    password = `Calendars-${nonce}`,
    email = `cal-${nonce}@example.com`
  const viewerEmail = `cal-viewer-${nonce}@example.com`,
    branchEmail = `cal-branch-${nonce}@example.com`
  await createConfirmedUser(email, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `cal-${nonce}`
  await createOrganization(page, { name: 'Calendar simulation test', slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local calendar test only')
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
from maqdar_engine.policy_simulation import calculate as original
from maqdar_engine.policy_constraints import calculate
org=sys.argv[2]
location,item,run,policy,policy_run,result,original_run,calendar=[uuid4() for _ in range(8)]
source=dict(kind='simulation',method='periodic-replay-v1',computed_at='2026-10-20T00:00:00+00:00',from_date='2026-01-02',to_date='2026-01-05',
 options=dict(history_confirmed=True,empty_start_confirmed=True,opening_stock='2',alternative_maximum='8'),
 policy=dict(id=str(policy),run_id=str(policy_run),item_id=str(item),item_code='CAL-ITEM',unit='EA',cutoff='2026-01-01',horizon=7,lead_time=1,review_interval=2,maximum='6'),
 demand=[dict(date=str(date(2026,1,2)+timedelta(days=n)),quantity='4',lost_sales_quantity='1.125',recorded=True) for n in range(4)])
source['output']=original(source)
comparison=dict(source,method='periodic-constraints-v1',options=dict(source['options'],reuse_confirmed=True,source_run_id=str(original_run),
 configurations=[dict(maximum='6',lead_time=0,review_interval=1,moq='0',pack='2.5')]),
 source_simulation=dict(id=str(uuid4()),run_id=str(original_run),evidence=source))
comparison['output']=calculate(comparison)
with psycopg.connect(sys.argv[1]) as db:
 for user,role in [('${viewer}','viewer'),('${branch}','branch_user')]:
  db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
  db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
 db.execute('update public.organizations set arabic_enabled=true where id=%s',(org,))
 db.execute("insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,'ORDER','Ordering','SA',array[5,6],false)",(calendar,org))
 db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,work_calendar_id) values(%s,%s,'CAL','Calendar location','branch','SA','Asia/Riyadh',%s)",(location,org,calendar))
 db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'CAL-ITEM','Calendar item','Test','EA',1,'SAR')",(item,org))
 db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-02','2026-01-05','simulation','succeeded',%s,'{}',now())",(run,org,location,uuid4(),Jsonb(dict(method='periodic-constraints-v1'))))
 db.execute("insert into public.policy_simulations(id,organization_id,run_id,location_id,policy_id,item_id,item_code,unit,evidence) values(%s,%s,%s,%s,%s,%s,'CAL-ITEM','EA',%s)",(result,org,run,location,policy,item,Jsonb(comparison)))
print(json.dumps(dict(run=str(run),calendar=str(calendar),location=str(location))))`)
    const fixture = JSON.parse(seeded.stdout) as { run: string; calendar: string; location: string }
    const newUrl = `/forecasts/simulations/calendars?source=${fixture.run}`
    await page.goto(`/forecasts/simulations/${fixture.run}`)
    await page.getByRole('link', { name: 'Compare working calendars' }).click()
    await page.getByLabel('Ordering calendar', { exact: true }).selectOption(fixture.calendar)
    await page.getByRole('button', { name: 'Refresh calendar preview' }).click()
    const previewUrl = page.url()
    const form = page.getByRole('form', { name: 'Queue calendar comparison' })
    await form.getByRole('checkbox').check()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.work_calendars set weekend_days=array[6] where id=%s",('${fixture.calendar}',))`)
    await form.getByRole('button', { name: 'Queue calendar comparison' }).click()
    await expect(form.getByRole('alert')).toContainText('Refresh the preview')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.work_calendars set weekend_days=array[5,6] where id=%s",('${fixture.calendar}',))`)
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto(previewUrl)
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        await page.screenshot({
          path: testInfo.outputPath(`calendars-form-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(previewUrl)
    await form.getByRole('checkbox').check()
    await form.getByRole('button', { name: 'Queue calendar comparison' }).click()
    await expect(page).toHaveURL(/\/forecasts\/simulations\/[0-9a-f-]+$/)
    const resultUrl = page.url()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.work_calendars set weekend_days=array[1,2] where id=%s",('${fixture.calendar}',))
 db.execute("delete from public.planning_runs where id=%s",('${fixture.run}',))`)
    await promisify(execFile)('uv', ['run', 'maqdar-worker', '--once'], {
      cwd: resolve(process.cwd(), '../../engine'),
      env: { ...process.env, MAQDAR_WORKER_DSN: dsn },
      timeout: 100_000,
    })
    await page.getByRole('button', { name: 'Refresh runs' }).click()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    const comparison = page.getByRole('table', { name: 'Policy comparison', exact: true })
    await expect(comparison.locator('tbody tr')).toHaveCount(3)
    await expect(comparison.locator('tbody tr').nth(1)).toContainText('100%')
    await expect(comparison.locator('tbody tr').nth(2)).toContainText('62.5%')
    await page.getByLabel('Daily ledger', { exact: true }).selectOption('2')
    await page.getByRole('button', { name: 'Show ledger' }).click()
    await expect(
      page.getByRole('table', { name: 'Review date shifts' }).locator('tbody tr'),
    ).toHaveCount(4)
    await expect(
      page
        .getByRole('table', { name: 'Calendar alternative 1', exact: true })
        .locator('tbody tr')
        .nth(2),
    ).toContainText('12.5')
    const viewerContext = await browser.newContext(),
      viewerPage = await viewerContext.newPage()
    await signInWithPassword(viewerPage, viewerEmail, password)
    await viewerPage.goto(resultUrl)
    await expect(
      viewerPage.getByRole('table', { name: 'Policy comparison', exact: true }),
    ).toBeVisible()
    await viewerContext.close()
    const branchContext = await browser.newContext(),
      branchPage = await branchContext.newPage()
    await signInWithPassword(branchPage, branchEmail, password)
    expect((await branchPage.goto(resultUrl))?.status()).toBe(404)
    await branchContext.close()
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto(`${resultUrl}?variant=2`)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        const metrics = page.getByRole('region').first()
        await metrics.focus()
        await expect(metrics).toBeFocused()
        if (width === 375) {
          await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
          await expect
            .poll(() => metrics.evaluate((node) => Math.abs(node.scrollLeft)))
            .toBeGreaterThan(0)
        }
        await metrics.evaluate((node) => node.scrollTo({ left: 0 }))
        await page.screenshot({
          path: testInfo.outputPath(`calendars-result-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    expect((await page.goto(newUrl))?.status()).toBe(404)
    await page.goto('/forecasts/simulations')
    await expect(page.locator('tbody')).toContainText('محاكاة تراعي تقاويم العمل')
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.planning_runs set status='canceled',finished_at=clock_timestamp() where organization_id=%s and status in ('queued','running')",(sys.argv[2],))
 db.execute("delete from pgmq.q_planning where (message->>'run_id')::uuid in (select id from public.planning_runs where organization_id=%s)",(sys.argv[2],))`)
  }
})
