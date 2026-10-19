import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type APIResponse } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signedInClient,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization, openSettings } from './helpers/organizations'
import { generateApiKey } from '../src/lib/api/keys'

test.use({ actionTimeout: 30_000 })
test('disposition read API preserves exact evidence, scopes tenants and retains unavailable batches', async ({
  page,
  request,
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
  const original = await (
    await page.request.get(`/api/excess-disposition-batches/${batch}/json`)
  ).json()
  const individual = await (
    await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/json`)
  ).json()
  await openSettings(page, 'api-keys')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByLabel('Read disposition handoffs', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByLabel('Read disposition handoffs', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
    await page.screenshot({
      path: testInfo.outputPath(`disposition-api-settings-${width}.png`),
      fullPage: true,
    })
  }
  await expect(page.getByLabel('Read disposition handoffs', { exact: true })).not.toBeChecked()
  await page.getByLabel('Read disposition handoffs', { exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByLabel('Read disposition handoffs', { exact: true })).toBeChecked()
  await page.keyboard.press('Space')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByLabel('Key name', { exact: true }).fill('Handoff reader')
  await page.getByLabel('Read disposition handoffs', { exact: true }).check()
  await expect(
    page.getByText(
      'Read saved disposition handoffs and batches across the whole organization, including retained evidence after source deletion. Does not create returns, write-offs or stock movements.',
      { exact: true },
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const headers = { Authorization: `Bearer ${token}` }
  const api = '/api/v1/excess-disposition-handoffs'
  const batches = '/api/v1/excess-disposition-handoff-batches'
  expect((await page.request.get(api)).status()).toBe(401) // Browser cookies are not credentials.
  expect((await request.get('/api/v1/items', { headers })).status()).toBe(403)
  for (const path of [
    '/api/v1/purchase-handoffs',
    '/api/v1/transfer-handoffs',
    '/api/v1/event-purchase-handoffs',
  ]) {
    expect((await request.get(path, { headers })).status()).toBe(403)
  }
  for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`]) {
    const reports = await request.get(`${path}/acknowledgements`, { headers })
    expect(reports.status()).toBe(200)
    expect((await reports.json()).data).toEqual([])
    expect((await request.post(`${path}/acknowledgements`, { headers, data: {} })).status()).toBe(
      403,
    )
  }
  const orgResponse = await request.get('/api/v1/organization', { headers })
  expect((await orgResponse.json()).key.scopes).toEqual(['excess_disposition_handoffs:read'])

  const traversed: string[] = []
  let cursor: string | null = null
  let asOf: string | null = null
  do {
    const response: APIResponse = await request.get(api, {
      headers,
      params: { limit: 1, ...(cursor ? { cursor } : {}) },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body: {
      data: { id: string; payload?: unknown; current: { selection: string } }[]
      as_of: string
      next_cursor: string | null
    } = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].payload).toBeUndefined()
    expect(body.data[0].current.selection).toBe('current')
    if (asOf) expect(body.as_of).toBe(asOf)
    asOf = body.as_of
    cursor = body.next_cursor
    traversed.push(body.data[0].id)
    expect(traversed.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(traversed.sort()).toEqual([...ids].sort())
  const fetched = await request.get(`${api}/${ids[0]}`, { headers })
  expect(fetched.status()).toBe(200)
  expect(fetched.headers()['cache-control']).toContain('no-store')
  expect(fetched.headers()['set-cookie']).toBeUndefined()
  expect((await fetched.json()).data.payload).toEqual(individual)
  const batchResponse = await request.get(`${batches}/${batch}`, { headers })
  const batchData = (await batchResponse.json()).data
  expect(batchData.payload).toEqual(original)
  expect(batchData.summary).toMatchObject({
    reference_value: '7.499250',
    kind: 'supplier_return',
    currency: 'KWD',
    line_count: 2,
    item_code: null,
  })
  expect(batchData.summary.handoff_ids).toEqual([ids[0], ids[1]].sort())
  expect(batchData.current.selection).toBe('current')
  const head = await request.head(`${batches}/${batch}`, { headers })
  expect(head.status()).toBe(200)
  expect(await head.text()).toBe('')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await request.fetch(`${api}/${ids[0]}`, { method, headers })).status()).toBe(405)
  }
  expect((await request.get(`${api}?selected=true`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}?cursor=broken`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}/${randomUUID()}`, { headers })).status()).toBe(404)

  // A valid key of another organization cannot enumerate or fetch these records.
  const otherEmail = `disposition-other-${key}@example.com`
  await createConfirmedUser(otherEmail, password)
  const other = await signedInClient(otherEmail, password)
  const { data: otherOrg, error: orgError } = await other.rpc('create_organization', {
    p_name: 'Other API tenant',
    p_slug: `disposition-other-${key}`,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  expect(orgError).toBeNull()
  const otherKey = await generateApiKey()
  const { error: keyError } = await other.rpc('create_api_key', {
    p_organization_id: otherOrg,
    p_name: 'Other reader',
    p_scopes: ['excess_disposition_handoffs:read'],
    p_expires_in_days: 30,
    p_key_hash: otherKey.hash,
    p_display_prefix: otherKey.displayPrefix,
    p_last4: otherKey.last4,
  })
  expect(keyError).toBeNull()
  const otherHeaders = { Authorization: `Bearer ${otherKey.token}` }
  for (const path of [api, batches])
    expect((await (await request.get(path, { headers: otherHeaders })).json()).data).toEqual([])
  for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`])
    expect((await request.get(path, { headers: otherHeaders })).status()).toBe(404)

  // A key carrying every older permission still gets no disposition access.
  const legacy = await generateApiKey()
  const legacyScopes = [
    'master_data:read',
    'master_data:write',
    'transactions:read',
    'transactions:write',
    'purchase_handoffs:read',
    'purchase_handoffs:acknowledge',
    'transfer_handoffs:read',
    'transfer_handoffs:acknowledge',
    'event_purchase_handoffs:read',
    'event_purchase_handoffs:acknowledge',
  ]
  const legacyResult = await editorClient.rpc('create_api_key', {
    p_organization_id: org,
    p_name: 'Existing permissions',
    p_scopes: legacyScopes,
    p_expires_in_days: 30,
    p_key_hash: legacy.hash,
    p_display_prefix: legacy.displayPrefix,
    p_last4: legacy.last4,
  })
  expect(legacyResult.error).toBeNull()
  for (const path of [api, `${api}/${ids[0]}`, batches, `${batches}/${batch}`])
    expect(
      (await request.get(path, { headers: { Authorization: `Bearer ${legacy.token}` } })).status(),
    ).toBe(403)
  await approve('2', 'Replacement planning selection')
  for (const [path, saved] of [
    [`${api}/${ids[0]}`, individual],
    [`${batches}/${batch}`, original],
  ] as const) {
    const body = await (await request.get(path, { headers })).json()
    expect(body.data.current.selection).toBe('historical')
    expect(body.data.payload).toEqual(saved)
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.excess_stock_assessments where organization_id=%s and id=%s',(sys.argv[2],'${assessment.data}'))`)
  expect((await request.get(`${api}/${ids[0]}`, { headers })).status()).toBe(404)
  const retained = await (await request.get(`${batches}/${batch}`, { headers })).json()
  expect(retained.data.current.selection).toBe('unavailable')
  expect(retained.data.payload).toEqual(original)
  expect(retained.data.summary.reference_value).toBe('7.499250')
  const listed = await (await request.get(batches, { headers })).json()
  expect(listed.data[0].id).toBe(batch)
  expect(listed.data[0].current.selection).toBe('unavailable')
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/json`)).json(),
  ).toEqual(original)
  const row = page.getByRole('row').filter({ hasText: 'Handoff reader' })
  await row.getByRole('button', { name: 'Revoke Handoff reader', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(row).toContainText('Revoked')
  expect((await request.get(`${batches}/${batch}`, { headers })).status()).toBe(401)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(
      page.getByLabel('قراءة ملفات تسليم التصرف بالمخزون', { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-api-settings-rtl-${width}.png`),
      fullPage: true,
    })
  }
  expect(errors).toEqual([])
})
