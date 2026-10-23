import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { waitForEmailLink } from './helpers/mailpit'
import { expectPageTitle } from './helpers/typography'

test('supplier invitations, allowlisted publication, live withdrawal and revocation stay separate from staff access', async ({
  page,
  browser,
  request,
}, info) => {
  test.setTimeout(360_000)
  const key = randomUUID(),
    prefix = key.slice(0, 8),
    password = `Portal-${key}`
  const ownerEmail = `portal-owner-${key}@example.com`,
    supplierEmail = `portal-supplier-${key}@example.com`
  const existingEmail = `portal-existing-${key}@example.com`
  const owner = await createConfirmedUser(ownerEmail, password)
  await createConfirmedUser(existingEmail, password)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, owner, prefix], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60_000,
    })
  const seeded = await python(`import sys,json,psycopg
sys.path.insert(0,'tests')
from supplier_portal_fixture import seed_supplier_portal
with psycopg.connect(sys.argv[1]) as db:
    org,other,handoff,supplier=seed_supplier_portal(db,sys.argv[2],sys.argv[3])
    print(json.dumps(dict(org=str(org),other=str(other),handoff=str(handoff),supplier=str(supplier))))`)
  const { org, other, handoff } = JSON.parse(seeded.stdout) as Record<string, string>
  const context = await browser.newContext(),
    supplierPage = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  supplierPage.on('pageerror', (e) => errors.push(e.message))
  try {
    await signInWithPassword(page, ownerEmail, password)
    await page.goto(`/suppliers/portal-access?supplier=SUP`)
    const invite = page.getByRole('form', { name: 'Invite supplier user' })
    await invite.getByLabel('Email', { exact: true }).fill(supplierEmail)
    await invite.getByRole('button', { name: 'Invite supplier user', exact: true }).click()
    await expect(invite.getByRole('alert')).toContainText('Supplier invitation sent.')
    const link = await waitForEmailLink(
      request,
      supplierEmail,
      /\/auth\/(?:invite\?|email\/supplier-portal\/)/,
    )
    await supplierPage.goto(link)
    await supplierPage.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await supplierPage.waitForURL(/\/auth\/set-password/)
    await supplierPage.getByLabel('New password', { exact: true }).fill(password)
    await supplierPage.getByRole('button', { name: 'Save password', exact: true }).click()
    await supplierPage.waitForURL(/\/supplier-portal\/[0-9a-f-]{36}$/)
    const grant = new URL(supplierPage.url()).pathname.split('/').at(-1)!
    await supplierPage.getByRole('button', { name: 'Accept supplier access', exact: true }).click()
    await expect(supplierPage.getByText('No proposals are currently shared.')).toBeVisible()
    const loginContext = await browser.newContext()
    try {
      const loginPage = await loginContext.newPage()
      await signInWithPassword(loginPage, supplierEmail, password)
      await expect(loginPage).toHaveURL(/\/supplier-portal$/)
    } finally {
      await loginContext.close()
    }
    const client = await signedInClient(supplierEmail, password)
    expect((await client.from('memberships').select('organization_id')).data).toEqual([])
    for (const table of [
      'stock_snapshots',
      'purchase_handoffs',
      'supplier_publications',
      'supplier_portal_grants',
    ]) {
      const rows = await client.from(table).select('*')
      expect(rows.error).toBeNull()
      expect(rows.data).toEqual([])
    }
    // Preview is the actual allowlist that will be published.
    const publishPath = `/replenishment/handoffs/${handoff}/publish`
    await page.goto(publishPath)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share supplier summary')
    await expect(page.getByText('1.005', { exact: true })).toBeVisible()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Publish to supplier portal', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Published to supplier portal')
    await supplierPage.reload()
    await supplierPage.getByRole('link', { name: 'Inspect summary', exact: true }).click()
    await supplierPage.waitForURL(/\/supplier-portal\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
    const detailPath = new URL(supplierPage.url()).pathname
    await expect(supplierPage.getByRole('heading', { level: 1 })).toHaveText(
      'Supplier planning proposal',
    )
    const response = await client.rpc('supplier_portal_packages', { p_grant_id: grant })
    expect(response.error).toBeNull()
    const record = response.data.rows[0]
    expect(Object.keys(record).sort()).toEqual(['created_at', 'id', 'summary'])
    expect(Object.keys(record.summary).sort()).toEqual(
      [
        'schema_version',
        'purpose',
        'item_code',
        'supplier_code',
        'location_code',
        'quantity',
        'unit',
        'order_date',
        'receipt_date',
        'unit_price',
        'currency',
        'subtotal',
      ].sort(),
    )
    expect(record.summary).toMatchObject({
      purpose: 'planning_only',
      unit_price: '1.005',
      subtotal: '12.06',
      unit: 'EA',
    })
    expect(Number(record.summary.quantity)).toBe(12)
    const html = await supplierPage.content()
    for (const forbidden of [
      'additional_backorders',
      'policy_id',
      'approval_reason',
      'stock_snapshot',
      handoff,
    ])
      expect(html).not.toContain(forbidden)
    expect(
      (await client.rpc('supplier_portal_packages', { p_grant_id: randomUUID() })).error?.code,
    ).toBe('MQ404')
    expect(
      (await supplierPage.request.get(`/api/purchase-handoffs/${handoff}/json`)).status(),
    ).not.toBe(200)
    // Current evidence changes do not rewrite a published snapshot.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.supplier_items set unit_price=99 where organization_id=%s',('${org}',))`)
    expect(
      (await client.rpc('supplier_portal_packages', { p_grant_id: grant })).data.rows[0],
    ).toEqual(record)
    // Both supplier and internal surfaces retain shared typography and fit all five viewports.
    const capture = async (target: Page, path: string, surface: string, locale: string) => {
      await target
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(target.url()).origin }])
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await target.setViewportSize({ width, height: 900 })
        await target.goto(path)
        await expect(target.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expectPageTitle(target.getByRole('heading', { level: 1 }))
        await expect
          .poll(() => target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true)
        await target.screenshot({
          path: info.outputPath(`supplier-portal-${surface}-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    for (const locale of ['en', 'ar']) {
      await capture(supplierPage, detailPath, 'summary', locale)
      await capture(supplierPage, `/supplier-portal/${grant}`, 'list', locale)
      await capture(page, '/suppliers/portal-access', 'access', locale)
      await capture(page, publishPath, 'publication', locale)
    }
    // A supplier can choose Arabic without an internal organization membership.
    await supplierPage
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(supplierPage.url()).origin }])
    await supplierPage.goto(detailPath)
    await supplierPage.getByRole('radio', { name: 'العربية', exact: true }).click()
    await expect(supplierPage.locator('html')).toHaveAttribute('dir', 'rtl')
    await supplierPage.getByRole('radio', { name: 'English', exact: true }).click()
    await expect(supplierPage.locator('html')).toHaveAttribute('dir', 'ltr')
    await supplierPage.setViewportSize({ width: 375, height: 900 })
    const toggle = supplierPage.getByRole('button', { name: 'Toggle sidebar', exact: true })
    await toggle.focus()
    await supplierPage.keyboard.press('Enter')
    await expect(supplierPage.getByRole('dialog')).toBeVisible()
    await expect(
      supplierPage.getByRole('dialog').getByRole('link', { name: 'Supplier portal', exact: true }),
    ).toBeVisible()
    await expect(
      supplierPage.getByRole('dialog').getByRole('link', { name: 'Items', exact: true }),
    ).toHaveCount(0)
    await supplierPage.keyboard.press('Escape')
    await expect(supplierPage.getByRole('dialog')).toHaveCount(0)
    // Existing accounts receive an email link as well, with no invitation into the staff organization.
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto('/suppliers/portal-access?supplier=SUP')
    await invite.getByLabel('Email', { exact: true }).fill(existingEmail)
    await invite.getByRole('button', { name: 'Invite supplier user', exact: true }).click()
    await expect(invite.getByRole('alert')).toContainText('Supplier invitation sent.')
    const magicLink = await waitForEmailLink(request, existingEmail, /\/auth\/(?:confirm|email)/)
    const existingContext = await browser.newContext()
    try {
      const existingPage = await existingContext.newPage()
      await existingPage.goto(magicLink)
      await existingPage
        .getByRole('button', { name: 'Accept supplier access', exact: true })
        .click()
      await expect(
        existingPage.getByRole('link', { name: 'Inspect summary', exact: true }),
      ).toBeVisible()
    } finally {
      await existingContext.close()
    }

    const existing = await signedInClient(existingEmail, password)
    const access = await existing.rpc('my_supplier_portals')
    expect(access.data).toHaveLength(1)
    expect(
      (await existing.rpc('supplier_portal_accept', { p_grant_id: access.data[0].id })).error,
    ).toBeNull()
    expect((await existing.from('memberships').select('organization_id')).data).toEqual([])
    // Withdrawal hides a publication from every supplier grant immediately on subsequent requests.
    await page.goto(publishPath)
    await page.getByRole('button', { name: 'Withdraw supplier access', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Withdrawn from supplier portal')
    expect((await client.rpc('supplier_portal_packages', { p_grant_id: grant })).data.total).toBe(0)
    expect((await supplierPage.goto(detailPath))?.status()).toBe(404)
    await page.goto('/suppliers/portal-access')
    await page
      .getByRole('row')
      .filter({ hasText: supplierEmail })
      .getByRole('button', { name: 'Revoke access', exact: true })
      .click()
    await expect(page.getByRole('row').filter({ hasText: supplierEmail })).toContainText('Revoked')
    expect((await client.rpc('supplier_portal_packages', { p_grant_id: grant })).error?.code).toBe(
      'MQ404',
    )
    expect((await supplierPage.goto(`/supplier-portal/${grant}`))?.status()).toBe(404)
    expect((await client.rpc('my_supplier_portals')).data).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=any(%s::uuid[])',(['${org}','${other}'],))
    db.execute('delete from auth.users where id=%s or id::text like %s or email=any(%s)',(sys.argv[2],sys.argv[3]+'-0000-4000-8000-%',['${supplierEmail}','${existingEmail}']))
    db.execute('delete from public.audit_log where organization_id=any(%s::uuid[])',(['${org}','${other}'],))`)
  }
})
