import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { generateApiKey } from '../src/lib/api/keys'

test.use({ actionTimeout: 30_000 })

test('transfer workbench keeps latest system reports separate, filters absence and preserves evidence', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000)
  const nonce = randomUUID()
  const email = `transfer-integration-${nonce}@example.com`
  const password = `Integration-${nonce}`
  const owner = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(
    `transfer-integration-review-${nonce}@example.com`,
    password,
  )
  const viewerEmail = `transfer-integration-viewer-${nonce}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  const branchEmail = `transfer-integration-branch-${nonce}@example.com`
  const branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `transfer-integration-${nonce}`
  await createOrganization(page, { name: 'Transfer integration workbench test', slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)(
      'uv',
      ['run', 'python', '-c', code, dsn, org, owner, approver, viewer, branch],
      { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
    )
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    for actor,role in [(sys.argv[4],'approver'),(sys.argv[5],'viewer'),(sys.argv[6],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],actor,role))`)
  const seeded = await promisify(execFile)(
    'uv',
    [
      'run',
      'python',
      resolve(process.cwd(), 'e2e/fixtures/transfer-batches.py'),
      dsn,
      org,
      owner,
      approver,
    ],
    { cwd: resolve(process.cwd(), '../../engine'), timeout: 100_000 },
  )
  const {
    lines,
    source,
    location: destination,
  } = JSON.parse(seeded.stdout.trim()) as {
    lines: { handoff: string; estimate: string }[]
    source: string
    location: string
  }
  const client = await signedInClient(email, password)
  const saveBatch = async (other: number) => {
    const saved = await client.rpc('transfer_handoff_batch_create', {
      p_organization_id: org,
      p_handoff_ids: [lines[0].handoff, lines[other].handoff],
    })
    expect(saved.error).toBeNull()
    return saved.data as string
  }
  const batch = await saveBatch(1)
  await saveBatch(2)
  const original = await (
    await page.request.get(`/api/transfer-handoffs/${lines[0].handoff}/json`)
  ).json()
  const originalBatch = await (await page.request.get(`/api/transfer-batches/${batch}/json`)).json()
  const key = await generateApiKey()
  expect(
    (
      await client.rpc('create_api_key', {
        p_organization_id: org,
        p_name: 'Reports',
        p_scopes: ['transfer_handoffs:acknowledge'],
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
    packageId = lines[0].handoff,
  ) => {
    const response = await request.post(
      `/api/v1/${packageId === batch ? 'transfer-handoff-batches' : 'transfer-handoffs'}/${packageId}/acknowledgements`,
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

  await page.goto('/replenishment/redistribution/handoffs')
  await page.getByRole('link', { name: 'Transfer integration workbench', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Transfer integration workbench', exact: true }),
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
    const tableRegion = page.getByRole('region', { name: 'Transfer integration workbench' })
    await tableRegion.focus()
    await expect(tableRegion).toBeFocused()
    if (await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect
        .poll(() => tableRegion.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0)
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => tableRegion.evaluate((element) => element.scrollLeft)).toBe(0)
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '28px')
    await expect(page.locator('thead th').first()).toHaveCSS('font-size', '12px')
    await expect(rows.first()).toHaveCSS('font-size', '14px')
    await page.screenshot({
      path: `test-results/transfer-integration-workbench-${width}.png`,
      fullPage: true,
    })
  }
  await rows.getByRole('link', { name: 'Open evidence and history' }).click()
  await expect(page).toHaveURL(new RegExp(`/handoffs/${lines[0].handoff}#acknowledgements$`))
  await expect(page.getByRole('region', { name: 'Integration acknowledgements' })).toContainText(
    'Superseded rejection',
  )
  for (let index = 0; index < 30; index++) await report(`System-${index}`, `reference-${index}`)
  await page.goto('/replenishment/redistribution/integrations')
  await expect(page.getByText('37 package/system results', { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(25)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(rows).toHaveCount(12)
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await page.goto('/replenishment/redistribution/integrations?page=100000')
  await expect(page).toHaveURL(/integrations\?page=2$/)
  await page.goto('/replenishment/redistribution/integrations?q=old-reference')
  await expect(rows).toHaveCount(0)
  await page.goto('/replenishment/redistribution/integrations?system=ERP&q=current-reference')
  await expect(rows).toHaveCount(1)
  await page.getByLabel('Source location code').fill('SOURCE')
  await page.getByLabel('Destination location code').fill('DESTINATION')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  // Both filters still return one row. Wait for the new response/form before editing again.
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('source') === 'SOURCE' &&
      url.searchParams.get('location') === 'DESTINATION',
  )
  await expect(page.getByLabel('Source location code')).toHaveAttribute('value', 'SOURCE')
  await expect(rows).toHaveCount(1)
  await page.getByLabel('Source location code').fill('Unknown source')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('source') === 'Unknown source')
  await expect(rows).toHaveCount(0)

  await python(`import sys,json,psycopg
from uuid import uuid4
def call(actor,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=actor,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.transfer_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${lines[0].estimate}',uuid4(),'Replacement'))
call(sys.argv[4],'select public.transfer_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))`)
  await page.goto('/replenishment/redistribution/integrations?system=ERP&selection=historical')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'current-reference' })).toContainText('Historical')
  expect(
    await (await page.request.get(`/api/transfer-handoffs/${lines[0].handoff}/json`)).json(),
  ).toEqual(original)
  expect(await (await page.request.get(`/api/transfer-batches/${batch}/json`)).json()).toEqual(
    originalBatch,
  )

  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto('/replenishment/redistribution/integrations?system=ERP')
  await expect(viewerPage.locator('tbody tr')).toHaveCount(5)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto('/replenishment/redistribution/integrations?system=ERP')
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await expect(branchPage.getByText('0 package/system results', { exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[6],'${destination}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[6],'${source}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(5)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=%s',(sys.argv[2],sys.argv[6],'${destination}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await branchContext.close()
})
