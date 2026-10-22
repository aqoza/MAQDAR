import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional dates preserve fixed allocations, calendars, archive lifecycle and all-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = `Sourcing-${key}`,
    email = `regional-dates-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `regional-dates-viewer-${key}@example.com`,
    branchEmail = `regional-dates-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `regional-dates-${key}`
  await createOrganization(page, { name: 'Regional dates', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug),
    dsn = process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60000,
    })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const sourcingRoot = '/replenishment/regional-stock/sourcing'
  const root = `${sourcingRoot}/dates`
  async function visual(kind: string, lang: string) {
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const value = page.locator('.text-evidence-value').first()
      if (await value.count()) await expect(value).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath(`regional-dates-${kind}-${lang}-${width}.png`),
        fullPage: true,
      })
    }
  }
  async function locale(value: string) {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    const seeded = await python(`import sys,json,psycopg
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'tests')
from regional_dates_fixture import seed_regional_dates
with psycopg.connect(sys.argv[1]) as db:
    parent,report=seed_regional_dates(db,sys.argv[2],sys.argv[3])
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='DEST'",(sys.argv[5],sys.argv[2]))
    print(json.dumps(dict(parent=str(parent),region=report['source']['region']['id'])))`)
    const { parent, region } = JSON.parse(seeded.stdout.trim()) as {
      parent: string
      region: string
    }
    await page.goto(`${sourcingRoot}/${parent}`)
    await page.getByRole('link', { name: 'Plan regional transfer dates', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Confirm that calendar settings apply.')
    await expect(
      page.getByRole('button', { name: 'Save regional dates', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox', { name: /I confirm the source and destination/ }).check()
    await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Regional dates available')
    const schedule = page.getByRole('table', {
      name: 'Source dispatch and receipt scenarios',
      exact: true,
    })
    await expect(schedule.getByRole('row').filter({ hasText: 'SOURCE-A' })).toContainText(
      '2026-10-12',
    )
    await expect(schedule.getByRole('row').filter({ hasText: 'SOURCE-B' })).toContainText(
      '2026-10-11',
    )
    await expect(schedule).toContainText('4.667')
    await expect(schedule).toContainText('9.333')
    await visual('preview', 'en')
    await locale('ar')
    await visual('preview', 'ar')
    await locale('en')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set weekend_days=array[7] where organization_id=%s and code='SOURCE-A'",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save regional dates', exact: true }).click()
    await expect(
      page.getByRole('main').getByRole('alert').filter({ hasText: 'Inputs changed' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
    await expect(schedule.getByRole('row').filter({ hasText: 'SOURCE-A' })).toContainText(
      '2026-10-10',
    )
    const newUrl = page.url()
    await page.getByRole('button', { name: 'Save regional dates', exact: true }).click()
    await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`))
    const savedUrl = page.url()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Saved regional transfer dates',
    )
    await visual('detail', 'en')
    const scroll = page.getByRole('region', {
      name: 'Source dispatch and receipt scenarios',
      exact: true,
    })
    await page.setViewportSize({ width: 375, height: 1000 })
    await scroll.focus()
    await expect(scroll).toBeFocused()
    await page.keyboard.press('ArrowRight')
    for (const lang of ['en', 'ar']) {
      await locale(lang)
      const evidence = page.getByRole('region', {
        name: lang === 'ar' ? 'معاينة المواعيد الإقليمية' : 'Regional date preview',
        exact: true,
      })
      const summaries = evidence.locator('details > summary')
      for (const summary of await summaries.all()) await summary.click()
      if (lang === 'ar') {
        await expect(evidence).not.toContainText(
          /Timing review required|Requested dispatch date|Typical receipt|Calendar ID/,
        )
        await expect(evidence).toContainText('تواريخ التقويم المفحوصة')
      }
      await visual('evidence', lang)
      for (const summary of (await summaries.all()).reverse()) await summary.click()
    }
    await visual('detail', 'ar')
    await locale('en')
    // Unknown dates remain inspectable, but no partial schedule can be saved.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set observe_public_holidays=true where organization_id=%s",(sys.argv[2],))`)
    await page.goto(newUrl)
    await page.getByLabel('Requested dispatch date', { exact: true }).fill('2099-10-10')
    await page.getByRole('button', { name: 'Refresh transfer date preview', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Unavailable: inspect source evidence')
    await expect(
      page.getByRole('button', { name: 'Save regional dates', exact: true }),
    ).toHaveCount(0)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.work_calendars set observe_public_holidays=false where organization_id=%s",(sys.argv[2],))`)
    await page.goto(newUrl)
    await expect(page.getByRole('status')).toHaveText('Regional dates available')
    // Archive serializes with first saves, while retained history remains readable.
    await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.stock_region_archive(%s,%s)',(sys.argv[2],'${region}'))`)
    await page.getByRole('button', { name: 'Save regional dates', exact: true }).click()
    await expect(
      page
        .getByRole('main')
        .getByRole('alert')
        .filter({ hasText: /not found|unavailable/i }),
    ).toBeVisible()
    expect((await page.goto(newUrl))?.status()).toBe(404)
    expect((await page.goto(savedUrl))?.status()).toBe(200)
    await page.goto(root)
    await visual('history', 'en')
    await page.getByLabel('Search region, item or locations', { exact: true }).fill('not-present')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(
      page.getByText('No transfer date scenarios match these filters.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Show all scenarios', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Inspect REG-P', exact: true })).toBeVisible()
    await locale('ar')
    await visual('history', 'ar')
    for (const [account, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, account, password)
        const response = await scoped.goto(savedUrl)
        expect(response?.status()).toBe(allowed ? 200 : 404)
        if (!allowed) expect(await response!.text()).not.toContain('Northern sourcing region')
        expect((await scoped.goto(newUrl))?.status()).toBe(404)
        await scoped.goto(root)
        await expect(scoped.getByRole('link', { name: 'Inspect REG-P', exact: true })).toHaveCount(
          allowed ? 1 : 0,
        )
        if (!allowed) {
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code<>'DEST'",(sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(200)
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select id from public.locations where organization_id=%s and code='SOURCE-B')",(sys.argv[2],sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(404)
        }
      } finally {
        await context.close()
      }
    }
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
