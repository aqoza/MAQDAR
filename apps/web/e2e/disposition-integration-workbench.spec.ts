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
import { expectPageTitle } from './helpers/typography'
import { generateApiKey } from '../src/lib/api/keys'

test.use({ actionTimeout: 30_000 })
test('disposition workbench separates reports and live context, retaining copied packages after source deletion', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const nonce = randomUUID()
  const password = `Handoff-${nonce}`
  const email = `disposition-handoff-${nonce}@example.com`
  const owner = await createConfirmedUser(email, password)
  const reviewerEmail = `disposition-handoff-review-${nonce}@example.com`
  const reviewer = await createConfirmedUser(reviewerEmail, password)
  const branchEmail = `disposition-handoff-branch-${nonce}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `disposition-handoff-${nonce}`
  await createOrganization(page, { name: 'Disposition handoffs', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_snapshots set currency='KWD',unit_of_measure='EA' where organization_id=%s",(sys.argv[2],))`)
  const choices = fixture.lines.map((line) => ({ policy_id: line.policy, maximum: 'calculated' }))
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
  const approve = async (quantity: string, reason: string, index = 0) => {
    const proposal = await editorClient.rpc('excess_disposition_submit', {
      p_organization_id: org,
      p_assessment_id: assessment.data,
      p_item_id: fixture.lines[index].item,
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

  const ids: string[] = []
  for (let index = 0; index < 3; index++) {
    const proposal = await approve('3.333', `Batch line ${index + 1}`, index)
    const handoff = await editorClient.rpc('excess_disposition_handoff_create', {
      p_organization_id: org,
      p_proposal_id: proposal,
    })
    expect(handoff.error).toBeNull()
    ids.push(handoff.data as string)
  }
  const savedBatch = await editorClient.rpc('excess_disposition_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: ids.slice(0, 2),
  })
  expect(savedBatch.error).toBeNull()
  const batch = savedBatch.data as string
  const originalBatch = await (
    await page.request.get(`/api/excess-disposition-batches/${batch}/json`)
  ).json()
  const original = await (
    await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/json`)
  ).json()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const overlapResult = await editorClient.rpc('excess_disposition_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: [ids[0], ids[2]],
  })
  expect(overlapResult.error).toBeNull()
  const overlap = overlapResult.data as string
  expect(overlap).not.toBe(batch)
  const originalCsv = await (
    await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/csv`)
  ).text()
  const originalBatchCsv = await (
    await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)
  ).text()
  const key = await generateApiKey()
  expect(
    (
      await editorClient.rpc('create_api_key', {
        p_organization_id: org,
        p_name: 'Reports',
        p_scopes: ['excess_disposition_handoffs:acknowledge'],
        p_expires_in_days: 30,
        p_key_hash: key.hash,
        p_display_prefix: key.displayPrefix,
        p_last4: key.last4,
      })
    ).error,
  ).toBeNull()
  const report = async (
    system: string,
    reference: string,
    status = 'received',
    reason: string | null = null,
    packageId = ids[0],
  ) => {
    const response = await request.post(
      `/api/v1/${packageId === batch ? 'excess-disposition-handoff-batches' : 'excess-disposition-handoffs'}/${packageId}/acknowledgements`,
      {
        headers: { Authorization: `Bearer ${key.token}` },
        data: {
          client_event_id: randomUUID(),
          external_system: system,
          external_reference: reference,
          status,
          reason,
        },
      },
    )
    expect(response.status(), await response.text()).toBe(201)
  }
  await report('ERP', 'old-reference', 'rejected', 'Superseded rejection')
  await report('ERP', 'current-reference')
  await report('erp', 'case-reference', 'rejected', 'Case-sensitive rejection')
  await report(' ERP ', 'space-reference', 'rejected', 'Unknown item <script>alert(1)</script>')
  await report('ERP', 'batch-' + 'X'.repeat(194), 'rejected', 'Batch mapping missing', batch)

  await page.goto('/replenishment/excess')
  await page.getByRole('link', { name: 'Disposition integrations', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Disposition integration workbench', exact: true }),
  ).toBeVisible()
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(7)
  await expect(rows.filter({ hasText: 'old-reference' })).toHaveCount(0)
  await expect(rows.filter({ hasText: 'current-reference' })).toContainText('Reported received')
  await expect(rows.filter({ hasText: 'case-reference' })).toContainText('Reported rejected')
  await expect(rows.filter({ hasText: 'space-reference' })).toContainText(
    'Unknown item <script>alert(1)</script>',
  )
  expect(await page.locator('tbody script').count()).toBe(0)
  await expect(rows.filter({ hasText: 'No report' })).toHaveCount(3)
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('rejected')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Exact system label').fill('ERP')
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('no_report')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'No report' })).toHaveCount(3)
  await page.getByLabel('Exact system label').fill(' ERP ')
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('rejected')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByLabel('Exact system label')).toHaveValue(' ERP ')
  await rows.getByText('Event details', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(rows.getByText('Reporting API key')).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const tableRegion = page.getByRole('region', { name: 'Disposition integration workbench' })
    await tableRegion.focus()
    await expect(tableRegion).toBeFocused()
    await expectPageTitle(page.getByRole('heading', { level: 1 }))
    await expect(page.getByLabel('Exact system label')).toHaveCSS(
      'font-size',
      width < 768 ? '16px' : '14px',
    )
    if (width === 375) {
      expect(
        (await rows.getByText('Event details', { exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44)
      expect(
        (await rows.getByRole('link', { name: 'Open evidence and history' }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44)
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => tableRegion.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
    }
    await tableRegion.evaluate((node) => node.scrollTo({ left: 0 }))
    await page.screenshot({
      path: testInfo.outputPath(`disposition-integration-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByRole('button', { name: 'How to read these results' }).click()
  await expect(page.getByRole('dialog')).toContainText('reference inventory values')
  await page.keyboard.press('Escape')
  await rows.getByRole('link', { name: 'Open evidence and history' }).click()
  await expect(page).toHaveURL(new RegExp(`/handoffs/${ids[0]}#acknowledgements$`))
  await expect(page.getByRole('region', { name: 'Integration acknowledgements' })).toContainText(
    'Superseded rejection',
  )
  for (let index = 0; index < 30; index++) await report(`System-${index}`, `reference-${index}`)
  await page.goto('/replenishment/excess/integrations')
  await expect(page.getByText('37 package/system results', { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(25)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(rows).toHaveCount(12)
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await page.goto('/replenishment/excess/integrations?page=100000')
  await expect(page).toHaveURL(/integrations\?page=2$/)
  await page.goto('/replenishment/excess/integrations?q=old-reference')
  await expect(rows).toHaveCount(0)
  await page.goto('/replenishment/excess/integrations?system=ERP&q=current-reference')
  await expect(rows).toHaveCount(1)
  await page
    .getByRole('combobox', { name: 'Disposition intent', exact: true })
    .selectOption('scrap')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(0)

  await approve('2.000', 'Replacement selection')
  await page.goto('/replenishment/excess/integrations?system=ERP&selection=historical')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'current-reference' })).toContainText('Historical')
  expect(
    await (await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/json`)).json(),
  ).toEqual(original)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/json`)).json(),
  ).toEqual(originalBatch)

  const viewerEmail = `disposition-workbench-viewer-${nonce}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'viewer')",(sys.argv[2],'${viewer}'))
    db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',('${viewer}',sys.argv[2]))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto('/replenishment/excess/integrations?system=ERP')
  await expect(viewerPage.locator('tbody tr')).toHaveCount(5)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto('/replenishment/excess/integrations?system=ERP')
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await expect(branchPage.getByText('0 package/system results', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(5)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=%s',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await branchContext.close()
  expect(
    await (await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/csv`)).text(),
  ).toBe(originalCsv)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)).text(),
  ).toBe(originalBatchCsv)
  await page.goto('/replenishment/excess/integrations?q=EXCESS&kind=handoff&system=ERP')
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Location code', { exact: true }).fill('Unknown receiver')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.goto('/replenishment/excess/integrations?system=ERP')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(rows).toHaveCount(5)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-integration-rtl-${width}.png`),
      fullPage: true,
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.excess_stock_assessments where organization_id=%s and id=%s',(sys.argv[2],'${assessment.data}'))`)
  await page.goto('/replenishment/excess/integrations?selection=unavailable&system=ERP')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Batch mapping missing' })).toContainText('Unavailable')
  await expect(rows.filter({ hasText: 'No report' })).toHaveCount(1)
  await page.getByLabel('Item, package or report reference', { exact: true }).fill('EXCESS-1')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(2)
  await rows
    .filter({ hasText: 'Batch mapping missing' })
    .getByRole('link', { name: 'Open evidence and history' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/batches/${batch}#acknowledgements$`))
  await expect(page.getByRole('region', { name: 'Integration acknowledgements' })).toContainText(
    'Batch mapping missing',
  )
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/json`)).json(),
  ).toEqual(originalBatch)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)).text(),
  ).toBe(originalBatchCsv)
  expect((await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/json`)).status()).toBe(
    404,
  )
  const denied = await browser.newContext()
  const deniedPage = await denied.newPage()
  await signInWithPassword(deniedPage, branchEmail, password)
  await deniedPage.goto('/replenishment/excess/integrations?selection=unavailable')
  await expect(deniedPage.locator('tbody tr')).toHaveCount(0)
  expect(
    (await deniedPage.request.get(`/api/excess-disposition-batches/${batch}/json`)).status(),
  ).toBe(404)
  await denied.close()
  await page.goto(
    '/replenishment/excess/integrations?selection=unavailable&system=Unknown&status=no_report',
  )
  await expect(rows).toHaveCount(2)
  for (const width of [375, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({
      path: testInfo.outputPath(`disposition-unavailable-${width}.png`),
      fullPage: true,
    })
  }
  expect(pageErrors).toEqual([])
})
