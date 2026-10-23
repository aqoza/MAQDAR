import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { seedRegionalHandoffs } from './helpers/regional-handoffs'
import { signInWithPassword, signedInClient } from './helpers/auth'
import { openSettings } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle } from './helpers/typography'

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

test('regional reports retain independent history, all-location access and immutable copied evidence', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(360_000)
  const {
    org,
    parent,
    ids,
    batch,
    original,
    individual,
    editorClient,
    approve,
    python,
    branchEmail,
    password,
    cleanup,
    region,
  } = await seedRegionalHandoffs(page)
  try {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
    await openSettings(page, 'api-keys')
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.reload()
      await selectSettingsSection(page, 'api-keys')
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        await expectPermissionTextFits(page)
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(`regional-reporter-settings-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await selectSettingsSection(page, 'api-keys')
    const permission = page.getByLabel('Report regional package receipt or rejection', {
      exact: true,
    })
    await expect(permission).not.toBeChecked()
    await permission.focus()
    await page.keyboard.press('Space')
    await expect(permission).toBeChecked()
    await page.getByLabel('Read regional handoffs', { exact: true }).check()
    await page.getByLabel('Key name', { exact: true }).fill('Regional reporter')
    await page.getByRole('button', { name: 'Create key', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const headers = { Authorization: `Bearer ${token}` }
    const single = `/api/v1/regional-handoffs/${ids[0]}/acknowledgements`
    const batches = `/api/v1/regional-handoff-batches/${batch}/acknowledgements`
    const body = {
      client_event_id: randomUUID(),
      external_system: 'Warehouse ERP',
      external_reference: '0000123',
      status: 'received',
    }
    expect((await page.request.post(single, { data: body })).status()).toBe(401)
    const created = await request.post(single, { headers, data: body })
    expect(created.status(), await created.text()).toBe(201)
    expect(created.headers()['cache-control']).toContain('no-store')
    expect(created.headers()['set-cookie']).toBeUndefined()
    const first = await created.json()
    expect(first.replayed).toBe(false)
    expect(
      (await (await request.get(created.headers().location, { headers })).json()).data,
    ).toEqual(first.data)
    expect((await request.head(created.headers().location, { headers })).status()).toBe(200)
    const retry = await request.post(single, { headers, data: { ...body, reason: null } })
    expect(retry.status()).toBe(200)
    expect(await retry.json()).toEqual({ data: first.data, replayed: true })
    expect((await request.post(batches, { headers, data: body })).status()).toBe(409)
    expect(
      (
        await request.post(single, { headers, data: { ...body, external_reference: 'changed' } })
      ).status(),
    ).toBe(409)
    expect(
      (
        await request.post(single, {
          headers,
          data: { ...body, client_event_id: randomUUID(), status: 'rejected' },
        })
      ).status(),
    ).toBe(422)
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect((await request.fetch(created.headers().location, { method, headers })).status()).toBe(
        405,
      )
    for (let n = 0; n < 20; n++) {
      const response = await request.post(single, {
        headers,
        data: { ...body, client_event_id: randomUUID(), external_reference: `report-${n}` },
      })
      expect(response.status(), await response.text()).toBe(201)
    }
    const rejection = {
      ...body,
      client_event_id: randomUUID(),
      status: 'rejected',
      reason: 'Destination identifier needs mapping. '.repeat(10),
    }
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(201)
    expect((await (await request.get(batches, { headers })).json()).data).toHaveLength(1)
    const overlap = await editorClient.rpc('regional_handoff_batch_create', {
      p_organization_id: org,
      p_handoff_ids: [ids[1]],
    })
    expect(overlap.error).toBeNull()
    for (const path of [
      `/api/v1/regional-handoff-batches/${overlap.data}/acknowledgements`,
      `/api/v1/regional-handoffs/${ids[1]}/acknowledgements`,
    ])
      expect((await (await request.get(path, { headers })).json()).data).toEqual([])
    const firstPage = await (await request.get(`${single}?limit=20`, { headers })).json()
    expect(firstPage.data).toHaveLength(20)
    expect(
      (
        await (
          await request.get(single, { headers, params: { cursor: firstPage.next_cursor } })
        ).json()
      ).data,
    ).toHaveLength(1)
    expect(
      (await request.get(batches, { headers, params: { cursor: firstPage.next_cursor } })).status(),
    ).toBe(400)

    const branchClient = await signedInClient(branchEmail, password)
    expect(
      (
        await branchClient
          .from('regional_handoff_acknowledgements')
          .select('id', { count: 'exact' })
      ).count,
    ).toBe(0)
    const branchPage = await browser.newPage()
    await signInWithPassword(branchPage, branchEmail, password)
    for (const path of [
      `/replenishment/regional-stock/sourcing/handoffs/${ids[0]}`,
      `/replenishment/regional-stock/sourcing/batches/${batch}`,
    ]) {
      const response = await branchPage.goto(path)
      expect(response?.status()).toBe(404)
      await expect(branchPage.locator('#acknowledgements')).toHaveCount(0)
    }
    await branchPage.close()
    // The omitted branch has zero allocation and is still required for history.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='SOURCE-A'",(sys.argv[5],sys.argv[2]))`)
    expect(
      (
        await branchClient
          .from('regional_handoff_acknowledgements')
          .select('id', { count: 'exact' })
      ).count,
    ).toBe(22)

    await page.goto(`/replenishment/regional-stock/sourcing/handoffs/${ids[0]}`)
    await expect(page.locator('#acknowledgements li')).toHaveCount(20)
    await page
      .locator('#acknowledgements')
      .getByRole('link', { name: 'Older reports', exact: true })
      .click()
    await expect(page.locator('#acknowledgements li')).toHaveCount(1)
    await expect(page.locator('#acknowledgements')).toContainText('0000123')

    // Historical packages remain eligible and original files never absorb reports.
    await approve()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.stock_regions set archived_at=clock_timestamp(),archived_by=%s where id=%s",(sys.argv[3],'${region}'))
    db.execute('delete from public.stock_regions where id=%s',('${region}',))`)
    expect(
      (
        await request.post(single, { headers, data: { ...body, client_event_id: randomUUID() } })
      ).status(),
    ).toBe(201)
    expect(await (await page.request.get(`/api/regional-handoffs/${ids[0]}/json`)).json()).toEqual(
      individual,
    )
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.regional_sourcing_scenarios where organization_id=%s and id=%s',(sys.argv[2],'${parent}'))`)
    expect((await request.get(single, { headers })).status()).toBe(404)
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(200)
    expect(
      (
        await request.post(batches, { headers, data: { ...body, client_event_id: randomUUID() } })
      ).status(),
    ).toBe(201)
    expect(await (await page.request.get(`/api/regional-batches/${batch}/json`)).json()).toEqual(
      original,
    )

    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto(`/replenishment/regional-stock/sourcing/batches/${batch}`)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(page.locator('#acknowledgements li')).toHaveCount(2)
      if (locale === 'ar') {
        await expect(page.locator('#acknowledgements')).toContainText('إقرارات التكامل')
        await expect(page.locator('#acknowledgements')).toContainText('أُبلغ عن الرفض')
        await expect(page.locator('#acknowledgements')).not.toContainText('Reported rejected')
      }
      await expect(page.locator('#acknowledgements')).toContainText(rejection.reason.trim())
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true)
        await page
          .locator('#acknowledgements')
          .screenshot({ path: testInfo.outputPath(`regional-reports-${locale}-${width}.png`) })
      }
    }
    // Revocation is enforced for a byte-identical retry as well as history reads.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.api_keys set revoked_at=clock_timestamp() where organization_id=%s and name='Regional reporter'",(sys.argv[2],))`)
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(401)
    expect((await request.get(batches, { headers })).status()).toBe(401)
    expect(errors).toEqual([])
  } finally {
    await cleanup()
  }
})
