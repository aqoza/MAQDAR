import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signedInClient,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test.use({ actionTimeout: 30_000 })
test('disposition handoffs preserve original downloads, selected history and location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID()
  const password = `Handoff-${key}`
  const email = `disposition-handoff-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const reviewerEmail = `disposition-handoff-review-${key}@example.com`
  const reviewer = await createConfirmedUser(reviewerEmail, password)
  const branchEmail = `disposition-handoff-branch-${key}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `disposition-handoff-${key}`
  await createOrganization(page, { name: 'Disposition handoffs', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seed = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/excess-stock.py'),
      dsn,
      org,
      owner,
      reviewer,
      branch,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const fixture = JSON.parse(seed.stdout) as {
    location: string
    lines: { item: string; policy: string }[]
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='approver' where organization_id=%s and user_id=%s",(sys.argv[2],'${reviewer}'))`)
  const editorClient = await signedInClient(email, password)
  const reviewerClient = await signedInClient(reviewerEmail, password)
  const choices = [{ policy_id: fixture.lines[0].policy, maximum: 'calculated' }]
  const preview = await editorClient.rpc('excess_stock_preview', {
    p_organization_id: org,
    p_selections: choices,
  })
  expect(preview.error).toBeNull()
  const assessment = await editorClient.rpc('excess_stock_save', {
    p_organization_id: org,
    p_selections: choices,
    p_reason: 'Handoff assessment',
    p_confirmed: true,
    p_request_id: randomUUID(),
    p_fingerprint: preview.data.fingerprint,
  })
  expect(assessment.error).toBeNull()
  const approve = async (quantity: string, reason: string) => {
    const proposal = await editorClient.rpc('excess_disposition_submit', {
      p_organization_id: org,
      p_assessment_id: assessment.data,
      p_item_id: fixture.lines[0].item,
      p_kind: 'supplier_return',
      p_quantity: quantity,
      p_request_id: randomUUID(),
      p_reason: reason,
    })
    expect(proposal.error).toBeNull()
    const decision = await reviewerClient.rpc('excess_disposition_decide', {
      p_organization_id: org,
      p_proposal_id: proposal.data,
      p_request_id: randomUUID(),
      p_decision: 'approved',
      p_reason: 'Independent handoff review',
    })
    expect(decision.error).toBeNull()
    return proposal.data as string
  }
  const proposal = await approve('3.333', 'Original return selection')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/replenishment/excess/review/${proposal}`)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(page.getByRole('button', { name: 'Save handoff', exact: true })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('handoff-create-1920.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page).toHaveURL(/\/excess\/handoffs\/[0-9a-f-]+$/)
  const handoffUrl = page.url()
  const handoffId = new URL(handoffUrl).pathname.split('/').at(-1)!
  await expect(page.getByText('3.749625 KWD', { exact: true })).toBeVisible()
  const jsonUrl = `/api/excess-disposition-handoffs/${handoffId}/json`
  const csvUrl = `/api/excess-disposition-handoffs/${handoffId}/csv`
  const json = await page.request.get(jsonUrl)
  const csv = await page.request.get(csvUrl)
  expect(json.status()).toBe(200)
  expect(csv.status()).toBe(200)
  expect(json.headers()['cache-control']).toBe('private, no-store')
  const originalJson = await json.body()
  const originalCsv = await csv.body()
  const payload = JSON.parse(originalJson.toString())
  expect(payload.disposition).toMatchObject({
    quantity: '3.333',
    reference_value: '3.749625',
    unit: 'EA',
    currency: 'KWD',
  })
  expect(payload.line.item_id).toBe(fixture.lines[0].item)
  expect(payload.selected).toBeUndefined()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download CSV', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe(`excess-disposition-handoff-${handoffId}.csv`)
  const help = page.getByRole('button', { name: 'About disposition handoffs', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('No supplier eligibility')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectPageTitle(page.getByRole('heading', { level: 1 }))
    await expectEvidenceValue(page.getByText('3.749625 KWD', { exact: true }).locator('..'))
    await page.screenshot({ path: testInfo.outputPath(`handoff-${width}.png`), fullPage: true })
  }
  const newer = await approve('4', 'Replacement selection')
  await page.goto(handoffUrl)
  await expect(page.getByRole('status').filter({ hasText: 'Historical approval' })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set unit_cost=1.126 where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[0].item}'))`)
  await page.goto(`/replenishment/excess/review/${newer}`)
  await page.getByRole('button', { name: 'Save handoff', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('as-of evidence changed')
  const retry = await editorClient.rpc('excess_disposition_handoff_create', {
    p_organization_id: org,
    p_proposal_id: proposal,
  })
  expect(retry.error).toBeNull()
  expect(retry.data).toBe(handoffId)
  expect(await (await page.request.get(jsonUrl)).body()).toEqual(originalJson)
  expect(await (await page.request.get(csvUrl)).body()).toEqual(originalCsv)
  await page.goto('/replenishment/excess/handoffs')
  await page.getByLabel('Search', { exact: true }).fill('Original return')
  await page
    .getByRole('combobox', { name: 'Planning selection', exact: true })
    .selectOption('historical')
  await page
    .getByRole('combobox', { name: 'Disposition intent', exact: true })
    .selectOption('supplier_return')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByText('1 handoff', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({
      path: testInfo.outputPath(`handoff-history-${width}.png`),
      fullPage: true,
    })
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(sys.argv[2],'${reviewer}'))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, reviewerEmail, password)
  await viewerPage.goto(handoffUrl)
  await expect(viewerPage.getByText('3.749625 KWD', { exact: true })).toBeVisible()
  expect(await (await viewerPage.request.get(jsonUrl)).body()).toEqual(originalJson)
  await viewerPage.goto(`/replenishment/excess/review/${newer}`)
  await expect(viewerPage.getByRole('button', { name: 'Save handoff', exact: true })).toHaveCount(0)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(handoffUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible()
  expect((await branchPage.request.get(jsonUrl)).status()).toBe(404)
  expect((await branchPage.request.get(csvUrl)).status()).toBe(404)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.getByText('3.749625 KWD', { exact: true })).toBeVisible()
  expect(await (await branchPage.request.get(csvUrl)).body()).toEqual(originalCsv)
  await branchContext.close()
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(handoffUrl)
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: testInfo.outputPath(`handoff-ar-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
