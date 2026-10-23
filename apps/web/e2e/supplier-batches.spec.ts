import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test('supplier batch publication keeps exact lines, scoped overlap and copied history', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000)
  const key = randomUUID(),
    prefix = key.slice(0, 8),
    password = `Batch-${key}`
  const ownerEmail = `batch-owner-${key}@example.com`,
    supplierEmail = `batch-supplier-${key}@example.com`
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
from supplier_batch_portal_fixture import seed_supplier_batch_portal
with psycopg.connect(sys.argv[1]) as db:
 print(json.dumps(seed_supplier_batch_portal(db,sys.argv[2],sys.argv[3])))`)
  const { org, other, handoff, supplier, batch, overlap } = JSON.parse(seeded.stdout) as Record<
    string,
    string
  >
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
    expect((await external.rpc('supplier_portal_accept', { p_grant_id: grant })).error).toBeNull()
    await signInWithPassword(page, ownerEmail, password)
    await signInWithPassword(supplierPage, supplierEmail, password)
    await supplierPage.goto(`/supplier-portal/${grant}`)
    await expect(supplierPage.getByText('No proposals are currently shared.')).toBeVisible()
    const publishPath = `/replenishment/batches/${batch}/publish`
    await page.goto(`/replenishment/batches/${batch}`)
    await page.getByRole('link', { name: 'Share supplier batch summary', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share supplier batch summary')
    await expect(page.getByRole('table')).toContainText('KG')
    await expect(page.getByRole('table')).toContainText('2026-10-15')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Publish to supplier portal', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Published to supplier portal')
    const feed = await external.rpc('supplier_portal_publications', { p_grant_id: grant })
    expect(feed.error).toBeNull()
    expect(feed.data.total).toBe(1)
    const original = feed.data.rows[0]
    expect(original.kind).toBe('batch')
    expect(original.summary.lines).toHaveLength(2)
    expect(original.summary.subtotal).toBe('30.15')
    expect(original.overlap_count).toBe(0)
    expect((await external.rpc('supplier_portal_packages', { p_grant_id: grant })).data.total).toBe(
      0,
    )
    expect((await external.from('supplier_batch_publications').select('*')).data).toEqual([])
    const detailPath = `/supplier-portal/${grant}/${original.id}`
    await supplierPage.reload()
    await supplierPage.getByRole('link', { name: 'Inspect summary', exact: true }).click()
    await expect(supplierPage.getByRole('heading', { level: 1 })).toHaveText(
      'Supplier batch planning proposal',
    )
    for (const forbidden of [
      'additional_backorders',
      'policy_id',
      'approval_reason',
      'stock_snapshot',
      handoff,
      batch,
    ])
      expect(await supplierPage.content()).not.toContain(forbidden)
    expect(
      (await supplierPage.request.get(`/api/handoff-batches/${batch}/json`)).status(),
    ).not.toBe(200)
    // Only explicitly published packages become overlap evidence.
    const bp = await internal.rpc('supplier_batch_publication_preview', {
      p_organization_id: org,
      p_batch_id: overlap,
    })
    expect(bp.error).toBeNull()
    const bpub = await internal.rpc('supplier_batch_publication_publish', {
      p_organization_id: org,
      p_batch_id: overlap,
      p_confirmed: true,
      p_fingerprint: bp.data.fingerprint,
    })
    expect(bpub.error).toBeNull()
    const hp = await internal.rpc('supplier_publication_preview', {
      p_organization_id: org,
      p_handoff_id: handoff,
    })
    expect(hp.error).toBeNull()
    const hpub = await internal.rpc('supplier_publication_publish', {
      p_organization_id: org,
      p_handoff_id: handoff,
      p_confirmed: true,
      p_fingerprint: hp.data.fingerprint,
    })
    expect(hpub.error).toBeNull()
    await supplierPage.reload()
    await expect(
      supplierPage.getByRole('region', { name: 'Overlapping packages' }).getByRole('link'),
    ).toHaveCount(2)
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
          path: info.outputPath(`supplier-portal-batch-${surface}-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    for (const locale of ['en', 'ar']) {
      await capture(page, publishPath, 'publication', locale)
      await capture(supplierPage, detailPath, 'summary', locale)
      await capture(supplierPage, `/supplier-portal/${grant}`, 'list', locale)
    }
    // Copied publication remains readable after current source evidence disappears.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.purchase_handoffs where id=%s',('${handoff}',))`)
    const retained = await external.rpc('supplier_portal_publications', {
      p_grant_id: grant,
      p_publication_id: original.id,
    })
    expect(retained.data.rows[0].summary).toEqual(original.summary)
    expect(retained.data.rows[0].overlap_count).toBe(1)
    expect(
      (
        await internal.rpc('supplier_batch_publication_publish', {
          p_organization_id: org,
          p_batch_id: batch,
          p_confirmed: true,
          p_fingerprint: 'old',
        })
      ).data,
    ).toBe(original.id)
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(publishPath)
    await page.getByRole('button', { name: 'Withdraw supplier access', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Withdrawn from supplier portal')
    expect((await supplierPage.goto(detailPath))?.status()).toBe(404)
    expect(
      (await internal.rpc('supplier_portal_revoke', { p_organization_id: org, p_grant_id: grant }))
        .error,
    ).toBeNull()
    expect((await supplierPage.goto(`/supplier-portal/${grant}`))?.status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=any(%s::uuid[])',(['${org}','${other}'],))
 db.execute('delete from auth.users where id=%s or id::text like %s or email=%s',(sys.argv[2],sys.argv[3]+'-0000-4000-8000-%','${supplierEmail}'))
 db.execute('delete from public.audit_log where organization_id=any(%s::uuid[])',(['${org}','${other}'],))`)
  }
})
