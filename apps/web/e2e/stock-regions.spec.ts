import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('reusable regions preserve fixed membership, archive safety and scoped history at every width', async ({
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
  const slug = `stock-regions-${key}`
  await createOrganization(page, { name: 'Regional stock evidence', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const evidence = page.locator('.text-evidence-value').first()
      if (await evidence.count()) await expect(evidence).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath(`stock-regions-${kind}-${locale}-${width}.png`),
        fullPage: true,
      })
    }
  }
  const locale = async (value: string) => {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    org=sys.argv[2]
    db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,'REG-A','Warehouse','المستودع','central','SA','Asia/Riyadh'),(%s,'REG-B','Branch','الفرع','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'REG-P','Regional part','Test','EA',1,'SAR')",(org,))
    db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) select l.organization_id,i.id,l.id,'2026-01-08',0.1,0.2,1,'SAR','EA' from public.locations l join public.items i using(organization_id) where l.organization_id=%s",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='REG-A'",(sys.argv[5],org))`)
    const regions = '/replenishment/regional-stock/regions'
    const fillRegion = async (ar = false) => {
      await page
        .getByLabel(ar ? 'اسم المنطقة بالإنجليزية' : 'Region name (English)', { exact: true })
        .fill('Northern service region')
      await page
        .getByLabel(ar ? 'اسم المنطقة بالعربية (اختياري)' : 'Region name (Arabic, optional)', {
          exact: true,
        })
        .fill('منطقة الخدمة الشمالية')
      for (const code of ['REG-B', 'REG-A']) {
        await page.getByLabel(ar ? 'رمز الموقع' : 'Location code', { exact: true }).fill(code)
        await page
          .getByRole('button', { name: ar ? 'إضافة موقع' : 'Add location', exact: true })
          .click()
      }
      await page.getByRole('checkbox').check()
      await page
        .getByRole('button', { name: ar ? 'معاينة المنطقة' : 'Preview region', exact: true })
        .click()
    }
    await page.goto(`${regions}/new`)
    await expect(page.getByRole('button', { name: 'Preview region', exact: true })).toBeDisabled()
    await fillRegion()
    await expect(page.getByRole('button', { name: 'Save region', exact: true })).toBeVisible()
    await page.getByLabel('Region name (English)', { exact: true }).fill('Changed name')
    await expect(page.getByRole('button', { name: 'Save region', exact: true })).toHaveCount(0)
    await page.getByLabel('Region name (English)', { exact: true }).fill('Northern service region')
    await page.getByRole('button', { name: 'Preview region', exact: true }).click()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.locations set name_en='Updated warehouse' where organization_id=%s and code='REG-A'",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save region', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Evidence changed')
    await page.getByRole('button', { name: 'Preview region', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('checkbox')).toBeChecked()
    await visual('form', 'en')
    await page.getByRole('button', { name: 'Save region', exact: true }).click()
    await expect(page).toHaveURL(/regions\/[0-9a-f-]{36}$/)
    const regionUrl = page.url(),
      regionId = regionUrl.split('/').at(-1)!
    await visual('detail', 'en')
    await page.setViewportSize({ width: 375, height: 1000 })
    const membershipTable = page
      .getByRole('region', { name: 'Saved region membership', exact: true })
      .last()
    await membershipTable.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => membershipTable.evaluate((el) => Math.abs(el.scrollLeft)))
      .toBeGreaterThan(0)
    await locale('ar')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('منطقة الخدمة الشمالية')
    await expect(page.getByRole('cell', { name: 'المستودع', exact: true })).toBeVisible()
    await visual('detail', 'ar')
    await page.goto(`${regions}/new`)
    await fillRegion(true)
    await visual('form', 'ar')
    await page.goto(regions)
    await visual('history', 'ar')
    await locale('en')
    await visual('history', 'en')
    await page.getByLabel('Region name (English)', { exact: true }).fill('no matching region')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('No saved regions')
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await page.getByRole('link', { name: 'Northern service region', exact: true }).click()
    await page.getByRole('link', { name: 'Use region in assessment', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Saved region', exact: true })).toHaveValue(
      regionId,
    )
    await expect(page.getByLabel('Location code', { exact: true })).toHaveCount(0)
    await page.getByLabel('Assessment name', { exact: true }).fill('Region-based assessment')
    await page.getByLabel('Item code', { exact: true }).fill('REG-P')
    await page.getByLabel('As-of date', { exact: true }).fill('2026-01-15')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Preview assessment', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Observed regional stock', exact: true }),
    ).toContainText('-0.2')
    await page
      .getByText('Captured region definition: Northern service region', { exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: 'Saved region membership', exact: true }).first(),
    ).toContainText('REG-A')
    await visual('assessment-preview', 'en')
    await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
    await expect(page).toHaveURL(/regional-stock\/[0-9a-f-]{36}$/)
    const assessmentUrl = page.url()
    await locale('ar')
    await visual('assessment', 'ar')
    await locale('en')
    // A second browser holds a valid preview while the region is archived.
    const staleContext = await browser.newContext(),
      stale = await staleContext.newPage()
    try {
      await signInWithPassword(stale, email, password)
      await stale.goto(`/replenishment/regional-stock/new?region=${regionId}`)
      await stale.getByLabel('Assessment name', { exact: true }).fill('Stale region preview')
      await stale.getByLabel('Item code', { exact: true }).fill('REG-P')
      await stale.getByLabel('As-of date', { exact: true }).fill('2026-01-15')
      await stale.getByRole('checkbox').check()
      await stale.getByRole('button', { name: 'Preview assessment', exact: true }).click()
      await expect(
        stale.getByRole('button', { name: 'Save assessment', exact: true }),
      ).toBeVisible()
      await page.goto(regionUrl)
      await page.getByRole('button', { name: 'Archive region', exact: true }).click()
      await expect(
        page.getByRole('link', { name: 'Use region in assessment', exact: true }),
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Archive region', exact: true })).toHaveCount(0)
      await stale.getByRole('button', { name: 'Save assessment', exact: true }).click()
      await expect(stale.getByRole('main').getByRole('alert')).toBeVisible()
    } finally {
      await staleContext.close()
    }
    expect(
      (await page.goto(`/replenishment/regional-stock/new?region=${regionId}`))?.status(),
    ).toBe(404)
    await page.goto('/replenishment/regional-stock/new')
    await expect(
      page.getByRole('option', { name: 'Northern service region', exact: true }),
    ).toHaveCount(0)
    expect((await page.goto(assessmentUrl))?.status()).toBe(200)
    await page
      .getByText('Captured region definition: Northern service region', { exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: 'Saved region membership', exact: true }).first(),
    ).toContainText('Updated warehouse')
    await page.goto(`${regions}?status=archived&location=REG-A`)
    await expect(
      page.getByRole('link', { name: 'Northern service region', exact: true }),
    ).toBeVisible()
    await page.goto(`${regions}?status=active`)
    await expect(
      page.getByRole('link', { name: 'Northern service region', exact: true }),
    ).toHaveCount(0)
    for (const [address, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, address, password)
        const response = await scoped.goto(regionUrl)
        expect(response?.status()).toBe(allowed ? 200 : 404)
        if (!allowed) expect(await response!.text()).not.toContain('Northern service region')
        await expect(
          scoped.getByRole('button', { name: 'Archive region', exact: true }),
        ).toHaveCount(0)
        expect((await scoped.goto(`${regions}/new`))?.status()).toBe(404)
        await scoped.goto(`${regions}?location=REG-A`)
        await expect(
          scoped.getByRole('link', { name: 'Northern service region', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
        if (!allowed) {
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='REG-B'",(sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(regionUrl))?.status()).toBe(200)
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s',(sys.argv[2],sys.argv[5]))`)
          expect((await scoped.goto(regionUrl))?.status()).toBe(404)
        }
      } finally {
        await context.close()
      }
    }
    // Exercise paginated history and an explicit selection outside the bounded recent suggestions.
    const seeded = await python(`import sys,psycopg,json
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
    for n in range(201):
        data=dict(name_en='Older selectable region' if n==0 else f'Region {n:03}',location_codes=['REG-A','REG-B'],confirmed=True)
        report=db.execute('select public.stock_region_preview(%s,%s)',(sys.argv[2],Jsonb(data))).fetchone()[0]
        saved=db.execute('select public.stock_region_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(data),uuid4(),report['fingerprint'])).fetchone()[0]
        if n==0: print(saved)`)
    const olderId = seeded.stdout.trim()
    await page.goto(`${regions}?status=active`)
    await expect(page.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await page.goto('/replenishment/regional-stock/new')
    await expect(
      page.getByRole('combobox', { name: 'Saved region', exact: true }).getByRole('option'),
    ).toHaveCount(201)
    await expect(
      page.getByRole('option', { name: 'Older selectable region', exact: true }),
    ).toHaveCount(0)
    await page.goto(`/replenishment/regional-stock/new?region=${olderId}`)
    await expect(page.getByRole('combobox', { name: 'Saved region', exact: true })).toHaveValue(
      olderId,
    )
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
