import { randomUUID } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import { EXAMPLES } from '../src/lib/api/examples'
import { generateApiKey } from '../src/lib/api/keys'
import { RESOURCES } from '../src/lib/api/resources'
import { createConfirmedUser, signedInClient, signInWithPassword } from './helpers/auth'
import { createOrganization, openSettings } from './helpers/organizations'

test.setTimeout(120_000)

async function owner() {
  const id = randomUUID()
  const email = `api-${id}@example.com`
  const password = `Api-test-${id}`
  await createConfirmedUser(email, password)
  return { email, password, slug: `api-${id}`, name: `API ${id}` }
}

async function createKeyInSettings(page: Page, name: string): Promise<string> {
  await page.getByLabel('Key name', { exact: true }).fill(name)
  await page.getByLabel('Read master data', { exact: true }).check()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  expect(token).toMatch(/^maqdar_sk_[0-9A-Za-z]{49}$/)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0)
  return token
}

async function expectProblem(response: APIResponse, status: number, code: string) {
  expect(response.status()).toBe(status)
  expect(response.headers()['content-type']).toContain('application/problem+json')
  expect(response.headers()['cache-control']).toContain('no-store')
  const body = await response.json()
  expect(body).toMatchObject({ status, code, request_id: response.headers()['x-request-id'] })
  expect(body.instance).toBe(`urn:uuid:${body.request_id}`)
  return body
}

test('Settings shows a key once, enforces its scope and revokes access immediately', async ({
  page,
  request,
}) => {
  const account = await owner()
  await signInWithPassword(page, account.email, account.password)
  await createOrganization(page, account)
  await openSettings(page, 'api-keys')

  // A rejected form must retain its name and allow correction without creating a key.
  await page.getByLabel('Key name', { exact: true }).fill('ERP read access')
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByText('Choose at least one permission.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Key name', { exact: true })).toHaveValue('ERP read access')
  const token = await createKeyInSettings(page, 'ERP read access')
  const headers = { Authorization: `Bearer ${token}` }

  // The API requires a key even when a browser session is present.
  await expectProblem(await page.request.get('/api/v1/items'), 401, 'unauthorized')
  const organization = await request.get('/api/v1/organization', { headers })
  expect(organization.status()).toBe(200)
  expect((await organization.json()).organization.slug).toBe(account.slug)
  await expectProblem(
    await request.post('/api/v1/items:upsert', { headers, data: { records: EXAMPLES.items } }),
    403,
    'insufficient_scope',
  )
  expect((await request.get('/api/v1/items', { headers })).status()).toBe(200)

  await page.reload()
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0)
  const row = page.getByRole('row').filter({ hasText: 'ERP read access' })
  await expect(row).toContainText('Active')
  await expect(row).not.toContainText(token)
  await expect(row).not.toContainText('Never')
  await row.getByRole('button', { name: 'Revoke ERP read access', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(row).toContainText('Revoked')
  await expectProblem(await request.get('/api/v1/items', { headers }), 401, 'invalid_token')
})

