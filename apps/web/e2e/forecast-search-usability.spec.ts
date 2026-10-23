import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

const workspace = {
  owner: `forecast-search-${randomUUID()}@example.com`,
  branch: `forecast-branch-${randomUUID()}@example.com`,
  password: `Forecast-${randomUUID()}`,
}
const exactScore = '123,456,789,012,345,678.123'

async function seedForecastSearch(organization: string, branch: string) {
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname)) {
    throw new Error('Forecast search fixtures require the local database')
  }
  // These tables intentionally deny service-role writes; fixture SQL uses the guarded local DSN.
  await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      '-c',
      `
import sys, psycopg
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from psycopg.types.json import Jsonb
dsn, org, branch = sys.argv[1:]
now = datetime.now(timezone.utc)
with psycopg.connect(dsn) as db:
    locations = {}
    for code, name, arabic, active in [
        ('ALPHA', 'Muscat central parts', 'قطع غيار مسقط المركزية', True),
        ('BETA', 'Sohar parts branch', 'فرع صحار لقطع الغيار', True),
        ('ARCHIVE', 'Closed Salalah branch', 'فرع صلالة المغلق', False),
        ('RESTRICTED', 'Restricted warehouse', 'مستودع محظور', True),
    ]:
        location = locations[code] = uuid4()
        db.execute("insert into public.locations(id,organization_id,code,name_en,name_ar,location_type,country_code,timezone,is_active) values(%s,%s,%s,%s,%s,'branch','SA','Asia/Riyadh',%s)", (location,org,code,name,arabic,active))
    foreign = uuid4()
    db.execute("insert into public.organizations(id,slug,name,home_country,base_currency) values(%s,%s,'Foreign search fixture','SA','SAR')", (foreign,f'foreign-search-{foreign}'))
    db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'FOREIGN-ONLY','Foreign tenant warehouse','branch','SA','Asia/Riyadh')", (foreign,))
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')", (org,branch))
    db.execute("insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)", (org,branch,locations['ALPHA']))
    db.execute("insert into public.user_settings(user_id,active_organization_id) values(%s,%s)", (branch,org))
    for index, code in enumerate(locations):
        run = uuid4()
        finished = now - timedelta(hours=index+1)
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,created_at,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-01','forecast','succeeded',%s,'{}',%s,%s)", (run,org,locations[code],uuid4(),Jsonb(dict(method='regional-v1',horizon=28)),finished,finished))
        for number in range(27 if code == 'ALPHA' else 1):
            item = f'SAVED-{number:02}' if code == 'ALPHA' else f'{code}-SAVED'
            rmse = '123456789012345678.123' if code == 'ALPHA' and number == 0 else '3.930'
            scores = [dict(model='mean',rmse=rmse,mae='1.125',bias='-0.125',folds=[dict(rmse=rmse,mae='1.125',bias='-0.125')])]
            source = dict(start_day='2026-01-01',end_day='2026-10-01',introduced_on=None,discontinued_on=None,demand=[],preparation=dict(id=str(uuid4()),run_id=str(uuid4()),group_id=str(uuid4()),unit='EA',original_from='2026-01-01',comparison='fixed-group-v1'))
            output = dict(status='selected',model='mean',total='28',scores=scores,forecast=[],comparison='fixed-group-v1',folds=[dict(train_from='2026-01-01',train_to='2026-07-09',test_from='2026-07-10',test_to='2026-08-06')],evaluation=dict(status='available',model='naive',train_to='2026-09-03',test_from='2026-09-04',test_to='2026-10-01',count=28,coverage80='0.75',coverage95='0.9'))
            db.execute("insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,%s,'Service part forecast evidence','selected','mean',%s,%s)", (org,run,locations[code],uuid4(),item,Jsonb(dict(total='28',scores=scores)),Jsonb(dict(source=source,output=output))))
    for index in range(20):
        kind = 'forecast' if index < 3 else 'classification' if index < 6 else 'readiness'
        created = now - timedelta(minutes=index)
        result = dict(version=1,computed_at=created.isoformat(),active_items=27,items_with_history=27,stored_rows=270,days_with_records=10,positive_demand_rows=270,first_record='2026-01-01',last_record='2026-10-01',quantity='1234.125',lost_sales_quantity='12.125') if kind == 'readiness' else {}
        db.execute("insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,created_at,finished_at) values(%s,%s,%s,'2026-01-01','2026-10-01',%s,'succeeded',%s,%s,%s,%s)", (org,locations['ALPHA' if index % 2 == 0 else 'BETA'],uuid4(),kind,Jsonb(dict(method='baseline-v1',horizon=28)),Jsonb(result),created,created))
`,
      dsn,
      organization,
      branch,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 30_000 },
  )
}

