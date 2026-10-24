import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('independent return review preserves final decisions, evidence and scoped history', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Review-${key}`
  const email = `return-review-owner-${key}@example.com`,
    reviewerEmail = `return-review-${key}@example.com`,
    branchEmail = `return-read-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const reviewer = await createConfirmedUser(reviewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `review-returns-${key}`
  await createOrganization(page, { name: 'Return review', slug, arabicEnabled: true })
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
  const reviewerContext = await browser.newContext(),
    review = await reviewerContext.newPage()
  const branchContext = await browser.newContext(),
    scoped = await branchContext.newPage()
  reviewerContext.setDefaultTimeout(15_000)
  branchContext.setDefaultTimeout(15_000)
  const errors: string[] = []
  for (const p of [page, review, scoped]) p.on('pageerror', (error) => errors.push(error.message))
  const base = '/replenishment/returns'
  const locale = async (value: string) => {
    await review
      .context()
      .addCookies([{ name: 'locale', value, url: new URL(review.url()).origin }])
    await review.reload()
  }
  const visual = async (kind: string, lang: string) => {
    await expect(review.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await review.setViewportSize({ width, height: 1000 })
      expect(
        await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(review.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      if (await review.locator('.text-evidence-value').count()) {
        await expect(review.locator('.text-evidence-value').first()).toHaveCSS('font-size', '14px')
      }
      await review.screenshot({
        path: testInfo.outputPath(`dealer-returns-review-${kind}-${lang}-${width}.png`),
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
 db.execute("insert into public.locations(organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,'RR-B','Branch','الفرع','branch','SA','Asia/Riyadh'),(%s,'RR-H','Hub','المركز','hub','SA','Asia/Riyadh')",(org,org))
 db.execute("insert into public.items(organization_id,code,name_en,name_ar,product_group,unit_of_measure,unit_cost,currency) values(%s,'RR-P','Service part','قطعة خدمة','Test','EA',1,'SAR')",(org,))
 for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
  db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
  db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RR-B'",(sys.argv[5],org))
 db.execute('set local role authenticated')
 db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
 data=dict(item_code='RR-P',source_code='RR-B',location_code='RR-H',quantity='2.125',unit='EA',requested_date='2026-10-24',condition='unknown',reason='Declared return for review',confirmed=True)
 ids=[str(db.execute('select public.dealer_return_save(%s,%s,%s)',(org,Jsonb(data),uuid4())).fetchone()[0]) for _ in range(2)]
 print(json.dumps(ids))`)
    const [first, second] = JSON.parse(fixture.stdout) as string[]
    await page.goto(`${base}/${first}`)
    await expect(page.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Withdraw request', exact: true })).toBeVisible()
    await signInWithPassword(review, reviewerEmail, password)
    await review.goto(`${base}/${first}`)
    await expect(review.getByRole('button', { name: 'Withdraw request', exact: true })).toHaveCount(
      0,
    )
    await review.getByLabel('Decision', { exact: true }).selectOption('approved')
    await review.getByLabel('Eligibility rationale', { exact: true }).fill(' ')
    await review.getByRole('checkbox').check()
    await review.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(review.locator('#decision-reason-error')).toBeVisible()
    await review
      .getByLabel('Eligibility rationale', { exact: true })
      .fill('Invoice eligibility checked by reviewer')
    await expect(review.locator('#decision-reason-error')).toHaveCount(0)
    await review.getByRole('checkbox').check()
    await visual('form', 'en')
    await locale('ar')
    await review.locator('[name="decision"]').selectOption('approved')
    await review.locator('[name="reason"]').fill('Invoice eligibility checked by reviewer')
    await review.getByRole('checkbox').check()
    await visual('form', 'ar')
    await locale('en')
    await review.getByLabel('Decision', { exact: true }).selectOption('approved')
    await review
      .getByLabel('Eligibility rationale', { exact: true })
      .fill('Invoice eligibility checked by reviewer')
    await review.getByRole('checkbox').check()
    await review.getByRole('button', { name: 'Record decision', exact: true }).focus()
    await review.keyboard.press('Enter')
    await expect(review.getByTestId('return-decision')).toContainText('Approved')
    await expect(review.getByTestId('return-decision')).toContainText(reviewerEmail)
    await expect(review.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(
      0,
    )
    await expect(review.getByText('2.125 EA', { exact: true })).toBeVisible()
    await visual('approved', 'en')
    await locale('ar')
    await visual('approved', 'ar')
    await locale('en')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Withdraw request', exact: true })).toHaveCount(0)
    await review.goto(`${base}?status=requested`)
    await expect(review.getByRole('row')).toHaveCount(2)
    await review.goto(`${base}?status=approved&q=invoice%20eligibility`)
    await expect(review.getByRole('row')).toHaveCount(2)
    await review.getByText('Eligibility rationale', { exact: true }).click()
    await expect(review.locator('td details[open]')).toContainText(
      'Invoice eligibility checked by reviewer',
    )
    await visual('history', 'en')
    await locale('ar')
    await visual('history', 'ar')
    await locale('en')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db: db.execute("update public.items set unit_of_measure='SET' where organization_id=%s",(sys.argv[2],))`)
    await review.goto(`${base}/${second}`)
    await review.getByLabel('Decision', { exact: true }).selectOption('approved')
    await review
      .getByLabel('Eligibility rationale', { exact: true })
      .fill('Catalog must still match')
    await review.getByRole('checkbox').check()
    await review.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(review.getByRole('main').getByRole('alert')).toBeVisible()
    await expect(review.getByLabel('Eligibility rationale', { exact: true })).toHaveValue(
      'Catalog must still match',
    )
    await review.getByLabel('Decision', { exact: true }).selectOption('rejected')
    await review
      .getByLabel('Eligibility rationale', { exact: true })
      .fill('Catalog evidence changed')
    await review.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(review.getByTestId('return-decision')).toContainText('Rejected')
    await signInWithPassword(scoped, branchEmail, password)
    expect((await scoped.goto(`${base}/${first}`))?.status()).toBe(404)
    await scoped.goto(`${base}?status=approved`)
    await expect(scoped.getByText('No requests match these filters.')).toBeVisible()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RR-H'",(sys.argv[5],sys.argv[2]))
 db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))
 assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0
 assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==0`)
    expect((await scoped.goto(`${base}/${first}`))?.status()).toBe(200)
    await expect(scoped.getByTestId('return-decision')).toContainText(
      'Invoice eligibility checked by reviewer',
    )
    await expect(scoped.getByText('2.125 EA', { exact: true })).toBeVisible()
    await expect(scoped.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(
      0,
    )
    expect(errors).toEqual([])
  } finally {
    await Promise.allSettled([reviewerContext.close(), branchContext.close()])
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
 db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
 db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
