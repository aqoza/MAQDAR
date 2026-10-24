import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { expectPageTitle } from './helpers/typography'

test.use({ actionTimeout: 15_000 })
test('internal event supplier workbench separates responses, withdrawal and retained packages', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const key = randomUUID(),
    prefix = key.slice(0, 8),
    password = `Workbench-${key}`
  const ownerEmail = `workbench-${key}@example.com`,
    supplierEmail = `workbench-supplier-${key}@example.com`
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
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
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
    const publications: Record<string, string> = {}
    for (const [name, kind, id] of [
      ['single', 'handoff', handoff],
      ['batch', 'batch', batch],
      ['overlap', 'batch', overlap],
    ] as const) {
      const preview = await internal.rpc(
        kind === 'batch'
          ? 'supplier_event_batch_publication_preview'
          : 'supplier_event_publication_preview',
        {
          p_organization_id: org,
          ...(kind === 'batch' ? { p_batch_id: id } : { p_handoff_id: id }),
        },
      )
      expect(preview.error).toBeNull()
      const pub = await internal.rpc(
        kind === 'batch'
          ? 'supplier_event_batch_publication_publish'
          : 'supplier_event_publication_publish',
        {
          p_organization_id: org,
          ...(kind === 'batch' ? { p_batch_id: id } : { p_handoff_id: id }),
          p_confirmed: true,
          p_fingerprint: preview.data.fingerprint,
        },
      )
      expect(pub.error).toBeNull()
      publications[name] = pub.data
    }
    for (const [kind, pub, status, reason, reference] of [
      ['handoff', publications.single, 'declined', 'Separate item response', 'SINGLE'],
      ['batch', publications.batch, 'declined', 'Earlier capacity concern', 'OLD'],
      ['batch', publications.batch, 'received', '', 'LATEST'],
    ] as const) {
      expect(
        (
          await external.rpc('supplier_event_response_submit', {
            p_grant_id: grant,
            p_kind: kind,
            p_publication_id: pub,
            p_request_id: randomUUID(),
            p_status: status,
            p_reason: reason,
            p_reference: reference,
          })
        ).error,
      ).toBeNull()
    }
    expect(
      (
        await internal.rpc('supplier_event_batch_publication_withdraw', {
          p_organization_id: org,
          p_publication_id: publications.batch,
        })
      ).error,
    ).toBeNull()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    const ordinary = await internal.rpc('supplier_response_workbench', { p_organization_id: org })
    expect(ordinary.error).toBeNull()
    expect(ordinary.data.total).toBe(0)
    await signInWithPassword(page, ownerEmail, password)
    const path = '/replenishment/events/supplier-responses'
    await page.goto('/replenishment/events/handoffs')
    await page.getByRole('link', { name: 'Event supplier responses', exact: true }).click()
    const table = page.getByRole('table'),
      rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(3)
    await expect(table).toContainText('No response')
    await expect(table).toContainText(supplierEmail)
    await expect(table).not.toContainText('Earlier capacity concern')
    await page
      .getByRole('combobox', { name: 'Latest response', exact: true })
      .selectOption('declined')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(rows).toHaveCount(1)
    await expect(table).toContainText('Individual handoff')
    await table.getByText('Decline reason', { exact: true }).click()
    await expect(table).toContainText('Separate item response')
    await page.getByRole('link', { name: 'Clear filters', exact: true }).click()
    await expect(page).toHaveURL(/\/supplier-responses$/)
    await expect(page.getByRole('combobox', { name: 'Latest response', exact: true })).toHaveValue(
      '',
    )
    await expect(rows).toHaveCount(3)
    await page
      .getByRole('combobox', { name: 'Publication state', exact: true })
      .selectOption('withdrawn')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(rows).toHaveCount(1)
    await expect(table).toContainText('Received')
    await expect(table).toContainText('LATEST')
    await table.getByRole('link', { name: 'Summary and history' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Publish event batch to supplier',
    )
    await expect(page.getByRole('region', { name: 'Supplier response history' })).toContainText(
      'Earlier capacity concern',
    )
    await expect(
      page.getByRole('button', { name: 'Withdraw supplier access', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('link', { name: 'Event supplier responses', exact: true }).click()
    await page.getByLabel('Search publications and latest responses').fill('NO-SUCH-ITEM')
    await page.getByLabel('Search publications and latest responses').press('Enter')
    await expect(page.getByText('No publications match these filters.')).toBeVisible()
    await page.getByRole('link', { name: 'Clear filters', exact: true }).click()
    await expect(page).toHaveURL(/\/supplier-responses$/)
    await expect(page.getByRole('combobox', { name: 'Latest response', exact: true })).toHaveValue(
      '',
    )
    await expect(rows).toHaveCount(3)
    // Captured summaries and batch histories survive deletion of their original member handoff.
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.event_purchase_handoffs where id=%s',('${handoff}',))`)
    await page.goto(path)
    await expect(rows).toHaveCount(2)
    await page
      .getByRole('combobox', { name: 'Latest response', exact: true })
      .selectOption('no_response')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(rows).toHaveCount(1)
    await expect(table).not.toContainText('LATEST')
    await page.goto(`${path}?state=withdrawn`)
    await table.getByRole('link', { name: 'Summary and history' }).click()
    await expect(page.getByRole('region', { name: 'Supplier response history' })).toContainText(
      'Earlier capacity concern',
    )
    await expect(page.getByRole('table').first()).toContainText('KG')
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path)
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page
          .getByRole('region', {
            name:
              locale === 'en'
                ? 'Event supplier publication responses'
                : 'ردود منشورات موردي الأحداث',
            exact: true,
          })
          .focus()
        await expect(
          page.getByRole('region', {
            name:
              locale === 'en'
                ? 'Event supplier publication responses'
                : 'ردود منشورات موردي الأحداث',
            exact: true,
          }),
        ).toBeFocused()
        await page.screenshot({
          path: info.outputPath(`supplier-portal-event-workbench-${locale}-${width}.png`),
          fullPage: true,
        })
        const region = page.getByRole('region', {
          name:
            locale === 'en' ? 'Event supplier publication responses' : 'ردود منشورات موردي الأحداث',
          exact: true,
        })
        if (await region.evaluate((el) => el.scrollWidth > el.clientWidth)) {
          await region.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
          await expect
            .poll(() => region.evaluate((el) => Math.abs(el.scrollLeft)))
            .toBeGreaterThan(0)
        }
      }
    }
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",('${org}',sys.argv[2]))`)
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(path)
    await expect(rows).toHaveCount(0)
    expect((await page.goto(`/replenishment/events/batches/${batch}/publish`))?.status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=any(%s::uuid[])',(['${org}','${other}'],))
 db.execute('delete from auth.users where id=%s or id::text like %s or email=%s',(sys.argv[2],sys.argv[3]+'-0000-4000-8000-%','${supplierEmail}'))
 db.execute('delete from public.audit_log where organization_id=any(%s::uuid[])',(['${org}','${other}'],))`)
  }
})