test('all contract resources round-trip through HTTP with atomic writes and tenant isolation', async ({
  request,
}) => {
  const account = await owner()
  const client = await signedInClient(account.email, account.password)
  const { data: org, error: orgError } = await client.rpc('create_organization', {
    p_name: account.name,
    p_slug: account.slug,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  expect(orgError).toBeNull()
  const key = await generateApiKey()
  const { error: keyError } = await client.rpc('create_api_key', {
    p_organization_id: org,
    p_name: 'Contract test',
    p_scopes: ['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'],
    p_expires_in_days: 30,
    p_key_hash: key.hash,
    p_display_prefix: key.displayPrefix,
    p_last4: key.last4,
  })
  expect(keyError).toBeNull()
  const headers = { Authorization: `Bearer ${key.token}` }

  for (const resource of RESOURCES) {
    const write = await request.post(`/api/v1/${resource.name}:upsert`, {
      headers,
      data: { records: EXAMPLES[resource.entity] },
    })
    expect(write.status(), `${resource.name}: ${await write.text()}`).toBe(200)
    expect(await write.json()).toMatchObject({ recorded: true })

    const query = resource.entity === 'demand_history' ? '?from=2026-09-01&to=2026-09-01' : ''
    const read = await request.get(`/api/v1/${resource.name}${query}`, { headers })
    expect(read.status()).toBe(200)
    const body = await read.json()
    expect(body.data).toHaveLength(EXAMPLES[resource.entity].length)
    if (['demand_history', 'stock_snapshots'].includes(resource.entity)) {
      expect(body.data[0].unit_of_measure).toBe('EA')
    }
    expect(body.next_cursor).toBeNull()
    expect(read.headers()['set-cookie']).toBeUndefined()
    // Read representations can be sent back unchanged, including decimal strings and updated_at.
    const replay = await request.post(`/api/v1/${resource.name}:upsert`, {
      headers,
      data: { records: body.data },
    })
    expect(replay.status(), `${resource.name}: ${await replay.text()}`).toBe(200)
    expect(await replay.json()).toMatchObject({ recorded: false, import_id: null })
  }

  const first = await request.get('/api/v1/items?limit=1', { headers })
  const firstPage = await first.json()
  expect(firstPage.data).toHaveLength(1)
  expect(firstPage.next_cursor).toEqual(expect.any(String))
  const second = await request.get('/api/v1/items', {
    headers,
    params: { limit: 1, cursor: firstPage.next_cursor },
  })
  const secondPage = await second.json()
  expect(secondPage.data).toHaveLength(1)
  expect(secondPage.data[0].item_code).not.toBe(firstPage.data[0].item_code)
  expect(secondPage.next_cursor).toBeNull()
  expect(secondPage.as_of).toBe(firstPage.as_of)

  // One invalid row must roll back the valid row beside it.
  await expectProblem(
    await request.post('/api/v1/brands:upsert', {
      headers,
      data: {
        records: [
          { brand_code: 'ATOMIC-GOOD', name_en: 'Must not persist', brand_type: 'oem' },
          { brand_code: 'ATOMIC-BAD', name_en: 'Invalid type', brand_type: 'unknown' },
        ],
      },
    }),
    422,
    'validation_failed',
  )
  const brands = await request.get('/api/v1/brands', { headers })
  expect((await brands.json()).data.map((row: { brand_code: string }) => row.brand_code)).toEqual([
    'FALCON',
  ])
  await expectProblem(
    await request.get('/api/v1/items?organization_id=another-tenant', { headers }),
    400,
    'invalid_parameter',
  )

  const other = await client.rpc('create_organization', {
    p_name: `${account.name} other`,
    p_slug: `${account.slug}-other`,
    p_base_currency: 'AED',
    p_home_country: 'AE',
    p_arabic_enabled: false,
  })
  expect(other.error).toBeNull()
  const otherKey = await generateApiKey()
  const otherCreated = await client.rpc('create_api_key', {
    p_organization_id: other.data,
    p_name: 'Other tenant',
    p_scopes: ['master_data:read'],
    p_expires_in_days: 30,
    p_key_hash: otherKey.hash,
    p_display_prefix: otherKey.displayPrefix,
    p_last4: otherKey.last4,
  })
  expect(otherCreated.error).toBeNull()
  const otherHeaders = { Authorization: `Bearer ${otherKey.token}` }
  const otherItems = await request.get('/api/v1/items', { headers: otherHeaders })
  expect(otherItems.status()).toBe(200)
  expect((await otherItems.json()).data).toEqual([])
  // Cursors are positions, not authorization: even a cursor from A must only read B's rows.
  const otherPage = await request.get('/api/v1/items', {
    headers: otherHeaders,
    params: { cursor: firstPage.next_cursor },
  })
  expect(otherPage.status()).toBe(200)
  expect((await otherPage.json()).data).toEqual([])
})

test('public API discovery and OpenAPI caching work without a session', async ({ request }) => {
  const index = await request.get('/api/v1')
  expect(index.status()).toBe(200)
  expect((await index.json()).openapi).toBe('/api/v1/openapi.json')
  const spec = await request.get('/api/v1/openapi.json')
  expect(spec.status()).toBe(200)
  expect((await spec.json()).openapi).toBe('3.1.1')
  expect(spec.headers()['access-control-allow-origin']).toBe('*')
  const cached = await request.get('/api/v1/openapi.json', {
    headers: { 'If-None-Match': spec.headers().etag },
  })
  expect(cached.status()).toBe(304)
  expect(await cached.body()).toHaveLength(0)
  await expectProblem(await request.get('/api/v1/not-a-resource'), 404, 'not_found')
  const method = await request.post('/api/v1/items')
  await expectProblem(method, 405, 'method_not_allowed')
  expect(method.headers().allow).toContain('GET')
})
