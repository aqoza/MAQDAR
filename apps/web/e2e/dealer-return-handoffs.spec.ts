import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('return handoffs preserve approved evidence, original downloads and both-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = 'Handoff-' + key
  const email = 'return-export-' + key + '@example.com',
    reviewerEmail = 'return-reviewer-' + key + '@example.com',
    branchEmail = 'return-scoped-' + key + '@example.com'
  const owner = await createConfirmedUser(email, password),
    reviewer = await createConfirmedUser(reviewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = 'return-handoffs-' + key
  await createOrganization(page, { name: 'Return handoffs', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, reviewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60_000,
    })
  const scopedContext = await browser.newContext(),
    scoped = await scopedContext.newPage()
  scopedContext.setDefaultTimeout(15_000)
  const errors: string[] = []
  for (const p of [page, scoped]) p.on('pageerror', (e) => errors.push(e.message))
  const base = '/replenishment/returns',
    history = base + '/handoffs'
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
      if (await page.locator('.text-evidence-value').count())
        await expect(page.locator('.text-evidence-value').first()).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath('return-handoff-' + kind + '-' + lang + '-' + width + '.png'),
        fullPage: true,
      })
    }
  }
  try {
    const fixture = await python(`import sys,psycopg,json
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
 org=sys.argv[2]
 db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,'RH-B','Branch','الفرع','branch','SA','Asia/Riyadh'),(%s,'RH-H','Hub','المركز','hub','SA','Asia/Riyadh')",(org,org))
 db.execute("insert into public.items(organization_id,code,name_en,name_ar,product_group,unit_of_measure,unit_cost,currency) values(%s,'RH-P','Service part','قطعة خدمة','Test','EA',1,'SAR')",(org,))
 for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
  db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
  db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RH-B'",(sys.argv[5],org))
 db.execute('set local role authenticated')
 db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
 data=dict(item_code='RH-P',source_code='RH-B',location_code='RH-H',quantity='999999999999999.999',unit='EA',requested_date='2026-11-01',condition='unknown',reason='Declared return',sale_reference='INV-HANDOFF',confirmed=True)
 ids=[str(db.execute('select public.dealer_return_save(%s,%s,%s)',(org,Jsonb(data),uuid4())).fetchone()[0]) for _ in range(2)]
 db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],role='authenticated')),))
 for id in ids: db.execute("select public.dealer_return_review(%s,%s,'approved','Invoice eligibility checked',true)",(org,id))
 print(json.dumps(ids))`)
    const [first, second] = JSON.parse(fixture.stdout) as string[]
    await page.goto(base + '/' + first)
    await expect(page.getByRole('button', { name: 'Save handoff', exact: true })).toBeVisible()
    await visual('create', 'en')
    await locale('ar')
    await visual('create', 'ar')
    await locale('en')
    await page.getByRole('button', { name: 'Save handoff', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/returns\/handoffs\/[0-9a-f-]+$/)
    const handoffUrl = page.url(),
      handoffId = handoffUrl.split('/').at(-1)!
    const download = '/api/dealer-return-handoffs/' + handoffId
    await expect(page.getByText('999999999999999.999 EA', { exact: true })).toBeVisible()
    await expect(
      page.getByText('The requested return date is not a scheduled receipt.', { exact: true }),
    ).toBeVisible()
    const json = await page.request.get(download + '/json'),
      csv = await page.request.get(download + '/csv')
    expect(json.status()).toBe(200)
    expect(csv.status()).toBe(200)
    const originalJson = await json.body(),
      originalCsv = await csv.body()
    expect(JSON.parse(originalJson.toString()).approval.reason).toBe('Invoice eligibility checked')
    await visual('saved', 'en')
    await locale('ar')
    await visual('saved', 'ar')
    await locale('en')
    await page.goto(base + '/' + first)
    await expect(page.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Open saved handoff', exact: true }).click()
    await expect(page).toHaveURL(handoffUrl)
    await page.goto(history)
    await page
      .getByLabel('Search item, locations, reference or rationale', { exact: true })
      .fill('INV-HANDOFF')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
    await visual('history', 'en')
    await locale('ar')
    await visual('history', 'ar')
    await locale('en')
    await page
      .getByLabel('Search item, locations, reference or rationale', { exact: true })
      .fill('unmatched')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText('No handoffs match this search.')).toBeVisible()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db: db.execute("update public.items set unit_of_measure='SET' where organization_id=%s",(sys.argv[2],))`)
    await page.goto(base + '/' + second)
    await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toBeFocused()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('create a new request')
    await expect(page).toHaveURL(base + '/' + second)
    await signInWithPassword(scoped, branchEmail, password)
    expect((await scoped.goto(handoffUrl))?.status()).toBe(404)
    expect((await scoped.request.get(download + '/json')).status()).toBe(404)
    await scoped.goto(history)
    await expect(
      scoped.getByText('No return handoffs yet. Open an approved request to save its handoff.'),
    ).toBeVisible()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RH-H'",(sys.argv[5],sys.argv[2]))
 db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))
 db.execute('delete from auth.users where id=%s',(sys.argv[4],))
 assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0
 assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0`)
    expect((await scoped.goto(handoffUrl))?.status()).toBe(200)
    expect(await (await scoped.request.get(download + '/json')).body()).toEqual(originalJson)
    expect(await (await scoped.request.get(download + '/csv')).body()).toEqual(originalCsv)
    await expect(scoped.getByText('999999999999999.999 EA', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await scopedContext.close()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
 db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
 db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
