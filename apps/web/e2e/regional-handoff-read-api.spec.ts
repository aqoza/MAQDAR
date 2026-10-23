import { seedRegionalHandoffs } from './helpers/regional-handoffs'
import { generateApiKey } from '../src/lib/api/keys'
import { expectPageTitle } from './helpers/typography'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import { createConfirmedUser, signedInClient } from './helpers/auth'
import { openSettings } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })

async function expectPermissionTextFits(page: Page) {
  const clipped = await page.locator('input[name="scopes"]').evaluateAll((inputs) =>
    inputs.flatMap((input) => {
      const row = input.parentElement!
      const bounds = row.getBoundingClientRect()
      return Array.from(row.querySelectorAll('label, bdi, p')).flatMap((text) => {
        const rect = text.getBoundingClientRect()
        return rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1 ||
          text.scrollWidth > text.clientWidth + 1
          ? [input.id]
          : []
      })
    }),
  )
  expect(clipped, 'Permission labels, identifiers and help must fit their own grid cell').toEqual(
    [],
  )
}

test('regional read API scopes complete evidence and retained batches at five widths and RTL', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(360_000)
  const {
    key,
    password,
    branchEmail,
    org,
    parent,
    ids,
    batch,
    original,
    individual,
    editorClient,
    approve,
    python,
    cleanup,
  } = await seedRegionalHandoffs(page)
  try {
    const branchClient = await signedInClient(branchEmail, password)
    expect((await branchClient.from('regional_transfer_handoffs').select('id')).data).toEqual([])
    expect((await branchClient.from('regional_handoff_batches').select('id')).data).toEqual([])
    await openSettings(page, 'api-keys')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByLabel('Read regional handoffs', { exact: true })).toBeVisible()
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByLabel('Read regional handoffs', { exact: true })).toBeVisible()
      await expectPermissionTextFits(page)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true)
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      await page.screenshot({
        path: testInfo.outputPath(`regional-api-settings-${width}.png`),
        fullPage: true,
      })
    }
    await expect(page.getByLabel('Read regional handoffs', { exact: true })).not.toBeChecked()
    await page.getByLabel('Read regional handoffs', { exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByLabel('Read regional handoffs', { exact: true })).toBeChecked()
    await page.keyboard.press('Space')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByLabel('Key name', { exact: true }).fill('Handoff reader')
    await page.getByLabel('Read regional handoffs', { exact: true }).check()
    await expect(
      page.getByText(
        'Read saved regional handoffs and batches across the whole organization, including every source and retained evidence after source deletion. Does not reserve stock or execute transfers.',
        { exact: true },
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Create key', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const headers = { Authorization: `Bearer ${token}` }
    const api = '/api/v1/regional-handoffs'
    const batches = '/api/v1/regional-handoff-batches'
    expect((await page.request.get(api)).status()).toBe(401) // Browser cookies are not credentials.
    expect((await request.get('/api/v1/items', { headers })).status()).toBe(403)
    for (const path of [
      '/api/v1/purchase-handoffs',
      '/api/v1/transfer-handoffs',
      '/api/v1/event-purchase-handoffs',
      '/api/v1/network-handoffs',
      '/api/v1/excess-disposition-handoffs',
    ]) {
      expect((await request.get(path, { headers })).status()).toBe(403)
    }
    for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`]) {
      expect((await request.get(`${path}/acknowledgements`, { headers })).status()).toBe(200)
      expect((await request.post(`${path}/acknowledgements`, { headers, data: {} })).status()).toBe(
        403,
      )
    }
    const orgResponse = await request.get('/api/v1/organization', { headers })
    expect((await orgResponse.json()).key.scopes).toEqual(['regional_handoffs:read'])

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
      destination_code: 'DEST',
      requested_date: '2026-10-10',
      handoff_count: 2,
      source_row_count: 4,
      item_code: null,
      totals: original.summary.totals,
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
    const otherEmail = `regional-other-${key}@example.com`
    await createConfirmedUser(otherEmail, password)
    const other = await signedInClient(otherEmail, password)
    const { data: otherOrg, error: orgError } = await other.rpc('create_organization', {
      p_name: 'Other API tenant',
      p_slug: `regional-other-${key}`,
      p_base_currency: 'SAR',
      p_home_country: 'SA',
      p_arabic_enabled: false,
    })
    expect(orgError).toBeNull()
    const otherKey = await generateApiKey()
    const { error: keyError } = await other.rpc('create_api_key', {
      p_organization_id: otherOrg,
      p_name: 'Other reader',
      p_scopes: ['regional_handoffs:read'],
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

    // A key carrying every older permission still gets no regional access.
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
      'excess_disposition_handoffs:read',
      'excess_disposition_handoffs:acknowledge',
      'network_handoffs:read',
      'network_handoffs:acknowledge',
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
        (
          await request.get(path, { headers: { Authorization: `Bearer ${legacy.token}` } })
        ).status(),
      ).toBe(403)
    await approve()
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
    db.execute('delete from public.regional_sourcing_scenarios where organization_id=%s and id=%s',(sys.argv[2],'${parent}'))`)
    expect((await request.get(`${api}/${ids[0]}`, { headers })).status()).toBe(404)
    const retained = await (await request.get(`${batches}/${batch}`, { headers })).json()
    expect(retained.data.current.selection).toBe('unavailable')
    expect(retained.data.payload).toEqual(original)
    expect(retained.data.summary.totals).toEqual(original.summary.totals)
    const listed = await (await request.get(batches, { headers })).json()
    expect(listed.data[0].id).toBe(batch)
    expect(listed.data[0].current.selection).toBe('unavailable')
    expect(await (await page.request.get(`/api/regional-batches/${batch}/json`)).json()).toEqual(
      original,
    )
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
      await expect(page.getByLabel('قراءة تسليمات المناطق', { exact: true })).toBeVisible()
      await expectPermissionTextFits(page)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`regional-api-settings-rtl-${width}.png`),
        fullPage: true,
      })
    }
    expect(errors).toEqual([])
  } finally {
    await cleanup()
  }
})