async function expectWorkspaceQuality(page: Page) {
  await expect(page).toHaveURL(
    (url) => url.pathname === '/forecasts' && url.searchParams.get('tab') === 'quality',
  )
  await expect(
    page.getByRole('tab', { name: 'Saved forecast quality', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('tabpanel').getByRole('button', { name: 'Apply filters', exact: true }),
  ).toHaveCount(1)
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  await createConfirmedUser(workspace.owner, workspace.password)
  const branch = await createConfirmedUser(workspace.branch, workspace.password)
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await signInWithPassword(page, workspace.owner, workspace.password)
    const slug = `forecast-search-${randomUUID()}`
    await createOrganization(page, { name: 'Forecast usability QA', slug, arabicEnabled: true })
    await seedForecastSearch(await organizationIdBySlug(slug), branch)
  } finally {
    await context.close()
  }
})

test.beforeEach(async ({ page }) => {
  await signInWithPassword(page, workspace.owner, workspace.password)
})

test('readiness finds active locations by code or name and recent-run filters have an explicit scope', async ({
  page,
}) => {
  await page.goto('/forecasts')
  const location = page
    .getByRole('tabpanel')
    .getByRole('combobox', { name: 'Location code', exact: true })
  await location.fill('Muscat')
  await page.getByRole('option', { name: /ALPHA.*Muscat central parts/ }).click()
  await expect(location).toHaveValue('ALPHA')
  await location.fill('BETA')
  await expect(page.getByRole('option', { name: /BETA.*Sohar parts branch/ })).toBeVisible()
  await location.press('ArrowDown')
  await location.press('Enter')
  await expect(location).toHaveValue('BETA')
  const inactiveLookup = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === '/api/lookup/locations' && url.searchParams.get('q') === 'Closed Salalah'
    )
  })
  await location.fill('Closed Salalah')
  expect((await (await inactiveLookup).json()).locations).toEqual([])
  await expect(
    page
      .getByRole('paragraph')
      .filter({ hasText: 'No matching locations. You can enter a location code.' }),
  ).toBeVisible()
  await expect(page.getByRole('option', { name: /ARCHIVE/ })).toHaveCount(0)
  await location.press('Tab')
  await expect(page.getByRole('tabpanel').getByLabel('From date', { exact: true })).toBeFocused()
  await page.route('**/api/lookup/locations?**', (route) =>
    route.fulfill({ status: 500, json: { error: 'lookup_failed' } }),
  )
  await location.fill('MANUAL-CODE')
  await expect(
    page
      .getByRole('paragraph')
      .filter({ hasText: 'Locations could not be loaded. Enter a code or try again.' }),
  ).toBeVisible()
  await expect(location).toHaveValue('MANUAL-CODE')
  await location.press('Escape')
  await page.unroute('**/api/lookup/locations?**')

  const olderStarted = Promise.withResolvers<void>()
  const releaseOlder = Promise.withResolvers<void>()
  const olderFinished = Promise.withResolvers<void>()
  await page.route('**/api/lookup/locations?**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')
    if (query !== 'older-query' && query !== 'newer-query') {
      await route.continue()
      return
    }
    const older = query === 'older-query'
    if (older) {
      olderStarted.resolve()
      await releaseOlder.promise
    }
    try {
      await route.fulfill({
        json: {
          locations: [
            {
              code: older ? 'ALPHA' : 'BETA',
              name_en: older ? 'Muscat central parts' : 'Sohar parts branch',
              name_ar: null,
              is_active: true,
            },
          ],
        },
      })
    } catch (error) {
      // Editing the input aborts the old request, so a canceled route may reject fulfillment.
      if (!older || !route.request().failure()) throw error
    } finally {
      if (older) olderFinished.resolve()
    }
  })
  await location.fill('older-query')
  await olderStarted.promise
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'Searching locations…' }),
  ).toBeVisible()
  await location.fill('newer-query')
  await expect(page.getByRole('option', { name: /BETA.*Sohar parts branch/ })).toBeVisible()
  releaseOlder.resolve()
  await olderFinished.promise
  await expect(page.getByRole('option', { name: /BETA.*Sohar parts branch/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /ALPHA/ })).toHaveCount(0)
  await location.press('Escape')
  await page.unroute('**/api/lookup/locations?**')

  const history = page.getByRole('table', { name: 'Latest 20 runs', exact: true })
  await expect(history.getByRole('row')).toHaveCount(21)
  const search = page.getByRole('searchbox', { name: 'Search recent runs', exact: true })
  await search.fill('Sohar')
  await expect(history.getByRole('row')).toHaveCount(11)
  await expect(history).not.toContainText('Muscat central parts')
  await expect(page.getByText('10 of 20 recent runs', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear run search', exact: true }).click()
  await expect(search).toHaveValue('')
  await page
    .getByRole('combobox', { name: 'Run type', exact: true })
    .selectOption({ label: 'Forecast baselines' })
  await expect(history.getByRole('row')).toHaveCount(4)
  await expect(history).toContainText('Forecast baselines')
  await search.fill('Closed Salalah')
  await expect(page.getByText('No recent runs match these filters.', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Latest 20 runs · Saved results and source evidence', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Latest 20 only', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await expect(history.getByRole('row')).toHaveCount(21)
})

test('quality filters, chips, reset and pagination retain the workspace and exact saved evidence', async ({
  page,
}) => {
  await page.goto('/forecasts?tab=quality')
  const panel = page.getByRole('tabpanel')
  const table = panel.getByRole('table', { name: 'Saved forecast quality', exact: true })
  await expect(table.getByRole('row')).toHaveCount(26)
  await panel.getByRole('link', { name: 'Next', exact: true }).click()
  await expectWorkspaceQuality(page)
  await expect(table.getByRole('row')).toHaveCount(6)
  await page.goBack()
  await expectWorkspaceQuality(page)
  await expect(table.getByRole('row')).toHaveCount(26)
  await page.goForward()
  await expectWorkspaceQuality(page)
  await expect(table.getByRole('row')).toHaveCount(6)

  await panel.getByLabel('Search item code or name', { exact: true }).fill('SAVED-00')
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectWorkspaceQuality(page)
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText(exactScore)
  await expect(table).toContainText('-0.125')
  await panel.getByRole('button', { name: 'Inspect SAVED-00', exact: true }).click()
  const evidence = page.getByTestId('quality-evidence')
  await expect(evidence).toContainText('Fixed saved-group comparison in EA')
  await expect(evidence).toContainText('80% bands: 75%')
  await expect(evidence).toContainText('95% bands: 90%')
  for (const name of ['Rolling model-selection windows', 'Separate held-out interval coverage']) {
    await expect(evidence.getByRole('heading', { name, exact: true })).toHaveCSS(
      'font-size',
      '14px',
    )
  }
  await expect(
    evidence.getByText('Train: 2026-01-01 – 2026-07-09. Test: 2026-07-10 – 2026-08-06.', {
      exact: true,
    }),
  ).toHaveCSS('font-size', '12px')
  await panel.getByRole('button', { name: 'Clear item search', exact: true }).click()
  await expect(panel.getByLabel('Search item code or name', { exact: true })).toHaveValue('')
  const location = panel.getByRole('combobox', { name: 'Location code', exact: true })
  await location.fill('Closed Salalah')
  await expect(location).toHaveAttribute('aria-expanded', 'true')
  await location.press('Escape')
  await expect(location).toHaveAttribute('aria-expanded', 'false')
  const previousUrl = page.url()
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page).toHaveURL(previousUrl)
  expect(await location.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(
    true,
  )
  await location.fill('')
  await location.fill('Closed Salalah')
  await page.getByRole('option', { name: /ARCHIVE.*Closed Salalah/ }).click()
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectWorkspaceQuality(page)
  await expect(table).toContainText('ARCHIVE-SAVED')
  await expect(table.getByRole('row')).toHaveCount(2)
  await panel.getByRole('link', { name: 'Remove Location code filter', exact: true }).click()
  await expectWorkspaceQuality(page)
  await expect(table.getByRole('row')).toHaveCount(26)

  await panel.getByTestId('quality-more-filters').locator('summary').click()
  await panel.getByRole('combobox', { name: 'Selected model', exact: true }).selectOption('mean')
  await panel
    .getByRole('combobox', { name: 'Forecast method', exact: true })
    .selectOption('regional-v1')
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expectWorkspaceQuality(page)
  await expect(page).toHaveURL(/model=mean/)
  await panel.getByRole('link', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\?tab=quality$/)
  const search = panel.getByLabel('Search item code or name', { exact: true })
  await search.fill('UNSAVED-SEARCH')
  await location.fill('UNSAVED-LOCATION')
  await expect(location).toHaveAttribute('aria-expanded', 'true')
  await location.press('Escape')
  await expect(location).toHaveAttribute('aria-expanded', 'false')
  await panel.getByRole('link', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\?tab=quality$/)
  await expect(search).toHaveValue('')
  await expect(location).toHaveValue('')
  await panel.getByRole('combobox', { name: 'Rows per page', exact: true }).selectOption('50')
  await expectWorkspaceQuality(page)
  await expect(page).toHaveURL(/size=50/)
  await expect(table.getByRole('row')).toHaveCount(31)
  await panel.getByRole('combobox', { name: 'Completion order', exact: true }).selectOption('asc')
  await expectWorkspaceQuality(page)
  await expect(page).toHaveURL(/dir=asc/)

  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/forecasts/quality?q=SAVED-00')
  await expect(
    page.getByRole('table', { name: 'Saved forecast quality', exact: true }),
  ).toContainText(exactScore)
  const region = page.getByRole('region', { name: 'Saved forecast quality', exact: true })
  await page.getByRole('combobox', { name: 'Completion order', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(region).toBeFocused()
  expect(
    await region.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeGreaterThan(0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/quality$/)
})

test('location suggestions enforce session, active organization and branch visibility', async ({
  page,
  browser,
}) => {
  const lookup = '/api/lookup/locations'
  const active = await page.request.get(`${lookup}?q=`)
  expect(active.status()).toBe(200)
  expect(active.headers()['cache-control']).toContain('no-store')
  expect(
    (await active.json()).locations.map((location: { code: string }) => location.code),
  ).toEqual(['ALPHA', 'BETA', 'RESTRICTED'])
  const historical = await page.request.get(`${lookup}?q=Salalah&include_inactive=true`)
  expect((await historical.json()).locations).toEqual([
    expect.objectContaining({ code: 'ARCHIVE', is_active: false }),
  ])
  const foreign = await page.request.get(`${lookup}?q=FOREIGN-ONLY&include_inactive=true`)
  expect((await foreign.json()).locations).toEqual([])
  const branchContext = await browser.newContext()
  const anonymousContext = await browser.newContext()
  try {
    const anonymous = await anonymousContext.request.get(new URL(lookup, page.url()).href)
    expect(anonymous.status()).toBe(401)
    const branch = await branchContext.newPage()
    await signInWithPassword(branch, workspace.branch, workspace.password)
    const branchLocations = await branch.request.get(
      new URL(`${lookup}?q=&include_inactive=true`, branch.url()).href,
    )
    expect((await branchLocations.json()).locations).toEqual([
      expect.objectContaining({ code: 'ALPHA' }),
    ])
    await branch.goto('/forecasts?tab=quality&location=RESTRICTED')
    await expect(
      branch.getByText('No saved results match these filters.', { exact: true }),
    ).toBeVisible()
  } finally {
    await branchContext.close()
    await anonymousContext.close()
  }
})

test('laptop and mobile keep compact evidence typography and usable filters in English and Arabic', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  for (const locale of ['en', 'ar']) {
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/forecasts?tab=quality&q=SAVED-01')
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      const panel = page.getByRole('tabpanel')
      await expect(
        panel.getByRole('heading', {
          name: locale === 'ar' ? 'جودة التنبؤ المحفوظة' : 'Saved forecast quality',
          exact: true,
        }),
      ).toBeVisible()
      await panel
        .getByRole('button', {
          name: `${locale === 'ar' ? 'فحص' : 'Inspect'} SAVED-01`,
          exact: true,
        })
        .click()
      const evidence = page.getByTestId('quality-evidence')
      await expect(evidence).toBeVisible()
      await expect(evidence.getByRole('heading').first()).toHaveCSS('font-size', '14px')
      await expect(evidence.locator('li').first()).toHaveCSS('font-size', '12px')
      await expect(evidence.getByRole('heading').first()).toHaveText(
        locale === 'ar' ? 'فترات اختيار النموذج المتحركة' : 'Rolling model-selection windows',
      )
      const pageWidth = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
      }))
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.width + 1)
      const location = panel.getByRole('combobox').first()
      await expect(location).toHaveCSS('font-size', viewport.width < 768 ? '16px' : '14px')
      await page.screenshot({
        path: testInfo.outputPath(`forecast-quality-${locale}-${viewport.width}.png`),
        fullPage: true,
      })
      await page.goto('/forecasts')
      await expect(
        page.getByRole('link', {
          name: locale === 'ar' ? 'عرض نتائج التنبؤ' : 'View forecast results',
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByRole('tabpanel')
        .getByRole('combobox')
        .first()
        .fill(locale === 'ar' ? 'مسقط' : 'Muscat')
      await expect(page.getByRole('option', { name: /ALPHA/ })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`forecast-runs-${locale}-${viewport.width}.png`),
        fullPage: true,
      })
      await page.getByRole('tabpanel').getByRole('combobox').first().press('Escape')
    }
  }
})

