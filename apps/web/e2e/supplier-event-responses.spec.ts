import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test.use({ actionTimeout: 15_000 })

test('event supplier responses preserve independent history and current portal authority', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000)
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
from supplier_event_batch_fixture import seed_supplier_event_batch
with psycopg.connect(sys.argv[1]) as db:
 print(json.dumps(seed_supplier_event_batch(db,sys.argv[2],sys.argv[3])))`)
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
    const publishPath = `/replenishment/events/batches/${batch}/publish`
    await page.goto(`/replenishment/events/batches/${batch}`)
    await page.getByRole('link', { name: 'Supplier publication', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Publish event batch to supplier',
    )
    await expect(page.getByRole('table')).toContainText('KG')
    await expect(page.getByRole('table')).toContainText('2026-10-11')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Publish to supplier portal', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Published to supplier portal')
    const feed = await external.rpc('supplier_portal_event_packages', { p_grant_id: grant })
    expect(feed.error).toBeNull()
    expect(feed.data.total).toBe(1)
    const original = feed.data.rows[0]
    expect(original.kind).toBe('batch')
    expect(original.summary.lines).toHaveLength(2)
    const savedBatch = await internal
      .from('event_purchase_handoff_batches')
      .select('payload')
      .eq('id', batch)
      .single()
    expect(savedBatch.error).toBeNull()
    expect(original.summary.subtotal).toBe(savedBatch.data!.payload.summary.subtotal)
    expect(original.overlap_count).toBe(0)
    expect((await external.rpc('supplier_portal_packages', { p_grant_id: grant })).data.total).toBe(
      0,
    )
    expect((await external.from('supplier_event_batch_publications').select('*')).data).toEqual([])
    const detailPath = `/supplier-portal/${grant}/events/${original.id}`
    await supplierPage.goto(`/supplier-portal/${grant}/events`)
    await supplierPage.getByRole('link', { name: 'Inspect summary', exact: true }).click()
    await expect(supplierPage.getByRole('heading', { level: 1 })).toHaveText(
      'Supplier batch planning proposal',
    )
    for (const forbidden of [
      'baseline_subtotal',
      'event_before_receipt',
      'Launch',
      'additional_backorders',
      'policy_id',
      'approval_reason',
      'stock_snapshot',
      handoff,
      batch,
    ])
      expect(await supplierPage.content()).not.toContain(forbidden)
    expect(
      (await supplierPage.request.get(`/api/event-handoff-batches/${batch}/json`)).status(),
    ).not.toBe(200)
    // Only explicitly published packages become overlap evidence.
    const bp = await internal.rpc('supplier_event_batch_publication_preview', {
      p_organization_id: org,
      p_batch_id: overlap,
    })
    expect(bp.error).toBeNull()
    const bpub = await internal.rpc('supplier_event_batch_publication_publish', {
      p_organization_id: org,
      p_batch_id: overlap,
      p_confirmed: true,
      p_fingerprint: bp.data.fingerprint,
    })
    expect(bpub.error).toBeNull()
    const hp = await internal.rpc('supplier_event_publication_preview', {
      p_organization_id: org,
      p_handoff_id: handoff,
    })
    expect(hp.error).toBeNull()
    const hpub = await internal.rpc('supplier_event_publication_publish', {
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
    await expect(supplierPage.getByText('No supplier response recorded.')).toBeVisible()
    await supplierPage.getByLabel('Response', { exact: true }).selectOption('declined')
    await supplierPage.getByRole('button', { name: 'Record response', exact: true }).click()
    expect(
      await supplierPage
        .getByLabel('Reason for declining')
        .evaluate((el) => (el as HTMLTextAreaElement).validity.valueMissing),
    ).toBe(true)
    await supplierPage
      .getByLabel('Reason for declining')
      .fill('Capacity unavailable <script>literal supplier text</script>')
    await supplierPage.getByLabel('Your reference (optional)').fill('SUP-REF')
    await supplierPage.getByRole('button', { name: 'Record response', exact: true }).click()
    const history = supplierPage.getByRole('region', { name: 'Supplier response history' })
    await expect(history).toContainText('Latest: Declined')
    await expect(history).toContainText(
      'Capacity unavailable <script>literal supplier text</script>',
    )
    await expect(supplierPage.getByLabel('Response', { exact: true })).toHaveValue('received')
    await supplierPage.getByRole('button', { name: 'Record response', exact: true }).click()
    await expect(history).toContainText('Latest: Received')
    await expect(history.locator('ol > li')).toHaveCount(2)
    const response = await external.rpc('supplier_event_response_history', {
      p_grant_id: grant,
      p_kind: 'batch',
      p_publication_id: original.id,
    })
    expect(response.error).toBeNull()
    expect(response.data.total).toBe(2)
    expect(response.data.rows[1].reason).toContain('<script>literal supplier text</script>')
    expect(Object.keys(response.data.rows[0]).sort()).toEqual([
      'author',
      'created_at',
      'id',
      'reason',
      'reference',
      'revision',
      'status',
    ])
    expect((await external.from('supplier_event_responses').select('*')).data).toEqual([])
    for (const [kind, id] of [
      ['handoff', hpub.data],
      ['batch', bpub.data],
    ]) {
      const separate = await external.rpc('supplier_event_response_history', {
        p_grant_id: grant,
        p_kind: kind,
        p_publication_id: id,
      })
      expect(separate.error).toBeNull()
      expect(separate.data.total).toBe(0)
    }
    await supplierPage.goto(`/supplier-portal/${grant}/events/${hpub.data}`)
    await supplierPage.getByRole('button', { name: 'Record response', exact: true }).focus()
    await supplierPage.keyboard.press('Enter')
    await expect(
      supplierPage.getByRole('region', { name: 'Supplier response history' }),
    ).toContainText('Latest: Received')
    await page.goto(`/replenishment/events/handoffs/${handoff}/publish`)
    await expect(page.getByRole('region', { name: 'Supplier response history' })).toContainText(
      'Latest: Received',
    )
    await supplierPage.goto(detailPath)
    // Read-only staff can inspect responses but cannot withdraw or submit as a supplier.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    await page.goto(publishPath)
    await expect(page.getByRole('region', { name: 'Supplier response history' })).toContainText(
      'Latest: Received',
    )
    await expect(
      page.getByRole('button', { name: 'Withdraw supplier access', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record response', exact: true })).toHaveCount(0)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))
 db.execute('insert into public.membership_locations values(%s,%s,%s)',('${org}',sys.argv[2],'${prefix}-0000-4000-8000-000000000021'))`)
    expect((await page.goto(publishPath))?.status()).toBe(404)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.membership_locations where organization_id=%s and user_id=%s',('${org}',sys.argv[2]))
 db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
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
          path: info.outputPath(`supplier-portal-event-response-${surface}-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    for (const locale of ['en', 'ar']) {
      await capture(page, publishPath, 'publication', locale)
      await capture(supplierPage, detailPath, 'batch-summary', locale)
      await capture(
        page,
        `/replenishment/events/handoffs/${handoff}/publish`,
        'single-publication',
        locale,
      )
      await capture(
        supplierPage,
        `/supplier-portal/${grant}/events/${hpub.data}`,
        'single-summary',
        locale,
      )
    }
    await supplierPage
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(supplierPage.url()).origin }])
    for (let n = 0; n < 24; n++) {
      expect(
        (
          await external.rpc('supplier_event_response_submit', {
            p_grant_id: grant,
            p_kind: 'batch',
            p_publication_id: original.id,
            p_request_id: randomUUID(),
            p_status: 'received',
          })
        ).error,
      ).toBeNull()
    }
    await supplierPage.goto(detailPath)
    await supplierPage
      .getByRole('navigation', { name: 'Response history pages' })
      .getByRole('link', { name: 'Next', exact: true })
      .click()
    await expect(
      supplierPage.getByRole('region', { name: 'Supplier response history' }).locator('ol > li'),
    ).toHaveCount(1)
    await expect(
      supplierPage.getByRole('region', { name: 'Supplier response history' }),
    ).toContainText('Latest: Received')
    // Copied publication remains readable after current source evidence disappears.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.event_purchase_handoffs where id=%s',('${handoff}',))`)
    const retained = await external.rpc('supplier_portal_event_packages', {
      p_grant_id: grant,
      p_publication_id: original.id,
    })
    expect(retained.data.rows[0].summary).toEqual(original.summary)
    expect(retained.data.rows[0].overlap_count).toBe(1)
    expect(
      (
        await external.rpc('supplier_event_response_history', {
          p_grant_id: grant,
          p_kind: 'batch',
          p_publication_id: original.id,
        })
      ).data.total,
    ).toBe(26)
    expect(
      (
        await internal.rpc('supplier_event_batch_publication_publish', {
          p_organization_id: org,
          p_batch_id: batch,
          p_confirmed: true,
          p_fingerprint: 'old',
        })
      ).data,
    ).toBe(original.id)
    expect(
      (
        await external.rpc('supplier_event_response_submit', {
          p_grant_id: grant,
          p_kind: 'batch',
          p_publication_id: original.id,
          p_request_id: randomUUID(),
          p_status: 'received',
          p_reference: 'RETAINED',
        })
      ).error,
    ).toBeNull()
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(publishPath)
    await page.getByRole('button', { name: 'Withdraw supplier access', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Withdrawn from supplier portal')
    expect((await supplierPage.goto(detailPath))?.status()).toBe(404)
    expect(
      (
        await external.rpc('supplier_event_response_submit', {
          p_grant_id: grant,
          p_kind: 'batch',
          p_publication_id: original.id,
          p_request_id: randomUUID(),
          p_status: 'received',
        })
      ).error?.code,
    ).toBe('MQ404')
    await expect(page.getByRole('region', { name: 'Supplier response history' })).toContainText(
      '27 responses',
    )
    expect(
      (await internal.rpc('supplier_portal_revoke', { p_organization_id: org, p_grant_id: grant }))
        .error,
    ).toBeNull()
    expect((await supplierPage.goto(`/supplier-portal/${grant}`))?.status()).toBe(404)
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
