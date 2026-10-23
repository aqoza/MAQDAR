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

test('transfer handoff API preserves saved evidence, scopes tenants and reports current selection separately', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const nonce = randomUUID()
  const email = `transfer-api-${nonce}@example.com`
  const password = `Api-${nonce}`
  const owner = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`transfer-approver-${nonce}@example.com`, password)
  await signInWithPassword(page, email, password)
  const slug = `transfer-api-${nonce}`
  await createOrganization(page, { name: 'Handoff API test', slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, approver], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')",(sys.argv[2],sys.argv[4]))`)
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
  const { lines } = JSON.parse(seeded.stdout.trim()) as {
    lines: { handoff: string; item: string; estimate: string; proposal: string }[]
  }
  await page.goto(
    `/replenishment/redistribution/batches/preview?handoff=${lines[0].handoff}&handoff=${lines[1].handoff}`,
  )
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/replenishment\/redistribution\/batches\/[0-9a-f-]+$/)
  const batch = page.url().split('/').at(-1)!
  const original = await (await page.request.get(`/api/transfer-batches/${batch}/json`)).json()
  const individual = await (
    await page.request.get(`/api/transfer-handoffs/${lines[0].handoff}/json`)
  ).json()
  await openSettings(page, 'api-keys')
  await page.getByLabel('Key name', { exact: true }).fill('Handoff reader')
  await page.getByLabel('Read transfer handoffs', { exact: true }).check()
  await expect(
    page.getByText(
      'Read saved transfer handoffs and batches across the whole organization, including historical approvals. No stock reservation or transfer execution.',
      { exact: true },
    ),
  ).toBeVisible()
  // Capture only the scope form, before issuing a secret, at every approved width.
  const keyForm = page.locator('form[aria-labelledby="api-key-form-heading"]')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByLabel('Read transfer handoffs', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await keyForm.screenshot({ path: testInfo.outputPath(`transfer-scope-${width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const headers = { Authorization: `Bearer ${token}` }
  const api = '/api/v1/transfer-handoffs'
  const batches = '/api/v1/transfer-handoff-batches'
  expect((await page.request.get(api)).status()).toBe(401) // Browser cookies are not credentials.
  expect((await request.get('/api/v1/items', { headers })).status()).toBe(403)
  expect((await request.get('/api/v1/purchase-handoffs', { headers })).status()).toBe(403)
  const orgResponse = await request.get('/api/v1/organization', { headers })
  expect((await orgResponse.json()).key.scopes).toEqual(['transfer_handoffs:read'])

  const ids: string[] = []
  let cursor: string | null = null
  let asOf: string | null = null
  do {
    const response: APIResponse = await request.get(api, {
      headers,
      params: { limit: 1, ...(cursor ? { cursor } : {}) },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body: {
      data: { id: string; payload?: unknown; current: { selected: boolean } }[]
      as_of: string
      next_cursor: string | null
    } = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].payload).toBeUndefined()
    expect(body.data[0].current.selected).toBe(true)
    if (asOf) expect(body.as_of).toBe(asOf)
    asOf = body.as_of
    cursor = body.next_cursor
    ids.push(body.data[0].id)
    expect(ids.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(ids.sort()).toEqual(lines.map((line) => line.handoff).sort())
  const fetched = await request.get(`${api}/${lines[0].handoff}`, { headers })
  expect(fetched.status()).toBe(200)
  expect(fetched.headers()['cache-control']).toContain('no-store')
  expect(fetched.headers()['set-cookie']).toBeUndefined()
  expect((await fetched.json()).data.payload).toEqual(individual)
  const batchResponse = await request.get(`${batches}/${batch}`, { headers })
  const batchData = (await batchResponse.json()).data
  expect(batchData.payload).toEqual(original)
  expect(batchData.summary).toMatchObject({ subtotal: '2.02', line_count: 2, item_code: null })
  expect(batchData.summary.handoff_ids).toEqual([lines[0].handoff, lines[1].handoff].sort())
  expect(batchData.current.selected).toBe(true)
  expect(batchData.summary.source_location_id).toBe(original.summary.source_location_id)
  expect(batchData.summary.location_id).toBe(original.summary.location_id)
  expect(batchData.summary.lane_id).toBe(original.summary.lane_id)
  expect(
    batchData.payload.lines.map(
      (line: { estimate: { subtotal: string } }) => line.estimate.subtotal,
    ),
  ).toEqual(['1.01', '1.01'])
  const head = await request.head(`${batches}/${batch}`, { headers })
  expect(head.status()).toBe(200)
  expect(await head.text()).toBe('')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await request.fetch(`${api}/${lines[0].handoff}`, { method, headers })).status()).toBe(
      405,
    )
  }
  expect((await request.get(`${api}?selected=true`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}?cursor=broken`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}/${randomUUID()}`, { headers })).status()).toBe(404)

  // A valid key of another organization cannot enumerate or fetch these records.
  const otherEmail = `transfer-other-${nonce}@example.com`
  await createConfirmedUser(otherEmail, password)
  const other = await signedInClient(otherEmail, password)
  const { data: otherOrg, error: orgError } = await other.rpc('create_organization', {
    p_name: 'Other API tenant',
    p_slug: `transfer-other-${nonce}`,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  expect(orgError).toBeNull()
  const otherKey = await generateApiKey()
  const { error: keyError } = await other.rpc('create_api_key', {
    p_organization_id: otherOrg,
    p_name: 'Other reader',
    p_scopes: ['transfer_handoffs:read'],
    p_expires_in_days: 30,
    p_key_hash: otherKey.hash,
    p_display_prefix: otherKey.displayPrefix,
    p_last4: otherKey.last4,
  })
  expect(keyError).toBeNull()
  const otherHeaders = { Authorization: `Bearer ${otherKey.token}` }
  for (const path of [api, batches])
    expect((await (await request.get(path, { headers: otherHeaders })).json()).data).toEqual([])
  for (const path of [`${api}/${lines[0].handoff}`, `${batches}/${batch}`])
    expect((await request.get(path, { headers: otherHeaders })).status()).toBe(404)

  await python(`import sys,json,psycopg
from uuid import uuid4
def call(actor,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=actor,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.transfer_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${lines[0].estimate}',uuid4(),'Replacement'))
call(sys.argv[4],'select public.transfer_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.network_links set freight_cost=2 where organization_id=%s',(sys.argv[2],))`)
  for (const [path, saved] of [
    [`${api}/${lines[0].handoff}`, individual],
    [`${batches}/${batch}`, original],
  ] as const) {
    const response = await request.get(path, { headers })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.data.current.selected).toBe(false)
    expect(body.data.payload).toEqual(saved)
  }
  const historical = await (await request.get(batches, { headers })).json()
  expect(historical.data[0].current.selected).toBe(false)
  expect(historical.data[0].id).toBe(batch)
  // Saved batch copies remain readable when an individual source disappears.
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.transfer_handoffs where organization_id=%s and id=%s',(sys.argv[2],'${lines[0].handoff}'))`)
  expect((await request.get(`${api}/${lines[0].handoff}`, { headers })).status()).toBe(404)
  expect(
    (await (await request.get(`${batches}/${batch}`, { headers })).json()).data.payload,
  ).toEqual(original)
  const row = page.getByRole('row').filter({ hasText: 'Handoff reader' })
  await row.getByRole('button', { name: 'Revoke Handoff reader', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(row).toContainText('Revoked')
  expect((await request.get(`${batches}/${batch}`, { headers })).status()).toBe(401)
})
