import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional proposals retain independent decisions, archive-safe actions and all-member access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = `Sourcing-${key}`,
    email = `regional-review-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `regional-review-viewer-${key}@example.com`,
    branchEmail = `regional-review-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `regional-review-${key}`
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
  const root = `${sourcingRoot}/review`
  async function visual(kind: string, lang: string, screen = page) {
    await expect(screen.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await screen.setViewportSize({ width, height: 1000 })
      expect(
        await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(screen.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const value = screen.locator('.text-evidence-value').first()
      if (await value.count()) await expect(value).toHaveCSS('font-size', '14px')
      await screen.screenshot({
        path: testInfo.outputPath(`regional-review-${kind}-${lang}-${width}.png`),
        fullPage: true,
      })
    }
  }
  async function locale(value: string) {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  const reviewerContext = await browser.newContext()
  const reviewPage = await reviewerContext.newPage()
  reviewPage.setDefaultTimeout(15_000)
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'tests')
from regional_freight_fixture import seed_regional_freight
with psycopg.connect(sys.argv[1]) as db:
    parent,report=seed_regional_freight(db,sys.argv[2],sys.argv[3],policy_lead=10,source_a_quantity='22')
    db.execute('set local role authenticated')
    estimate=db.execute('select public.regional_freight_save(%s,%s,true,%s,%s)',(sys.argv[2],parent,uuid4(),report['fingerprint'])).fetchone()[0]
    db.execute('reset role')
    for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code<>'SOURCE-A'",(sys.argv[5],sys.argv[2]))
    print(json.dumps(dict(estimate=str(estimate),region=report['source']['source']['region']['id'])))`)
    const { estimate, region } = JSON.parse(seeded.stdout.trim()) as {
      estimate: string
      region: string
    }
    const estimateUrl = `${sourcingRoot}/freight/${estimate}`
    async function submit(reason: string) {
      await page.goto(estimateUrl)
      const form = page.getByRole('form', { name: 'Propose regional transfers', exact: true })
      await form.getByLabel('Proposal reason', { exact: true }).fill(reason)
      await form.getByRole('button', { name: 'Submit regional proposal', exact: true }).click()
      await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`))
      return page.url()
    }
    await page.goto(estimateUrl)
    await visual('submit', 'en')
    await locale('ar')
    await visual('submit', 'ar')
    await locale('en')
    const first = await submit('Approved regional planning selection')
    await expect(page.getByRole('form', { name: 'Independent review', exact: true })).toHaveCount(0)
    await expect(page.getByRole('form', { name: 'Withdraw proposal', exact: true })).toBeVisible()
    await visual('pending', 'en')
    await locale('ar')
    await visual('pending', 'ar')
    await locale('en')
    await signInWithPassword(reviewPage, viewerEmail, password)
    await reviewPage.goto(first)
    for (const lang of ['en', 'ar']) {
      await reviewerContext.addCookies([
        { name: 'locale', value: lang, url: new URL(first).origin },
      ])
      await reviewPage.reload()
      await visual('review', lang, reviewPage)
    }
    await reviewerContext.addCookies([{ name: 'locale', value: 'en', url: new URL(first).origin }])
    await reviewPage.reload()
    const decision = reviewPage.getByRole('form', { name: 'Independent review', exact: true })
    await decision
      .getByLabel('Decision reason', { exact: true })
      .fill('Complete estimate independently checked')
    await decision.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(reviewPage.getByText('Selected planning proposal', { exact: true })).toBeVisible()
    await page.reload()
    await visual('approved', 'en')
    await locale('ar')
    await visual('approved', 'ar')
    await locale('en')
    const second = await submit('Alternative for independent rejection')
    await reviewPage.goto(second)
    await decision.getByRole('combobox').selectOption('rejected')
    await decision
      .getByLabel('Decision reason', { exact: true })
      .fill('Keep earlier approved proposal')
    await decision.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(decision).toHaveCount(0)
    const third = await submit('Withdraw after archive')
    await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.stock_region_archive(%s,%s)',(sys.argv[2],'${region}'))`)
    expect((await page.goto(third))?.status()).toBe(200)
    await expect(page.getByText(/Approval unavailable: the region/)).toBeVisible()
    await reviewPage.goto(third)
    await expect(
      decision.getByRole('option', { name: 'Approve complete proposal', exact: true }),
    ).toBeDisabled()
    await expect(
      decision.getByRole('option', { name: 'Reject complete proposal', exact: true }),
    ).toBeEnabled()
    await visual('archived', 'en')
    await locale('ar')
    await visual('archived', 'ar')
    await locale('en')
    const withdrawal = page.getByRole('form', { name: 'Withdraw proposal', exact: true })
    await withdrawal
      .getByLabel('Decision reason', { exact: true })
      .fill('Region archived; retain original selection')
    await withdrawal.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
    await expect(withdrawal).toHaveCount(0)
    await page.goto(root)
    await visual('history', 'en')
    await page.getByRole('combobox').selectOption('approved')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(
      page.getByRole('link', { name: 'Inspect proposal for REG-P', exact: true }),
    ).toHaveCount(1)
    await page.getByLabel('Search item, region or location', { exact: true }).fill('no-match')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(page.getByText('No regional proposals match.', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await locale('ar')
    await visual('history', 'ar')
    await locale('en')
    await page.setViewportSize({ width: 375, height: 1000 })
    const table = page.getByRole('region', { name: 'Regional transfer review', exact: true })
    await table.focus()
    await expect(table).toBeFocused()
    await page.keyboard.press('ArrowRight')
    // A missing zero-allocation source still hides the whole proposal and its history.
    const scopedContext = await browser.newContext(),
      scoped = await scopedContext.newPage()
    try {
      await signInWithPassword(scoped, branchEmail, password)
      expect((await scoped.goto(first))?.status()).toBe(404)
      await scoped.goto(root)
      await expect(
        scoped.getByRole('link', { name: 'Inspect proposal for REG-P', exact: true }),
      ).toHaveCount(0)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='SOURCE-A'",(sys.argv[5],sys.argv[2]))`)
      expect((await scoped.goto(first))?.status()).toBe(200)
      await expect(scoped.getByRole('form')).toHaveCount(0)
    } finally {
      await scopedContext.close()
    }
    expect((await page.goto(`${root}/${randomUUID()}`))?.status()).toBe(404)
    expect((await page.goto(`${root}/invalid`))?.status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
    await reviewerContext.close()
  }
})
