import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })

test('event purchase review preserves selection, evidence gates and scoped history across five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const email = `draft-${key}@example.com`
  const password = `Draft-${key}`
  const user = await createConfirmedUser(email, password)
  const approverEmail = `purchase-reviewer-${key}@example.com`
  const viewerEmail = `purchase-viewer-${key}@example.com`
  const approver = await createConfirmedUser(approverEmail, password)
  const viewer = await createConfirmedUser(viewerEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `draft-${key}`
  await createOrganization(page, { name: `Event review ${key}`, slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const runPython = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for user,role in [('${approver}','approver'),('${viewer}','viewer')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))`)
  const seeded = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/event-purchase-review.py'),
      dsn,
      org,
      user,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const { estimates, draft, other_location } = JSON.parse(seeded.stdout.trim()) as {
    estimates: string[]
    draft: string
    other_location: string
  }
  const branchEmail = `event-branch-${key}@example.com`,
    branch = await createConfirmedUser(branchEmail, password)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(sys.argv[2],'${branch}'))
    db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',('${branch}',sys.argv[2]))
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${other_location}'))`)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const submit = async (estimate: string, reason: string) => {
    await page.goto(`/replenishment/events/costs/${estimate}`)
    const form = page.getByRole('form', { name: 'Propose event-adjusted purchase', exact: true })
    await form.getByLabel('Proposal reason', { exact: true }).fill(reason)
    await form.getByRole('button', { name: 'Submit proposal', exact: true }).click()
  }
  await submit(estimates[0], 'Demand and supplier evidence reviewed')
  await expect(
    page.getByRole('heading', { name: 'Proposal 1 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/events\/review\/[0-9a-f-]+$/)
  const firstUrl = page.url()
  const comparison = page.getByRole('table', {
    name: 'Event purchase-cost comparison',
    exact: true,
  })
  await expect(comparison).toContainText('3.70')
  await expect(comparison).toContainText('5.55')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-review-detail-${width}.png`),
      fullPage: true,
    })
  }
  const help = page.getByRole('button', { name: 'Method and assumptions', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('One pending proposal')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()

  await expect(page.getByRole('form', { name: 'Review proposal', exact: true })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Withdraw proposal', exact: true })).toBeVisible()
  // The pending guard spans alternate delivery/price estimates of the same draft.
  await submit(estimates[1], 'Alternative delivery')
  await expect(
    page.getByRole('alert').filter({ hasText: 'already has a pending proposal' }),
  ).toBeVisible()
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  await signInWithPassword(reviewer, approverEmail, password)
  const decide = async (decision: 'approved' | 'rejected', reason: string) => {
    const form = reviewer.getByRole('form', { name: 'Review proposal', exact: true })
    await expect(form).toBeVisible()
    await expect(
      form.getByRole('option', {
        name: decision === 'approved' ? 'Approve' : 'Reject',
        exact: true,
      }),
    ).toHaveJSProperty('disabled', false)
    await form.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision)
    await form.getByLabel('Decision reason', { exact: true }).fill(reason)
    await form.getByRole('button', { name: 'Record decision', exact: true }).click()
  }
  await reviewer.goto(firstUrl)
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 1 · Awaiting review', exact: true }),
  ).toBeVisible()
  await decide('approved', 'Independent review complete')
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 1 · Approved', exact: true }),
  ).toBeVisible()
  await expect(reviewer.getByText('Selected for this event draft', { exact: true })).toBeVisible()
  await reviewer.getByRole('link', { name: 'Open saved cost comparison', exact: true }).click()
  await expect(
    reviewer.getByRole('heading', { name: 'Saved event cost comparison', exact: true }),
  ).toBeVisible()
  await expect(
    reviewer.getByRole('form', { name: 'Propose event-adjusted purchase', exact: true }),
  ).toHaveCount(0)
  await submit(estimates[1], 'Later delivery for review')
  await expect(
    page.getByRole('heading', { name: 'Proposal 2 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/events\/review\/[0-9a-f-]+$/)
  await reviewer.goto(page.url())
  await expect(reviewer.getByRole('option', { name: 'Approve', exact: true })).toHaveJSProperty(
    'disabled',
    true,
  )
  await expect(
    reviewer.getByRole('alert').filter({ hasText: 'Approval requires saved evidence' }),
  ).toBeVisible()
  await expect(
    reviewer
      .getByRole('alert')
      .filter({ hasText: 'Approval is blocked by event demand before receipt' }),
  ).toBeVisible()
  await decide('rejected', 'Requires compatible timing')
  await expect(
    reviewer.getByRole('heading', { name: 'Proposal 2 · Rejected', exact: true }),
  ).toBeVisible()
  await submit(estimates[0], 'Check price freshness')
  await expect(
    page.getByRole('heading', { name: 'Proposal 3 · Awaiting review', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/events\/review\/[0-9a-f-]+$/)
  const staleUrl = page.url()
  // Load a currently valid approval form, then change evidence before submitting.
  await reviewer.goto(staleUrl)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(sys.argv[2],))`)
  await decide('approved', 'Attempt changed-price approval')
  await expect(
    reviewer.getByRole('alert').filter({ hasText: 'Price or supplier/receiver evidence changed' }),
  ).toBeVisible()
  await page.reload()
  const withdrawal = page.getByRole('form', { name: 'Withdraw proposal', exact: true })
  await withdrawal.getByLabel('Decision reason', { exact: true }).fill('Refresh price evidence')
  await withdrawal.getByRole('button', { name: 'Withdraw proposal', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Proposal 3 · Withdrawn', exact: true }),
  ).toBeVisible()
  await submit(estimates[0], 'Stale estimate must fail')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Price or supplier/receiver evidence changed' }),
  ).toBeVisible()
  const refreshed = await runPython(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('set local role authenticated')
    delivery=db.execute('select delivery_id from public.event_purchase_cost_estimates where id=%s',('${estimates[0]}',)).fetchone()[0]
    report=db.execute('select public.event_purchase_cost_preview(%s,%s,true)',(sys.argv[2],delivery)).fetchone()[0]
    print(db.execute('select public.event_purchase_cost_save(%s,%s,true,%s,%s)',(sys.argv[2],delivery,uuid4(),report['fingerprint'])).fetchone()[0])`)
  await submit(refreshed.stdout.trim(), 'Refreshed quote selection')
  await expect(
    page.getByRole('heading', { name: 'Proposal 4 · Awaiting review', exact: true }),
  ).toBeVisible()
  await reviewer.goto(page.url())
  await decide('approved', 'Current quote and timing checked')
  await expect(reviewer.getByText('Selected for this event draft', { exact: true })).toBeVisible()
  await page.goto(firstUrl)
  await expect(page.getByText('Historical approval', { exact: true })).toBeVisible()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(firstUrl)
  await expect(viewerPage.getByText('Historical approval', { exact: true })).toBeVisible()
  await expect(viewerPage.getByRole('form')).toHaveCount(0)
  await viewerPage.goto(`/replenishment/events/costs/${estimates[0]}`)
  await expect(viewerPage.getByRole('form')).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext(),
    branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(firstUrl)
  await expect(branchPage.getByText('404', { exact: true })).toBeVisible()
  await branchContext.close()
  await reviewer.screenshot({ path: testInfo.outputPath('purchase-review.png'), fullPage: true })
  await reviewerContext.close()
  await page.goto('/replenishment')
  await page.getByRole('link', { name: 'Event review', exact: true }).click()
  const table = page.getByRole('table', { name: 'Event purchase review', exact: true })
  await expect(table.getByRole('row')).toHaveCount(5)
  await page.getByLabel('Item or event name', { exact: true }).fill('Autumn')
  await page.getByLabel('Supplier code', { exact: true }).fill('EVENT-SUP')
  await page.getByLabel('Location code', { exact: true }).fill('EVENT-DC')
  await page
    .getByRole('combobox', { name: 'Proposal status', exact: true })
    .selectOption('approved')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table).toContainText('Selected for this event draft')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-review-list-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-review-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await page.reload()
  expect(errors).toEqual([])
  // Synthetic terminal history exercises server pagination, without touching source evidence.
  await runPython(`import sys,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    assert db.execute('select count(*) from public.open_orders where organization_id=%s',(sys.argv[2],)).fetchone()[0]==2
    assert db.execute('select count(*) from public.stock_snapshots where organization_id=%s',(sys.argv[2],)).fetchone()[0]==1
    for revision in range(5,29):
        db.execute("insert into public.event_purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason,status,decided_by,decided_at,decision_reason,decision_request_id) select organization_id,estimate_id,draft_id,location_id,%s,%s,submitted_by,'Pagination fixture','withdrawn',submitted_by,now(),'Pagination fixture',%s from public.event_purchase_proposals where organization_id=%s and revision=1",(revision,uuid4(),uuid4(),sys.argv[2]))`)
  await page.goto(`/replenishment/events/review?draft=${draft}`)
  await expect(table.getByRole('row')).toHaveCount(26)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(4)
})
