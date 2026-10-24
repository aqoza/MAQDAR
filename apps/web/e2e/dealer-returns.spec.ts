import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('internal return declarations preserve evidence, withdrawal and both-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Return-${key}`,
    email = `return-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `return-viewer-${key}@example.com`,
    branchEmail = `return-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `returns-${key}`
  await createOrganization(page, { name: 'Declared returns', slug, arabicEnabled: true })
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
  page.on('pageerror', (e) => errors.push(e.message))
  const base = '/replenishment/returns'
  const locale = async (value: string) => {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  const visual = async (kind: string, lang: string) => {
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const evidence = page.locator('.text-evidence-value').first()
      if (await evidence.count()) await expect(evidence).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath(`dealer-returns-${kind}-${lang}-${width}.png`),
        fullPage: true,
      })
    }
  }
  try {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    org=sys.argv[2]
    db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,'RETURN-H','Return hub','مركز المرتجعات','hub','SA','Asia/Riyadh'),(%s,'RETURN-B','Branch','الفرع','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.items(organization_id,code,name_en,name_ar,product_group,unit_of_measure,unit_cost,currency) values(%s,'RETURN-P','Service part','قطعة خدمة','Test','EA',1,'SAR')",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RETURN-B'",(sys.argv[5],org))`)
    await page.goto(base)
    await expect(page.getByText('No return requests have been saved.')).toBeVisible()
    await page.getByRole('link', { name: 'New return request', exact: true }).click()
    const fill = async () => {
      await page.locator('[name="item_code"]').fill('RETURN-P')
      await page.locator('#source_code').fill('RETURN-B')
      await page.locator('#location_code').fill('RETURN-H')
      await page.locator('[name="quantity"]').fill('2.125')
      await page.locator('[name="unit"]').selectOption('EA')
      await page.locator('[name="requested_date"]').fill('2026-10-24')
      await page.locator('[name="reason"]').fill('Declared excess for inspection')
      await page.locator('[name="sale_reference"]').fill('INV-RETURN-1')
      await page.getByRole('checkbox').check()
    }
    await fill()
    // Invalid precision must retain input and show an associated field error.
    await page.locator('[name="quantity"]').fill('0.0001')
    await page.getByRole('button', { name: 'Save return request', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Check the highlighted')
    await expect(page.locator('[name="quantity"]')).toHaveValue('0.0001')
    await expect(page.locator('[name="quantity"]')).toHaveAttribute(
      'aria-describedby',
      'quantity-error',
    )
    await fill()
    await expect(page.locator('#quantity-error')).toHaveCount(0)
    await visual('form', 'en')
    await page.getByRole('button', { name: 'Save return request', exact: true }).click()
    await expect(page).toHaveURL(/returns\/[0-9a-f-]{36}$/)
    const detail = page.url()
    await expect(page.getByText('2.125 EA', { exact: true })).toBeVisible()
    await expect(page.getByText('Unknown', { exact: true })).toBeVisible()
    await visual('detail', 'en')
    await page.goto(base)
    await page
      .getByLabel('Search item, location, reason, reviewer or reference', { exact: true })
      .fill('INV-RETURN-1')
    await page
      .getByLabel('Search item, location, reason, reviewer or reference', { exact: true })
      .press('Enter')
    await expect(page.getByRole('row')).toHaveCount(2)
    await visual('history', 'en')
    await page.setViewportSize({ width: 375, height: 1000 })
    const scroll = page.getByRole('region', { name: 'Dealer returns', exact: true })
    await scroll.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => scroll.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(0)
    await locale('ar')
    await visual('history', 'ar')
    await page.goto(detail)
    await visual('detail', 'ar')
    await page.goto(`${base}/new`)
    await fill()
    await visual('form', 'ar')
    await locale('en')
    await page.goto(detail)
    await page.getByLabel('Withdrawal reason', { exact: true }).fill('Correct the declaration')
    await page.getByRole('button', { name: 'Withdraw request', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Withdraw request', exact: true })).toHaveCount(0)
    await expect(page.getByText('2.125 EA', { exact: true })).toBeVisible()
    await expect(page.getByText(/Correct the declaration/)).toBeVisible()
    await page.goto(`${base}?status=requested`)
    await expect(page.getByText('No requests match these filters.')).toBeVisible()
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'Withdrawn', exact: true })).toBeVisible()
    for (const [user, restricted] of [
      [viewerEmail, false],
      [branchEmail, true],
    ] as const) {
      const context = await browser.newContext()
      const scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, user, password)
        await scoped.goto(base)
        await expect(
          scoped.getByRole('link', { name: 'New return request', exact: true }),
        ).toHaveCount(0)
        expect((await scoped.goto(`${base}/new`))?.status()).toBe(404)
        expect((await scoped.goto(detail))?.status()).toBe(restricted ? 404 : 200)
        if (restricted) {
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RETURN-H'",(sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(detail))?.status()).toBe(200)
        }
        await expect(
          scoped.getByRole('button', { name: 'Withdraw request', exact: true }),
        ).toHaveCount(0)
      } finally {
        await context.close()
      }
    }
    // Saved labels and quantity remain available after catalog deletion; history is paginated.
    await python(`import sys,psycopg,json
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
    for n in range(26):
        data=dict(item_code='RETURN-P',source_code='RETURN-B',location_code='RETURN-H',quantity='1',unit='EA',requested_date='2026-10-24',condition='unused',reason=f'Independent request {n}',confirmed=True)
        db.execute('select public.dealer_return_save(%s,%s,%s)',(sys.argv[2],Jsonb(data),uuid4()))
    db.execute('reset role')
    db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))
    assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0
    assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0`)
    await page.goto(base)
    await expect(page.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await page.goto(detail)
    await expect(page.getByText('2.125 EA', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
