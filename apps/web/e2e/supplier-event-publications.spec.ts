import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test('event publications share full adjusted selections with revocable isolated supplier access', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000)
  const key = randomUUID(),
    prefix = key.slice(0, 8),
    password = `Event-${key}`
  const ownerEmail = `event-owner-${key}@example.com`,
    supplierEmail = `event-supplier-${key}@example.com`
  const owner = await createConfirmedUser(ownerEmail, password)
  await createConfirmedUser(supplierEmail, password)
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
from supplier_event_fixture import seed_supplier_event
with psycopg.connect(sys.argv[1]) as db:
 print(json.dumps(seed_supplier_event(db,sys.argv[2],sys.argv[3]),default=str))`)
  const [org, other, handoff, supplier] = JSON.parse(seeded.stdout) as string[]
  const context = await browser.newContext(),
    supplierPage = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  supplierPage.on('pageerror', (e) => errors.push(e.message))
  try {
    const internal = await signedInClient(ownerEmail, password),
      external = await signedInClient(supplierEmail, password)
    const invite = await internal.rpc('supplier_portal_invite', {
      p_organization_id: org,
      p_supplier_id: supplier,
      p_email: supplierEmail,
    })
    expect(invite.error).toBeNull()
    const grant = invite.data.id as string
    expect(
      (await external.rpc('supplier_portal_event_publications', { p_grant_id: grant })).error?.code,
    ).toBe('MQ404')
    expect((await external.rpc('supplier_portal_accept', { p_grant_id: grant })).error).toBeNull()
    await signInWithPassword(page, ownerEmail, password)
    await signInWithPassword(supplierPage, supplierEmail, password)
    await supplierPage.goto(`/supplier-portal/${grant}`)
    await supplierPage.getByRole('link', { name: 'Event purchase proposals', exact: true }).click()
    await expect(
      supplierPage.getByText('No event purchase proposals are currently shared.'),
    ).toBeVisible()
    const publishPath = `/replenishment/events/handoffs/${handoff}/publish`
    await page.goto(publishPath)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share event purchase summary')
    const preview = await internal.rpc('supplier_event_publication_preview', {
      p_organization_id: org,
      p_handoff_id: handoff,
    })
    expect(preview.error).toBeNull()
    const full = await internal
      .from('event_purchase_handoffs')
      .select('payload')
      .eq('id', handoff)
      .single()
    expect(full.error).toBeNull()
    expect(preview.data.summary.quantity).toBe(full.data!.payload.estimate.adjusted.quantity)
    expect(preview.data.summary.subtotal).toBe(full.data!.payload.estimate.adjusted.subtotal)
    expect(preview.data.summary.quantity).not.toBe(full.data!.payload.estimate.baseline.quantity)
    const capture = async (target: Page, path: string, surface: string, locale: string) => {
      await target
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(target.url()).origin }])
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await target.setViewportSize({ width, height: 900 })
        await target.goto(path)
        await expect(target.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expectPageTitle(target.getByRole('heading', { level: 1 }))
        if (surface !== 'list') await expectEvidenceValue(target.locator('dd').first())
        await expect
          .poll(() => target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true)
        await target.screenshot({
          path: info.outputPath(`supplier-portal-events-${surface}-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    for (const locale of ['en', 'ar']) await capture(page, publishPath, 'preview', locale)
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(publishPath)
    await page.getByRole('checkbox').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('checkbox')).toBeChecked()
    await page.getByRole('button', { name: 'Publish to supplier portal', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Published to supplier portal')
    const feed = await external.rpc('supplier_portal_event_publications', { p_grant_id: grant })
    expect(feed.error).toBeNull()
    expect(feed.data.total).toBe(1)
    const original = feed.data.rows[0]
    expect(Object.keys(original).sort()).toEqual(['created_at', 'id', 'summary'])
    expect(original.summary).toEqual(preview.data.summary)
    expect(Object.keys(original.summary).sort()).toEqual(
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
    expect(
      (await external.rpc('supplier_portal_publications', { p_grant_id: grant })).data.total,
    ).toBe(0)
    expect((await external.from('supplier_event_publications').select('*')).data).toEqual([])
    expect((await external.from('event_purchase_handoffs').select('*')).data).toEqual([])
    const listPath = `/supplier-portal/${grant}/events`,
      detailPath = `${listPath}/${original.id}`
    await supplierPage.reload()
    await supplierPage.getByRole('link', { name: 'Inspect summary', exact: true }).click()
    await expect(supplierPage.getByRole('heading', { level: 1 })).toHaveText(
      'Supplier planning proposal',
    )
    await expect(
      supplierPage.getByRole('button', { name: 'Record response', exact: true }),
    ).toBeVisible()
    for (const forbidden of [
      'event_before_receipt',
      'Incremental demand',
      'Launch',
      'stock_snapshot',
      handoff,
    ])
      expect(await supplierPage.content()).not.toContain(forbidden)
    for (const locale of ['en', 'ar']) {
      await capture(supplierPage, listPath, 'list', locale)
      await capture(supplierPage, detailPath, 'summary', locale)
    }
    await supplierPage
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(supplierPage.url()).origin }])
    await supplierPage.setViewportSize({ width: 375, height: 900 })
    await supplierPage.goto(listPath)
    const region = supplierPage.getByRole('region', { name: 'Event purchase proposals' })
    await region.focus()
    await supplierPage.keyboard.press('ArrowRight')
    await expect(region).toBeFocused()
    // Later price changes cannot rewrite an already published copy.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('update public.supplier_items set unit_price=9 where organization_id=%s',('${org}',))
 db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    await page.goto(publishPath)
    await expect(page.getByRole('status')).toHaveText('Published to supplier portal')
    await expect(
      page.getByRole('button', { name: 'Withdraw supplier access', exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await internal.rpc('supplier_event_publication_publish', {
          p_organization_id: org,
          p_handoff_id: handoff,
          p_confirmed: true,
          p_fingerprint: 'old',
        })
      ).error?.code,
    ).toBe('MQ403')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))
 db.execute('insert into public.membership_locations values(%s,%s,%s)',('${org}',sys.argv[2],'${prefix}-0000-4000-8000-000000000021'))`)
    expect((await page.goto(publishPath))?.status()).toBe(404)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s',('${org}',sys.argv[2]))
 db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    const retry = () =>
      internal.rpc('supplier_event_publication_publish', {
        p_organization_id: org,
        p_handoff_id: handoff,
        p_confirmed: true,
        p_fingerprint: 'old',
      })
    expect((await retry()).data).toBe(original.id)
    expect(
      (await external.rpc('supplier_portal_event_publications', { p_grant_id: grant })).data.rows[0]
        .summary,
    ).toEqual(original.summary)
    await page.goto(publishPath)
    await page.getByRole('button', { name: 'Withdraw supplier access', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Withdrawn from supplier portal')
    expect((await retry()).data).toBe(original.id)
    expect((await supplierPage.goto(detailPath))?.status()).toBe(404)
    expect(
      (await external.rpc('supplier_portal_event_publications', { p_grant_id: grant })).data.total,
    ).toBe(0)
    expect(
      (await internal.rpc('supplier_portal_revoke', { p_organization_id: org, p_grant_id: grant }))
        .error,
    ).toBeNull()
    expect((await supplierPage.goto(listPath))?.status()).toBe(404)
    expect(
      (await external.rpc('supplier_portal_event_publications', { p_grant_id: grant })).error?.code,
    ).toBe('MQ404')
    expect(errors).toEqual([])
  } finally {
    await context.close().catch(() => {})
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=any(%s::uuid[])',(['${org}','${other}'],))
 db.execute('delete from auth.users where id=%s or id::text like %s or email=%s',(sys.argv[2],sys.argv[3]+'-0000-4000-8000-%','${supplierEmail}'))
 db.execute('delete from public.audit_log where organization_id=any(%s::uuid[])',(['${org}','${other}'],))`)
  }
})
