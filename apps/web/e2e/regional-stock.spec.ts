import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional stock preserves exact evidence and all-location access at every responsive width', async ({
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
  const slug = `regional-stock-${key}`
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
      const evidence = page.locator('section[aria-label] dd').first()
      if (await evidence.count()) await expect(evidence).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath(`regional-stock-${kind}-${locale}-${width}.png`),
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
    const path = '/replenishment/regional-stock',
      createUrl = `${path}/new`
    const fill = async (ar = false) => {
      await page
        .getByLabel(ar ? 'اسم التقييم' : 'Assessment name', { exact: true })
        .fill(ar ? 'المخزون الإقليمي' : 'Captured regional stock')
      await page.getByLabel(ar ? 'رمز الصنف' : 'Item code', { exact: true }).fill('REG-P')
      await page.getByLabel(ar ? 'تاريخ التقييم' : 'As-of date', { exact: true }).fill('2026-01-15')
      for (const code of ['REG-B', 'REG-A']) {
        await page.getByLabel(ar ? 'رمز الموقع' : 'Location code', { exact: true }).fill(code)
        await page
          .getByRole('button', { name: ar ? 'إضافة موقع' : 'Add location', exact: true })
          .click()
      }
      await page.getByRole('checkbox').check()
      await page
        .getByRole('button', { name: ar ? 'معاينة التقييم' : 'Preview assessment', exact: true })
        .click()
    }
    await page.goto(createUrl)
    await expect(
      page.getByRole('button', { name: 'Preview assessment', exact: true }),
    ).toBeDisabled()
    await fill()
    const summary = page.getByRole('region', { name: 'Observed regional stock', exact: true }),
      ledger = page.getByRole('region', { name: 'Per-location stock evidence', exact: true })
    await expect(summary).toContainText('-0.2')
    await expect(ledger.getByRole('row')).toHaveCount(3)
    await expect(page.getByRole('checkbox')).toBeChecked()
    await page.getByRole('checkbox').uncheck()
    await expect(ledger).toHaveCount(0)
    await page.getByRole('checkbox').check()
    const preview = page.getByRole('button', { name: 'Preview assessment', exact: true })
    await preview.click()
    await page.getByLabel('Assessment name', { exact: true }).fill('Changed name')
    await expect(ledger).toHaveCount(0)
    await page.getByLabel('Assessment name', { exact: true }).fill('Captured regional stock')
    await preview.click()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set unit_of_measure=null where organization_id=%s',(sys.argv[2],))`)
    await preview.click()
    await expect(summary).toContainText('Regional totals unavailable')
    await expect(page.getByRole('button', { name: 'Save assessment', exact: true })).toHaveCount(0)
    await expect(ledger.getByText('Supplied unit unknown', { exact: true })).toHaveCount(2)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set unit_of_measure='EA' where organization_id=%s",(sys.argv[2],))`)
    await preview.click()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set quantity=0.15 where organization_id=%s',(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Evidence changed')
    await preview.click()
    await expect(summary).toContainText('-0.1')
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('checkbox')).toBeChecked()
    await visual('form', 'en')
    await page.getByRole('button', { name: 'Save assessment', exact: true }).click()
    await expect(page).toHaveURL(/regional-stock\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await visual('detail', 'en')
    await page.setViewportSize({ width: 375, height: 1000 })
    await ledger.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => ledger.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(0)
    await locale('ar')
    await expect(
      page
        .getByRole('region', { name: 'أدلة المخزون لكل موقع', exact: true })
        .getByText('المستودع', { exact: true }),
    ).toBeVisible()
    await visual('detail', 'ar')
    await page.goto(createUrl)
    await fill(true)
    await expect(
      page.getByRole('region', { name: 'المخزون الإقليمي المرصود', exact: true }),
    ).toContainText('-0.1')
    await visual('form', 'ar')
    await page.goto(path)
    await visual('history', 'ar')
    await locale('en')
    await visual('history', 'en')
    await page.getByLabel('Assessment name', { exact: true }).fill('no-match')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('No saved assessments')
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
        if (!allowed) expect(await response!.text()).not.toContain('Captured regional stock')
        expect((await scoped.goto(createUrl))?.status()).toBe(404)
        await scoped.goto(`${path}?location=REG-A`)
        await expect(
          scoped.getByRole('link', { name: 'Captured regional stock', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
        if (!allowed) {
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='REG-B'",(sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(200)
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s',(sys.argv[2],sys.argv[5]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(404)
        }
      } finally {
        await context.close()
      }
    }
    await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    for n in range(26):
        payload=dict(assessment_name=f'History {n:02d}',item_code='REG-P',location_codes=['REG-A','REG-B'],unit='EA',as_of='2026-01-15',confirmed=True)
        report=db.execute('select public.regional_stock_preview(%s,%s)',(sys.argv[2],Jsonb(payload))).fetchone()[0]
        db.execute('select public.regional_stock_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(payload),uuid4(),report['fingerprint']))`)
    await page.goto(path)
    const history = page.getByRole('region', { name: 'Regional stock assessments', exact: true })
    await expect(history.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(history.getByRole('row')).toHaveCount(3)
    await page.goto(`${path}?q=%25`)
    await expect(page.getByRole('status')).toContainText('No saved assessments')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.stock_snapshots where organization_id=%s',(sys.argv[2],))
    db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))`)
    await page.goto(savedUrl)
    await expect(summary).toContainText('-0.1')
    await expect(ledger.getByRole('row')).toHaveCount(3)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:6],))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
