import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional freight preserves source dates, pricing, archive lifecycle and all-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = `Sourcing-${key}`,
    email = `regional-freight-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `regional-freight-viewer-${key}@example.com`,
    branchEmail = `regional-freight-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `regional-freight-${key}`
  await createOrganization(page, { name: 'Regional freight', slug, arabicEnabled: true })
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
  const root = `${sourcingRoot}/freight`
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
        path: testInfo.outputPath(`regional-freight-${kind}-${lang}-${width}.png`),
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
from regional_freight_fixture import seed_regional_freight
with psycopg.connect(sys.argv[1]) as db:
    parent,report=seed_regional_freight(db,sys.argv[2],sys.argv[3])
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='DEST'",(sys.argv[5],sys.argv[2]))
    print(json.dumps(dict(parent=str(parent),region=report['source']['source']['region']['id'])))`)
    const { parent, region } = JSON.parse(seeded.stdout.trim()) as {
      parent: string
      region: string
    }
    await page.goto(`${sourcingRoot}/dates/${parent}`)
    await page.getByRole('link', { name: 'Estimate regional freight', exact: true }).click()
    await page
      .getByRole('button', { name: 'Refresh regional freight preview', exact: true })
      .click()
    await expect(page.getByRole('status').first()).toHaveText(
      'Unavailable: resolve the source freight evidence.',
    )
    await expect(
      page.getByRole('button', { name: 'Save regional freight', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox', { name: /I confirm each positive source/ }).check()
    await page
      .getByRole('button', { name: 'Refresh regional freight preview', exact: true })
      .click()
    await expect(page.getByRole('status').first()).toHaveText('Regional freight available')
    const schedule = page.getByRole('table', {
      name: 'Source freight estimates',
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
    await expect(schedule).toContainText('5.76')
    await expect(schedule).toContainText('2.345')
    await visual('preview', 'en')
    await locale('ar')
    await visual('preview', 'ar')
    await locale('en')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.network_links set freight_cost=2.005 where organization_id=%s and from_location_id=(select id from public.locations where organization_id=%s and code='SOURCE-A')",(sys.argv[2],sys.argv[2]))`)
    await page.getByRole('button', { name: 'Save regional freight', exact: true }).click()
    await expect(
      page.getByRole('main').getByRole('alert').filter({ hasText: 'Inputs changed' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Refresh regional freight preview', exact: true })
      .click()
    await expect(schedule.getByRole('row').filter({ hasText: 'SOURCE-A' })).toContainText(
      '2026-10-12',
    )
    const newUrl = page.url()
    await page.getByRole('button', { name: 'Save regional freight', exact: true }).click()
    await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`))
    const savedUrl = page.url()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saved regional freight')
    await visual('detail', 'en')
    const scroll = page.getByRole('region', {
      name: 'Source freight estimates',
      exact: true,
    })
    await page.setViewportSize({ width: 375, height: 1000 })
    await scroll.focus()
    await expect(scroll).toBeFocused()
    await page.keyboard.press('ArrowRight')
    for (const lang of ['en', 'ar']) {
      await locale(lang)
      const evidence = page.getByRole('region', {
        name: lang === 'ar' ? 'مقارنة الشحن الإقليمي' : 'Regional freight comparison',
        exact: true,
      })
      const summaries = evidence.locator(':scope > details > summary')
      for (const summary of await summaries.all()) await summary.click()
      if (lang === 'ar') {
        await expect(evidence).not.toContainText(
          /Supplied freight rate|Saved transfer quantity|Freight applicability|Terms updated/,
        )
        await expect(evidence).toContainText('سريان السعر من')
      }
      await visual('evidence', lang)
      for (const summary of (await summaries.all()).reverse()) await summary.click()
    }
    await visual('detail', 'ar')
    await locale('en')
    // Repricing never changes the retained dates or saved costs.
    await page.goto(newUrl)
    await expect(page.getByRole('status').first()).toHaveText('Regional freight available')
    // Archive serializes with first saves, while retained history remains readable.
    await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.stock_region_archive(%s,%s)',(sys.argv[2],'${region}'))`)
    await page.getByRole('button', { name: 'Save regional freight', exact: true }).click()
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
    await expect(page.getByRole('rowheader', { name: 'REG-P', exact: true })).toHaveCSS(
      'white-space',
      'nowrap',
    )
    await page.getByLabel('Search item, region or location', { exact: true }).fill('not-present')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(
      page.getByText('No saved regional freight estimates.', { exact: true }),
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
