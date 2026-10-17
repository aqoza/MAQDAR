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
import { createOrganization, openSettings } from './helpers/organizations'
import { generateApiKey } from '../src/lib/api/keys'

test('external reports are scoped, retry-safe, historical and visible without changing exports', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const nonce = randomUUID()
  const email = `ack-owner-${nonce}@example.com`
  const password = `Ack-${nonce}`
  const owner = await createConfirmedUser(email, password)
  const approver = await createConfirmedUser(`ack-approver-${nonce}@example.com`, password)
  await signInWithPassword(page, email, password)
  const slug = `ack-${nonce}`
  await createOrganization(page, { name: 'Acknowledgements test', slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
      resolve(process.cwd(), 'e2e/fixtures/handoff-batches.py'),
      dsn,
      org,
      owner,
      approver,
    ],
    {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    },
  )
  const { lines } = JSON.parse(seeded.stdout.trim()) as {
    lines: { handoff: string; estimate: string }[]
  }
  const saveBatch = async (other: number) => {
    await page.goto(
      `/replenishment/batches/preview?handoff=${lines[0].handoff}&handoff=${lines[other].handoff}`,
    )
    await page.getByRole('button', { name: 'Save batch', exact: true }).click()
    await expect(page).toHaveURL(/\/replenishment\/batches\/[0-9a-f-]+$/)
    return page.url().split('/').at(-1)!
  }
  const batch = await saveBatch(1)
  const overlap = await saveBatch(2)
  const original = await (
    await page.request.get(`/api/purchase-handoffs/${lines[0].handoff}/json`)
  ).json()
  const originalBatch = await (await page.request.get(`/api/handoff-batches/${batch}/json`)).json()
  await openSettings(page)
  await page.getByLabel('Key name', { exact: true }).fill('Acknowledgement integration')
  await page.getByLabel('Read purchase handoffs', { exact: true }).check()
  await page.getByLabel('Acknowledge purchase handoffs', { exact: true }).check()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const headers = { Authorization: `Bearer ${token}` }
  const api = `/api/v1/purchase-handoffs/${lines[0].handoff}/acknowledgements`
  const batchApi = `/api/v1/purchase-handoff-batches/${batch}/acknowledgements`
  const input = {
    client_event_id: randomUUID(),
    external_system: 'Test ERP',
    external_reference: '000123',
    status: 'received',
  }
  expect((await page.request.post(api, { data: input })).status()).toBe(401)
  const created = await request.post(api, { headers, data: input })
  expect(created.status(), await created.text()).toBe(201)
  const saved = await created.json()
  expect(saved.replayed).toBe(false)
  expect(saved.data.external_reference).toBe('000123')
  expect(created.headers()['cache-control']).toContain('no-store')
  expect(created.headers()['set-cookie']).toBeUndefined()
  const location = created.headers().location
  expect((await (await request.get(location, { headers })).json()).data).toEqual(saved.data)
  const replay = await request.post(api, { headers, data: { ...input, reason: null } })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data).toEqual(saved.data)
  expect(
    (
      await request.post(api, { headers, data: { ...input, external_reference: 'changed' } })
    ).status(),
  ).toBe(409)
  expect(
    (
      await request.post(api, {
        headers,
        data: { ...input, client_event_id: randomUUID(), status: 'rejected' },
      })
    ).status(),
  ).toBe(422)
  expect((await request.patch(location, { headers, data: { status: 'rejected' } })).status()).toBe(
    405,
  )

  // Read permission stays separate from acknowledgement permission.
  const client = await signedInClient(email, password)
  const reader = await generateApiKey()
  expect(
    (
      await client.rpc('create_api_key', {
        p_organization_id: org,
        p_name: 'Read only',
        p_scopes: ['purchase_handoffs:read'],
        p_expires_in_days: 30,
        p_key_hash: reader.hash,
        p_display_prefix: reader.displayPrefix,
        p_last4: reader.last4,
      })
    ).error,
  ).toBeNull()
  expect(
    (
      await request.post(api, { headers: { Authorization: `Bearer ${reader.token}` }, data: input })
    ).status(),
  ).toBe(403)

  const otherEmail = `ack-other-${nonce}@example.com`
  await createConfirmedUser(otherEmail, password)
  const other = await signedInClient(otherEmail, password)
  const otherOrg = await other.rpc('create_organization', {
    p_name: 'Other acknowledgement tenant',
    p_slug: `other-ack-${nonce}`,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  expect(otherOrg.error).toBeNull()
  const otherKey = await generateApiKey()
  expect(
    (
      await other.rpc('create_api_key', {
        p_organization_id: otherOrg.data,
        p_name: 'Other integration',
        p_scopes: ['purchase_handoffs:read', 'purchase_handoffs:acknowledge'],
        p_expires_in_days: 30,
        p_key_hash: otherKey.hash,
        p_display_prefix: otherKey.displayPrefix,
        p_last4: otherKey.last4,
      })
    ).error,
  ).toBeNull()
  const otherHeaders = { Authorization: `Bearer ${otherKey.token}` }
  expect((await request.post(api, { headers: otherHeaders, data: input })).status()).toBe(404)
  expect((await request.get(api, { headers: otherHeaders })).status()).toBe(404)
  expect((await request.get(location, { headers: otherHeaders })).status()).toBe(404)

  const rejected = {
    ...input,
    client_event_id: randomUUID(),
    status: 'rejected',
    external_reference: 'REJECT-' + 'X'.repeat(193),
    reason: 'Unknown item <script>alert(1)</script>',
  }
  expect((await request.post(batchApi, { headers, data: rejected })).status()).toBe(201)
  expect(
    (
      await (
        await request.get(`/api/v1/purchase-handoff-batches/${overlap}/acknowledgements`, {
          headers,
        })
      ).json()
    ).data,
  ).toEqual([])
  expect(
    (
      await (
        await request.get(`/api/v1/purchase-handoffs/${lines[1].handoff}/acknowledgements`, {
          headers,
        })
      ).json()
    ).data,
  ).toEqual([])
  const firstPage = await (await request.get(api, { headers, params: { limit: 1 } })).json()
  expect(firstPage.data).toHaveLength(1)
  expect(firstPage.data[0]).toEqual(saved.data)

  // A later selection and price change do not prevent a historical receipt report.
  await python(`import sys,json,psycopg
from uuid import uuid4
def call(actor,sql,args):
    with psycopg.connect(sys.argv[1]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=actor,org_id=sys.argv[2],role='authenticated')),))
        return db.execute(sql,args).fetchone()[0]
proposal=call(sys.argv[3],'select public.purchase_proposal_submit(%s,%s,%s,%s)',(sys.argv[2],'${lines[0].estimate}',uuid4(),'Replacement'))
call(sys.argv[4],'select public.purchase_proposal_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Reviewed'))
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(sys.argv[2],))`)
  for (let index = 0; index < 21; index++) {
    const result = await request.post(api, {
      headers,
      data: { ...input, client_event_id: randomUUID(), external_reference: `LATER-${index}` },
    })
    expect(result.status(), await result.text()).toBe(201)
  }
  expect(
    await (await page.request.get(`/api/purchase-handoffs/${lines[0].handoff}/json`)).json(),
  ).toEqual(original)
  expect(await (await page.request.get(`/api/handoff-batches/${batch}/json`)).json()).toEqual(
    originalBatch,
  )

  await page.goto(`/replenishment/handoffs/${lines[0].handoff}`)
  const history = page.getByRole('region', { name: 'Integration acknowledgements' })
  await expect(history).toContainText('22 reports')
  await expect(history.locator('time').first()).toHaveCSS('font-size', '12px')
  await expect(history.getByRole('listitem')).toHaveCount(20)
  await history.getByRole('link', { name: 'Older reports' }).click()
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history).toContainText('000123')
  await history.getByText('Event details', { exact: true }).last().focus()
  await page.keyboard.press('Enter')
  await expect(history.getByText(saved.data.id, { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(history).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    if (width === 375 || width === 1440) {
      await history.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/acknowledgements-${width}.png` })
    }
  }
  await page.goto(`/replenishment/batches/${batch}`)
  await expect(history).toContainText('Reported rejected')
  await expect(history).toContainText(rejected.reason)
  expect(await history.locator('script').count()).toBe(0)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await history.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    if (width === 375 || width === 1440)
      await page.screenshot({ path: `test-results/acknowledgements-batch-${width}.png` })
  }
  await openSettings(page)
  await page
    .getByRole('row')
    .filter({ hasText: 'Acknowledgement integration' })
    .getByRole('button', { name: 'Revoke Acknowledgement integration', exact: true })
    .click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'Acknowledgement integration' }),
  ).toContainText('Revoked')
  expect((await request.post(api, { headers, data: input })).status()).toBe(401)
})
