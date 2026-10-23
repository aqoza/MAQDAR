import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('installed-base evaluations capture completed sales and retain scoped responsive evidence', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID(),
    password = `Demand-${key}`,
    email = `demand-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `demand-viewer-${key}@example.com`,
    branchEmail = `demand-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `installed-demand-${key}`
  await createOrganization(page, { name: 'Installed demand evidence', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60_000,
    })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const visual = async (kind: string, locale: string) => {
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 390, 768, 1024, 1366, 1440, 1920]) {
      const height = width === 1366 ? 768 : width === 390 ? 844 : 1000
      await page.setViewportSize({ width, height })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      for (const heading of await page.locator('h2').all()) {
        await expect(heading).toHaveCSS('font-size', '14px')
      }
      for (const heading of await page.locator('th').all()) {
        await expect(heading).toHaveCSS('font-size', '12px')
        await expect(heading).toHaveCSS('font-weight', '500')
      }
      if (await page.locator('dd.text-evidence-value').count()) {
        await expect(page.locator('dd.text-evidence-value').first()).toHaveCSS('font-size', '14px')
      }
      if (kind !== 'detail') {
        await expect(page.getByRole('textbox').first()).toHaveCSS(
          'font-size',
          width < 768 ? '16px' : '14px',
        )
      }
      if (width < 768) {
        for (const summary of await page.locator('summary:visible').all()) {
          expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        }
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `installed-base-evaluation-${kind}-${locale}-${width}x${height}.png`,
        ),
        fullPage: true,
      })
    }
  }
  const locale = async (value: string) => {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    org=sys.argv[2]
    db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'BASE-L','Service location','branch','SA','Asia/Riyadh'),(%s,'OTHER-L','Other location','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone,is_active) values(%s,'CLOSED-L','Closed service location','موقع خدمة مغلق','branch','SA','Asia/Riyadh',false)",(org,))
    db.execute("update public.locations set name_ar='موقع الخدمة' where organization_id=%s and code='BASE-L'",(org,))
    db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'BASE-P','Installed part','Test','EA',1,'SAR')",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='OTHER-L'",(sys.argv[5],org))
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=org,role='authenticated')),))
    source=dict(item_code='BASE-P',location_code='BASE-L',dataset_name='Equipment population',unit='EA',source='Synthetic source',as_of='2026-01-02',available_on='2026-01-03',confirmed=True,non_overlapping=True,rows=[dict(group_code='A',group_name='Known group',installed_on='2026-01-01',active_assets='12',parts_per_asset='2.5'),dict(group_code='B',group_name='Unknown age',installed_on=None,active_assets='3',parts_per_asset='0.001'),dict(group_code='C',group_name='Zero group',installed_on=None,active_assets='0',parts_per_asset='1')])
    preview=db.execute('select public.installed_base_preview(%s,%s)',(org,Jsonb(source))).fetchone()[0]
    saved=db.execute('select public.installed_base_save(%s,%s,%s,%s)',(org,Jsonb(source),uuid4(),preview['fingerprint'])).fetchone()[0]
    payload=dict(scenario_id=str(saved))
    demand=dict(dataset_id=str(saved),scenario_name='Expected replacement demand',cutoff='2026-01-03',horizon_days=3,confirmed=True,rates=[dict(group_code=g['group_code'],daily_rate='0.01' if g['group_code']=='A' else '0.000000001',source='Explicit assumption',available_on='2026-01-03') for g in source['rows']])
    report=db.execute('select public.installed_base_demand_preview(%s,%s)',(org,Jsonb(demand))).fetchone()[0]
    scenario=db.execute('select public.installed_base_demand_save(%s,%s,%s,%s)',(org,Jsonb(demand),uuid4(),report['fingerprint'])).fetchone()[0]
    db.execute('reset role')
    db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity,unit_of_measure) select i.organization_id,i.id,l.id,'2026-01-04',1,2,'EA' from public.items i join public.locations l using(organization_id) where i.organization_id=%s and l.code='BASE-L'",(org,))
    print(scenario)`)
    const scenario = seeded.stdout.trim(),
      createUrl = `/forecasts/installed-base/demand/${scenario}/evaluate`
    await page.goto('/forecasts/installed-base/evaluations')
    await expect(
      page.locator('p[role="status"]:visible').filter({ hasText: /^No evaluations saved yet\.$/ }),
    ).toHaveText('No evaluations saved yet.')
    await page.goto(`/forecasts/installed-base/demand/${scenario}`)
    await page.getByRole('link', { name: 'Evaluate demand scenario', exact: true }).click()
    const preview = page.getByRole('button', { name: 'Preview evaluation', exact: true })
    await expect(preview).toBeDisabled()
    await page.getByLabel('Evaluation name', { exact: true }).fill('Captured evaluation')
    await expect(preview).toBeDisabled()
    await page.getByRole('checkbox').check()
    await preview.click()
    const summary = page.getByRole('region', { name: 'Recorded-sales comparison', exact: true })
    await expect(summary).toContainText('0.900000000009')
    await expect(page.getByRole('checkbox')).toBeChecked()
    const ledger = page.getByRole('region', { name: 'Daily comparison ledger', exact: true })
    await expect(ledger.getByRole('row')).toHaveCount(4)
    await expect(ledger.getByText('Confirmed missing day: zero', { exact: true })).toHaveCount(2)
    await page.getByRole('checkbox').uncheck()
    await expect(ledger).toHaveCount(0)
    await expect(preview).toBeDisabled()
    await page.getByRole('checkbox').check()
    await preview.click()
    await expect(page.getByRole('checkbox')).toBeChecked()
    await page.getByLabel('Evaluation name', { exact: true }).fill('Renamed evaluation')
    await expect(ledger).toHaveCount(0)
    await page.getByLabel('Evaluation name', { exact: true }).fill('Captured evaluation')
    await preview.click()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.demand_history set unit_of_measure=null where organization_id=%s',(sys.argv[2],))`)
    await preview.click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Evaluation unavailable')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.demand_history set unit_of_measure='EA' where organization_id=%s",(sys.argv[2],))`)
    await preview.click()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.demand_history set quantity=2 where organization_id=%s',(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save evaluation', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Evidence changed')
    await preview.click()
    await expect(summary).toContainText('-1.099999999991')
    await expect(page.getByRole('checkbox')).toBeChecked()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await visual('form', 'en')
    await page.getByRole('button', { name: 'Save evaluation', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/evaluations\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await expect(
      page.getByRole('heading', { name: 'Captured evaluation', exact: true }),
    ).toBeVisible()
    await expect(page.locator('details').last().locator('dd').first()).toHaveCSS(
      'font-size',
      '12px',
    )
    await expect(page.locator('details').last().locator('dd').last()).toHaveCSS('font-size', '12px')
    await visual('detail', 'en')
    await page.setViewportSize({ width: 375, height: 1000 })
    await ledger.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => ledger.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(0)
    await page.getByText('Copied scenario, population and rate evidence', { exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Conditional expected demand', exact: true }),
    ).toContainText('0.900000000009')
    await locale('ar')
    await visual('detail', 'ar')
    await page.goto(createUrl)
    await page.getByLabel('اسم التقييم', { exact: true }).fill('تقييم مسجل')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'معاينة التقييم', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'مقارنة المبيعات المسجلة', exact: true }),
    ).toBeVisible()
    await visual('form', 'ar')
    await page.goto('/forecasts/installed-base/evaluations')
    const arabicLocation = page.getByRole('combobox')
    await arabicLocation.fill('موقع الخدمة')
    await expect(page.getByRole('option').filter({ hasText: 'BASE-L' })).toBeVisible()
    await arabicLocation.press('ArrowDown')
    await arabicLocation.press('Enter')
    await expect(arabicLocation).toHaveAttribute('aria-expanded', 'false')
    await expect(arabicLocation).toHaveValue('BASE-L')
    await visual('history', 'ar')
    await locale('en')
    await visual('history', 'en')
    const historySearch = page.getByRole('textbox', { name: 'Evaluation name', exact: true })
    const historyLocation = page.getByRole('combobox', {
      name: 'Service location',
      exact: true,
    })
    const historyUrl = page.url()
    await historySearch.fill('Unsaved search')
    await historyLocation.fill('HISTORICAL-L')
    await expect(historyLocation).toHaveAttribute('aria-expanded', 'true')
    await historyLocation.press('Escape')
    await expect(historyLocation).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page).toHaveURL(historyUrl)
    await expect(historySearch).toHaveValue('')
    await expect(historyLocation).toHaveValue('')
    await page.goto('/forecasts/installed-base/evaluations?item=BASE-P')
    const appliedItem = page.getByRole('textbox', { name: 'Part code', exact: true })
    await expect(appliedItem).toHaveValue('BASE-P')
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/evaluations$/)
    await expect(appliedItem).toHaveValue('')
    await historySearch.fill('Temporary search')
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(historySearch).toHaveValue('')
    await expect(historySearch).toBeFocused()
    const historicalLookup = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname === '/api/lookup/locations' &&
        url.searchParams.get('q') === 'Closed service' &&
        url.searchParams.get('include_inactive') === 'true'
      )
    })
    await historyLocation.fill('Closed service')
    await historicalLookup
    await expect(page.getByRole('option').filter({ hasText: 'CLOSED-L' })).toBeVisible()
    await historyLocation.press('ArrowDown')
    await historyLocation.press('Enter')
    await expect(historyLocation).toHaveAttribute('aria-expanded', 'false')
    await expect(historyLocation).toHaveValue('CLOSED-L')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/location=CLOSED-L/)
    await expect(page.locator('p[role="status"]:visible')).toHaveText(
      'No saved evaluations match these filters.',
    )
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/evaluations$/)
    await expect(historyLocation).toHaveValue('')
    await historySearch.fill('Captured')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/q=Captured/)
    await expect(page.getByRole('link', { name: 'Captured evaluation', exact: true })).toBeVisible()
    await page.getByLabel('Evaluation name', { exact: true }).fill('no-match')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.locator('p[role="status"]:visible')).toHaveText(
      'No saved evaluations match these filters.',
    )
    for (const [address, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, address, password)
        const response = await scoped.goto(savedUrl)
        expect(response?.status()).toBe(allowed ? 200 : 404)
        if (!allowed) expect(await response!.text()).not.toContain('Captured evaluation')
        expect((await scoped.goto(createUrl))?.status()).toBe(404)
        await scoped.goto('/forecasts/installed-base/evaluations')
        await expect(
          scoped.getByRole('link', { name: 'Captured evaluation', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
      } finally {
        await context.close()
      }
    }
    await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    scenario=db.execute('select id from public.installed_base_demand_scenarios where organization_id=%s',(sys.argv[2],)).fetchone()[0]
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    for n in range(26):
        payload=dict(scenario_id=str(scenario),evaluation_name=f'History {n:02d}',confirmed=True)
        report=db.execute('select public.installed_base_evaluation_preview(%s,%s)',(sys.argv[2],Jsonb(payload))).fetchone()[0]
        db.execute('select public.installed_base_evaluation_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(payload),uuid4(),report['fingerprint']))`)
    await page.goto('/forecasts/installed-base/evaluations')
    const history = page.getByRole('region', { name: 'Installed-base evaluations', exact: true })
    await expect(history.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(history.getByRole('row')).toHaveCount(3)
    const unfinished = await python(`import sys,json,psycopg
from uuid import uuid4
from datetime import datetime
from zoneinfo import ZoneInfo
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    original=db.execute('select report from public.installed_base_demand_scenarios where organization_id=%s',(sys.argv[2],)).fetchone()[0]['input']
    original={**original,'cutoff':datetime.now(ZoneInfo('Asia/Riyadh')).date().isoformat(),'horizon_days':1}
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    preview=db.execute('select public.installed_base_demand_preview(%s,%s)',(sys.argv[2],Jsonb(original))).fetchone()[0]
    print(db.execute('select public.installed_base_demand_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(original),uuid4(),preview['fingerprint'])).fetchone()[0])`)
    await page.goto(`/forecasts/installed-base/demand/${unfinished.stdout.trim()}/evaluate`)
    await expect(page.getByRole('status')).toContainText('entire scenario horizon must finish')
    await expect(page.getByRole('button', { name: 'Preview evaluation', exact: true })).toHaveCount(
      0,
    )
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.demand_history where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.installed_base_demand_scenarios where organization_id=%s',(sys.argv[2],))`)
    await page.goto(savedUrl)
    await expect(
      page.getByText('The original scenario is unavailable. Its captured evidence remains below.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(summary).toContainText('-1.099999999991')
    await expect(ledger.getByText('2', { exact: true })).toHaveCount(2)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.demand_history where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:6],))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