test('quality filters fit tablet layouts and standalone mobile disclosure remains keyboard accessible', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  for (const locale of ['en', 'ar']) {
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
    for (const { width, embedded } of [
      { width: 768, embedded: true },
      { width: 800, embedded: true },
      { width: 768, embedded: false },
      { width: 800, embedded: false },
      { width: 390, embedded: false },
    ]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(
        embedded ? '/forecasts?tab=quality&q=SAVED-01' : '/forecasts/quality?q=SAVED-01',
      )
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      if (embedded) {
        const title = page
          .locator('[data-page-banner="forecasts"]')
          .getByRole('heading', { level: 1 })
        expect((await title.boundingBox())!.height).toBeLessThanOrEqual(24)
      }
      const search = page.getByLabel(
        locale === 'ar' ? 'البحث برمز القطعة أو اسمها' : 'Search item code or name',
        { exact: true },
      )
      const form = page.locator('form').filter({ has: search })
      const [inputBounds, formBounds] = await Promise.all([
        search.boundingBox(),
        form.boundingBox(),
      ])
      expect(inputBounds).not.toBeNull()
      expect(formBounds).not.toBeNull()
      expect(inputBounds!.x).toBeGreaterThanOrEqual(formBounds!.x)
      expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(
        formBounds!.x + formBounds!.width,
      )
      const summary = page.getByTestId('quality-more-filters').locator('summary')
      if (width < 768) {
        expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      await summary.focus()
      await summary.press('Enter')
      await expect(
        page.getByRole('combobox', {
          name: locale === 'ar' ? 'النموذج المختار' : 'Selected model',
          exact: true,
        }),
      ).toBeVisible()
      const pageWidth = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
      }))
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.width + 1)
      await page.screenshot({
        path: testInfo.outputPath(
          `quality-${embedded ? 'workspace' : 'standalone'}-${locale}-${width}.png`,
        ),
        fullPage: true,
      })
    }
  }
})
