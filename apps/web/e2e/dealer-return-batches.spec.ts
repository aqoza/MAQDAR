import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('return batches validate selections, retain copied files and enforce both-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = 'Batch-' + key,
    email = 'rb-' + key + '@example.com',
    reviewerEmail = 'rb-review-' + key + '@example.com',
    branchEmail = 'rb-branch-' + key + '@example.com'
  const owner = await createConfirmedUser(email, password),
    reviewer = await createConfirmedUser(reviewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = 'return-batches-' + key
  await createOrganization(page, { name: 'Return batches', slug, arabicEnabled: true })
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
  scoped.setDefaultTimeout(15_000)
  const errors: string[] = []
  for (const p of [page, scoped]) p.on('pageerror', (e) => errors.push(e.message))
  const base = '/replenishment/returns/batches'
  const selection = (ids: string[], path = '/preview') =>
    base + path + '?' + new URLSearchParams(ids.map((id) => ['handoff', id]))
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
      if (width === 375 && kind === 'selection') {
        const table = page.locator('.workspace-table[role="region"]').first()
        await table.evaluate((node) => {
          node.scrollLeft = 0
        })
        await table.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(table).toBeFocused()
        await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight')
        await expect
          .poll(() => table.evaluate((node) => Math.abs(node.scrollLeft)))
          .toBeGreaterThan(0)
        await table.evaluate((node) => {
          node.scrollLeft = 0
        })
        if (await page.locator('input[name="q"]').count())
          await expect(page.locator('input[name="q"]').first()).toHaveCSS('font-size', '16px')
      }
      await page.screenshot({
        path: testInfo.outputPath('return-batch-' + kind + '-' + lang + '-' + width + '.png'),
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
 db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,'RB-B','Branch','الفرع','branch','SA','Asia/Riyadh'),(%s,'RB-H','Hub','المركز','hub','SA','Asia/Riyadh')",(org,org))
 for code in ['RB-1','RB-SECOND','RB-3']: db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'Service part','Test','EA',1,'SAR')",(org,code))
 for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
  db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
  db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RB-B'",(sys.argv[5],org))
 ids=[]
 for code,day,qty in [('RB-1','2026-11-01','999999999999999.999'),('RB-SECOND','2026-11-01','0.001'),('RB-1','2026-11-01','1'),('RB-3','2026-11-02','3')]:
  db.execute('set local role authenticated')
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
  data=dict(item_code=code,source_code='RB-B',location_code='RB-H',quantity=qty,unit='EA',requested_date=day,condition='unknown',reason='Declared return',sale_reference='INV-BATCH',confirmed=True)
  request=db.execute('select public.dealer_return_save(%s,%s,%s)',(org,Jsonb(data),uuid4())).fetchone()[0]
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],role='authenticated')),))
  db.execute("select public.dealer_return_review(%s,%s,'approved','Invoice eligibility checked',true)",(org,request))
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
  ids.append(str(db.execute('select public.dealer_return_handoff_create(%s,%s)',(org,request)).fetchone()[0]))
 print(json.dumps(ids))`)
    const [first, second, duplicate, wrongDate] = JSON.parse(fixture.stdout) as string[]
    await page.goto(selection([first, duplicate]))
    await expect(page.getByRole('main').getByRole('alert')).toContainText('only once')
    await expect(page.getByRole('button', { name: 'Save batch', exact: true })).toHaveCount(0)
    await page.goto(selection([first, wrongDate]))
    await expect(page.getByRole('main').getByRole('alert')).toContainText('same source branch')
    await page.goto(base + '/new')
    await page.getByLabel('Search saved evidence', { exact: true }).fill('RB-SECOND')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
    await page.getByRole('checkbox', { name: 'Select RB-SECOND', exact: true }).focus()
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: 'Add selected handoffs', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1 of 50 handoffs selected' })).toBeVisible()
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1 of 50 handoffs selected' })).toBeVisible()
    await page.locator('input[type=checkbox][value="' + first + '"]').check()
    await page.getByRole('button', { name: 'Add selected handoffs', exact: true }).click()
    await visual('selection', 'en')
    await locale('ar')
    await visual('selection', 'ar')
    await locale('en')
    await page.getByRole('link', { name: 'Preview batch', exact: true }).click()
    await expect(page.getByText('999999999999999.999 EA', { exact: true })).toBeVisible()
    await visual('preview', 'en')
    await locale('ar')
    await visual('preview', 'ar')
    await locale('en')
    // A catalog edit after preview must not save stale evidence.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db: db.execute("update public.items set unit_of_measure='SET' where organization_id=%s and code='RB-SECOND'",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save batch', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toBeFocused()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('has changed')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db: db.execute("update public.items set unit_of_measure='EA' where organization_id=%s and code='RB-SECOND'",(sys.argv[2],))`)
    await page.reload()
    await page.getByRole('button', { name: 'Save batch', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/returns\/batches\/[0-9a-f-]+$/)
    const savedUrl = page.url(),
      id = savedUrl.split('/').at(-1)!,
      download = '/api/dealer-return-batches/' + id
    const json = await page.request.get(download + '/json'),
      csv = await page.request.get(download + '/csv')
    expect(json.status()).toBe(200)
    expect(csv.status()).toBe(200)
    const originalJson = await json.body(),
      originalCsv = await csv.body()
    expect(JSON.parse(originalJson.toString()).lines).toHaveLength(2)
    await visual('saved', 'en')
    await locale('ar')
    await visual('saved', 'ar')
    await locale('en')
    await page.goto(selection([second, first]))
    await expect(page.getByRole('button', { name: 'Save batch', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Open saved batch', exact: true }).click()
    await expect(page).toHaveURL(savedUrl)
    await page.goto(selection([first]))
    await page.getByRole('button', { name: 'Save batch', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Overlapping batches' })).toBeVisible()
    await page.goto(base)
    await page.getByLabel('Search saved evidence', { exact: true }).fill('INV-BATCH')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(3)
    await visual('history', 'en')
    await locale('ar')
    await visual('history', 'ar')
    await locale('en')
    await signInWithPassword(scoped, branchEmail, password)
    expect((await scoped.goto(savedUrl))?.status()).toBe(404)
    expect((await scoped.request.get(download + '/json')).status()).toBe(404)
    await scoped.goto(base)
    await expect(scoped.getByText('No return authorization batches have been saved.')).toBeVisible()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RB-H'",(sys.argv[5],sys.argv[2]))
 db.execute('delete from public.dealer_return_requests where organization_id=%s',(sys.argv[2],))
 db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))
 db.execute('delete from auth.users where id=%s',(sys.argv[4],))
 assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0
 assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0`)
    expect((await scoped.goto(savedUrl))?.status()).toBe(200)
    await expect(scoped.getByText(/Some original handoffs are unavailable/)).toBeVisible()
    expect(await (await scoped.request.get(download + '/json')).body()).toEqual(originalJson)
    expect(await (await scoped.request.get(download + '/csv')).body()).toEqual(originalCsv)
    await page.goto(selection([first, second]))
    await expect(page.getByRole('main').getByRole('alert')).toContainText('unavailable')
    await page.goto(base + '?q=INV-BATCH')
    await expect(page.getByRole('row')).toHaveCount(3)
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
