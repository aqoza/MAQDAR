import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { expectRepeatedDownloads } from './helpers/downloads'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test.use({ actionTimeout: 15_000 })

test('event handoffs preserve full adjusted exports, historical evidence and scoped access at five widths', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
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
  await createOrganization(page, { name: `Event handoff ${key}`, slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
  const { estimates, draft } = JSON.parse(seeded.stdout.trim()) as {
    estimates: string[]
    draft: string
  }

  const approve = async () => {
    const result = await runPython(`import sys,json,psycopg
from uuid import uuid4
def call(user,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.event_purchase_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${estimates[0]}',uuid4(),'=1+1'))
call('${approver}','select public.event_purchase_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Independent review'))
print(proposal)`)
    return result.stdout.trim()
  }
  const first = await approve()
  const savedEstimate = JSON.parse(
    (
      await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(json.dumps(db.execute('select report from public.event_purchase_cost_estimates where organization_id=%s and id=%s',(sys.argv[2],'${estimates[0]}')).fetchone()[0]))`)
    ).stdout.trim(),
  )
  await page.goto(`/replenishment/events/review/${first}`)
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/events\/handoffs\/[0-9a-f-]+$/)
  await expect(
    page.getByRole('heading', { name: 'Event purchase handoff · EVENT-PART', exact: true }),
  ).toBeVisible()
  const handoffUrl = page.url()
  const handoffId = handoffUrl.split('/').at(-1)!
  const jsonPath = `/api/event-purchase-handoffs/${handoffId}/json`
  const csvPath = `/api/event-purchase-handoffs/${handoffId}/csv`
  const jsonResponse = await page.request.get(jsonPath)
  expect(jsonResponse.status()).toBe(200)
  expect(jsonResponse.headers()['cache-control']).toBe('private, no-store')
  const originalJson = await jsonResponse.text()
  const payload = JSON.parse(originalJson)
  expect(payload.purpose).toBe('planning_only')
  expect(payload.selected_quantity_basis).toBe('full_event_adjusted')
  expect(payload.estimate.baseline.quantity).toBe('3')
  expect(payload.estimate.baseline.subtotal).toBe('3.70')
  expect(payload.estimate.cost_increase).toBe('1.85')
  expect(payload.proposal.id).toBe(first)
  expect(payload.proposal.reason).toBe('=1+1')
  expect(payload.estimate).toEqual(savedEstimate)
  expect(payload.estimate.adjusted.quantity).toBe('4.5')
  expect(payload.estimate.adjusted.subtotal).toBe('5.55')
  expect(payload.proposal.draft_id).toBe(draft)
  const originalCsv = await (await page.request.get(csvPath)).text()
  expect(originalCsv).toContain(`"'=1+1"`)
  expect(originalCsv).toContain('"5.55"')
  await expectRepeatedDownloads(page, `event-purchase-handoff-${handoffId}`, {
    json: originalJson,
    csv: originalCsv,
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-handoff-detail-${width}.png`),
      fullPage: true,
    })
  }
  const help = page.getByRole('button', { name: 'Method and assumptions', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Baseline quantities and differences')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()

  await page.goto(`/replenishment/events/review/${first}`)
  await expect(page.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Open saved event handoff', exact: true }).click()
  await expect(page).toHaveURL(handoffUrl)
  const second = await approve()
  await page.goto(`/replenishment/events/review/${second}`)
  // A change after rendering is rejected by the save RPC.
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(sys.argv[2],))`)
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'no longer matches' })).toBeVisible()
  await page.goto(handoffUrl)
  await expect(page.getByRole('status').filter({ hasText: 'Historical approval' })).toBeVisible()
  await expect(
    page.getByText('Current price evidence no longer matches', { exact: false }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonPath)).text()).toBe(originalJson)
  expect(await (await page.request.get(csvPath)).text()).toBe(originalCsv)
  await page.goto(
    '/replenishment/events/handoffs?q=Autumn&supplier=EVENT-SUP&location=EVENT-DC&selection=historical',
  )
  await expect(page.getByRole('link', { name: 'Inspect EVENT-PART', exact: true })).toHaveCount(1)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`event-handoff-list-${width}.png`),
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
      path: testInfo.outputPath(`event-handoff-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await page.goto('/replenishment/events/handoffs?selection=current')
  await expect(page.getByText('No handoffs match these filters.', { exact: false })).toBeVisible()
  await page.goto('/replenishment/events/handoffs?page=999&size=25')
  await expect(page).toHaveURL(/\/replenishment\/events\/handoffs$/)

  const readerContext = await browser.newContext()
  const reader = await readerContext.newPage()
  await signInWithPassword(reader, viewerEmail, password)
  await reader.goto(handoffUrl)
  await expect(reader.getByRole('link', { name: 'Download JSON', exact: true })).toBeVisible()
  expect(await (await reader.request.get(jsonPath)).text()).toBe(originalJson)
  await reader.goto(`/replenishment/events/review/${second}`)
  await expect(reader.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(sys.argv[2],'${viewer}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(404)
  await runPython(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${viewer}','${payload.estimate.location_id}'))`)
  expect((await reader.request.get(jsonPath)).status()).toBe(200)
  await readerContext.close()
  const anonymous = await browser.newContext()
  expect(
    (
      await anonymous.request.get(new URL(jsonPath, handoffUrl).href, {
        headers: { accept: 'application/json' },
      })
    ).status(),
  ).toBe(401)
  await anonymous.close()
  const invariants = await runPython(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    print(json.dumps([db.execute('select count(*) from public.'+table+' where organization_id=%s',(sys.argv[2],)).fetchone()[0] for table in ['event_purchase_handoffs','stock_snapshots','open_orders','receipts']]))`)
  expect(JSON.parse(invariants.stdout.trim())).toEqual([1, 1, 2, 0])
  // Synthetic approved history exercises pagination without 27 UI approval cycles.
  await runPython(`import sys,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    original=db.execute('select payload from public.event_purchase_handoffs where id=%s',('${handoffId}',)).fetchone()[0]
    for revision in range(100,127):
        proposal,handoff=uuid4(),uuid4()
        db.execute("insert into public.event_purchase_proposals(id,organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason,status,decided_by,decided_at,decision_reason,decision_request_id) select %s,organization_id,estimate_id,draft_id,location_id,%s,%s,submitted_by,reason,'approved',decided_by,decided_at,decision_reason,%s from public.event_purchase_proposals where id=%s",(proposal,revision,uuid4(),uuid4(),'${first}'))
        payload=dict(original,handoff_id=str(handoff),proposal=dict(original['proposal'],id=str(proposal),revision=revision))
        db.execute('insert into public.event_purchase_handoffs(id,organization_id,proposal_id,location_id,created_by,payload) values(%s,%s,%s,%s,%s,%s)',(handoff,sys.argv[2],proposal,original['estimate']['location_id'],sys.argv[3],Jsonb(payload)))`)
  await page.goto('/replenishment/events/handoffs?page=2')
  await expect(page.getByRole('link', { name: 'Inspect EVENT-PART', exact: true })).toHaveCount(3)
  await page.getByRole('link', { name: 'Previous', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Inspect EVENT-PART', exact: true })).toHaveCount(25)
  expect(errors).toEqual([])
  await testInfo.attach('handoff-json', { body: originalJson, contentType: 'application/json' })
})
