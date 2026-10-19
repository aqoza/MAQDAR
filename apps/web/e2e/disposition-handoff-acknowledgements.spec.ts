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
import { createOrganization, openSettings } from './helpers/organizations'
import { generateApiKey } from '../src/lib/api/keys'

test.use({ actionTimeout: 30_000 })
test('disposition acknowledgements retain scoped immutable history, including copied batches after source deletion', async ({
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
  const originalCsv = await (
    await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/csv`)
  ).text()
  const originalBatchCsv = await (
    await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)
  ).text()
  await openSettings(page, 'api-keys')
  const scope = page.getByLabel('Acknowledge disposition handoffs', { exact: true })
  await expect(scope).not.toBeChecked()
  await scope.focus()
  await page.keyboard.press('Space')
  await expect(scope).toBeChecked()
  await page.keyboard.press('Space')
  for (const locale of ['en', 'ar']) {
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(
        page.getByLabel(
          locale === 'ar'
            ? 'تسجيل تقارير تسليم التصرف بالمخزون'
            : 'Acknowledge disposition handoffs',
          { exact: true },
        ),
      ).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`disposition-ack-settings-${locale}-${width}.png`),
        fullPage: true,
      })
    }
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await page.reload()
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByLabel('Key name', { exact: true }).fill('Acknowledgement integration')
  await page.getByLabel('Read disposition handoffs', { exact: true }).check()
  await page.getByLabel('Acknowledge disposition handoffs', { exact: true }).check()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const headers = { Authorization: `Bearer ${token}` }
  const api = `/api/v1/excess-disposition-handoffs/${ids[0]}/acknowledgements`
  const batchApi = `/api/v1/excess-disposition-handoff-batches/${batch}/acknowledgements`
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
        p_scopes: ['excess_disposition_handoffs:read'],
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

  for (const scope of [
    'purchase_handoffs:acknowledge',
    'transfer_handoffs:acknowledge',
    'event_purchase_handoffs:acknowledge',
    'excess_disposition_handoffs:acknowledge',
  ]) {
    const isolated = await generateApiKey()
    expect(
      (
        await client.rpc('create_api_key', {
          p_organization_id: org,
          p_name: scope,
          p_scopes: [scope],
          p_expires_in_days: 30,
          p_key_hash: isolated.hash,
          p_display_prefix: isolated.displayPrefix,
          p_last4: isolated.last4,
        })
      ).error,
    ).toBeNull()
    const scopedHeaders = { Authorization: `Bearer ${isolated.token}` }
    expect((await request.get(api, { headers: scopedHeaders })).status()).toBe(403)
    const retried = await request.post(api, { headers: scopedHeaders, data: input })
    expect(retried.status()).toBe(scope === 'excess_disposition_handoffs:acknowledge' ? 200 : 403)
    if (retried.status() === 200) expect((await retried.json()).data).toEqual(saved.data)
  }
  const otherEmail = `disposition-ack-other-${key}@example.com`
  await createConfirmedUser(otherEmail, password)
  const other = await signedInClient(otherEmail, password)
  const otherOrg = await other.rpc('create_organization', {
    p_name: 'Other acknowledgement tenant',
    p_slug: `other-disposition-ack-${key}`,
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
        p_scopes: ['excess_disposition_handoffs:read', 'excess_disposition_handoffs:acknowledge'],
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
        await request.get(
          `/api/v1/excess-disposition-handoff-batches/${overlap}/acknowledgements`,
          {
            headers,
          },
        )
      ).json()
    ).data,
  ).toEqual([])
  expect(
    (
      await (
        await request.get(`/api/v1/excess-disposition-handoffs/${ids[1]}/acknowledgements`, {
          headers,
        })
      ).json()
    ).data,
  ).toEqual([])
  const firstPage = await (await request.get(api, { headers, params: { limit: 1 } })).json()
  expect(firstPage.data).toHaveLength(1)
  expect(firstPage.data[0]).toEqual(saved.data)

  // Historical selection and changed stock do not alter the reportable saved package.
  await approve('2', 'Replacement planning selection')
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set unit_cost=2 where organization_id=%s',(sys.argv[2],))`)
  for (let index = 0; index < 21; index++) {
    const result = await request.post(api, {
      headers,
      data: { ...input, client_event_id: randomUUID(), external_reference: `LATER-${index}` },
    })
    expect(result.status(), await result.text()).toBe(201)
  }
  expect(
    await (await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/json`)).json(),
  ).toEqual(original)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/json`)).json(),
  ).toEqual(originalBatch)
  expect(
    await (await page.request.get(`/api/excess-disposition-handoffs/${ids[0]}/csv`)).text(),
  ).toBe(originalCsv)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)).text(),
  ).toBe(originalBatchCsv)

  const historyPage = await (await request.get(api, { headers, params: { limit: 1 } })).json()
  const nextPage = await (
    await request.get(api, { headers, params: { limit: 1, cursor: historyPage.next_cursor } })
  ).json()
  expect(nextPage.data).toHaveLength(1)
  expect(nextPage.data[0].id).not.toBe(historyPage.data[0].id)
  expect(
    (
      await request.get(batchApi, { headers, params: { cursor: historyPage.next_cursor } })
    ).status(),
  ).toBe(400)
  await page.goto(`/replenishment/excess/handoffs/${ids[0]}`)
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
    await expect(history.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '16px')
    if (width < 768) {
      expect(
        (await history.getByText('Event details', { exact: true }).first().boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44)
      expect(
        (await history.getByRole('link', { name: 'Newer reports' }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44)
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await history.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`disposition-acknowledgements-${width}.png`),
    })
  }
  await page.goto(`/replenishment/excess/batches/${batch}`)
  await expect(history).toContainText('Reported rejected')
  await expect(history).toContainText(rejected.reason)
  expect(await history.locator('script').count()).toBe(0)
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await history.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-acknowledgements-batch-${width}.png`),
    })
  }
  // Receiving-location access controls browser history; integration keys remain organization-wide.
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations values(%s,%s,%s) on conflict do nothing",(sys.argv[2],'${branch}','${fixture.location}'))`)
  const member = await signedInClient(branchEmail, password)
  const visible = () =>
    member
      .from('excess_disposition_handoff_acknowledgements')
      .select('id')
      .eq('organization_id', org)
  expect((await visible()).data).toHaveLength(23)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=%s",(sys.argv[2],'${branch}','${fixture.location}'))`)
  expect((await visible()).data).toEqual([])
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.organizations set arabic_enabled=true where id=%s",(sys.argv[2],))`)
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.reload()
  // React may stage a hidden streamed copy while replacing the localized page.
  // Assert a single visible history, rather than selecting either copy by order.
  const rtlHistory = page.locator('#acknowledgements:visible')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(rtlHistory).toHaveCount(1)
    await expect(rtlHistory).toContainText('يقدّم حامل مفتاح التكامل')
    await expect(rtlHistory).toContainText(rejected.reason)
    await rtlHistory.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`disposition-acknowledgements-rtl-${width}.png`),
    })
  }
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.excess_stock_assessments where organization_id=%s and id=%s',(sys.argv[2],'${assessment.data}'))`)
  expect((await request.get(api, { headers })).status()).toBe(404)
  expect((await (await request.get(batchApi, { headers })).json()).data).toHaveLength(1)
  expect(
    (
      await request.post(batchApi, {
        headers,
        data: { ...input, client_event_id: randomUUID(), external_reference: 'RETAINED' },
      })
    ).status(),
  ).toBe(201)
  const retained = await (
    await request.get(`/api/v1/excess-disposition-handoff-batches/${batch}`, { headers })
  ).json()
  expect(retained.data.current.selection).toBe('unavailable')
  expect(retained.data.payload).toEqual(originalBatch)
  expect(
    await (await page.request.get(`/api/excess-disposition-batches/${batch}/csv`)).text(),
  ).toBe(originalBatchCsv)
  await page.reload()
  await expect(history).toContainText('2 reports')
  await expect(history).toContainText('RETAINED')
  await openSettings(page, 'api-keys')
  await page
    .getByRole('row')
    .filter({ hasText: 'Acknowledgement integration' })
    .getByRole('button', { name: 'Revoke Acknowledgement integration', exact: true })
    .click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'Acknowledgement integration' }),
  ).toContainText('Revoked')
  expect((await request.post(batchApi, { headers, data: input })).status()).toBe(401)
  expect(pageErrors).toEqual([])
})
