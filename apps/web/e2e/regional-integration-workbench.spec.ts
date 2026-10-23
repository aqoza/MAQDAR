import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { seedRegionalHandoffs } from './helpers/regional-handoffs'
import { signInWithPassword } from './helpers/auth'
import { expectPageTitle } from './helpers/typography'
import { generateApiKey } from '../src/lib/api/keys'

test('regional workbench keeps whole-package reports, all-location access and retained copied evidence', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(360_000)
  page.setDefaultTimeout(30_000)
  const {
    key: seedKey,
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
    region,
    cleanup,
  } = await seedRegionalHandoffs(page)
  try {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const base = '/replenishment/regional-stock/sourcing/integrations'
    const applyFilters = async (expected: Record<string, string>) => {
      await page.getByRole('button', { name: 'Apply filters' }).click()
      // Different filters can produce the same row count. Wait for the form navigation
      // to commit before editing the next form, whose default values come from the URL.
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === base &&
          Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value),
        { timeout: 30_000 },
      )
    }
    const overlapResult = await editorClient.rpc('regional_handoff_batch_create', {
      p_organization_id: org,
      p_handoff_ids: [ids[0]],
    })
    expect(overlapResult.error).toBeNull()
    const overlap = overlapResult.data as string
    const originalCsv = await (await page.request.get(`/api/regional-batches/${batch}/csv`)).text()
    const key = await generateApiKey()
    expect(
      (
        await editorClient.rpc('create_api_key', {
          p_organization_id: org,
          p_name: 'Regional workbench reporter',
          p_scopes: ['regional_handoffs:acknowledge'],
          p_expires_in_days: 30,
          p_key_hash: key.hash,
          p_display_prefix: key.displayPrefix,
          p_last4: key.last4,
        })
      ).error,
    ).toBeNull()
    const report = async (
      system: string,
      reference: string,
      status = 'received',
      reason: string | null = null,
      record = ids[0],
    ) => {
      const resource = [batch, overlap].includes(record)
        ? 'regional-handoff-batches'
        : 'regional-handoffs'
      const response = await request.post(`/api/v1/${resource}/${record}/acknowledgements`, {
        headers: { Authorization: `Bearer ${key.token}` },
        data: {
          client_event_id: randomUUID(),
          external_system: system,
          external_reference: reference,
          status,
          reason,
        },
      })
      expect(response.status(), await response.text()).toBe(201)
    }
    await report('ERP', 'old-reference', 'rejected', 'Superseded rejection')
    await report('ERP', 'latest-reference')
    await report('erp', 'case-reference', 'rejected', 'Case-sensitive rejection')
    await report(' ERP ', 'space-reference', 'rejected', 'Branch mapping <script>alert(1)</script>')
    await report('ERP', 'batch-' + 'X'.repeat(194), 'rejected', 'Batch mapping missing', batch)

    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
    await page.goto('/replenishment/regional-stock/sourcing')
    await page.getByRole('link', { name: 'Regional integrations', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Regional integration workbench',
    )
    const otherWorkbenches = page.getByText('Other integration workbenches', { exact: true })
    await otherWorkbenches.focus()
    await page.keyboard.press('Enter')
    await expect(
      page
        .getByRole('navigation', { name: 'Other integration workbenches' })
        .getByRole('link', { name: 'Purchase integration workbench', exact: true }),
    ).toBeVisible()
    await otherWorkbenches.focus()
    await page.keyboard.press('Enter')
    // React streaming may retain hidden payload copies; assertions inspect the rendered UI.
    const rows = page.locator('tbody tr:visible')
    await expect(rows).toHaveCount(6)
    await expect(rows.filter({ hasText: 'old-reference' })).toHaveCount(0)
    await expect(rows.filter({ hasText: 'latest-reference' })).toContainText('Reported received')
    await expect(rows.filter({ hasText: 'case-reference' })).toContainText('Reported rejected')
    await expect(rows.filter({ hasText: 'No report' })).toHaveCount(2)
    await expect(rows.filter({ hasText: 'space-reference' })).toContainText(
      'Branch mapping <script>alert(1)</script>',
    )
    expect(await page.locator('tbody script').count()).toBe(0)
    await page.getByLabel('Included source code', { exact: true }).fill('SOURCE-A')
    await page.getByLabel('Receiving location code', { exact: true }).fill('DEST')
    await applyFilters({ location: 'DEST', source: 'SOURCE-A' })
    await expect(rows).toHaveCount(6)
    await page
      .getByRole('combobox', { name: 'Latest reported status', exact: true })
      .selectOption('rejected')
    await applyFilters({ location: 'DEST', source: 'SOURCE-A', status: 'rejected' })
    await expect(rows).toHaveCount(3)
    await page.getByLabel('Exact system label').fill('ERP')
    await page
      .getByRole('combobox', { name: 'Latest reported status', exact: true })
      .selectOption('no_report')
    await applyFilters({ system: 'ERP', status: 'no_report' })
    await expect(rows).toHaveCount(2)
    await page.getByLabel('Exact system label').fill(' ERP ')
    await page
      .getByRole('combobox', { name: 'Latest reported status', exact: true })
      .selectOption('rejected')
    await applyFilters({ system: ' ERP ', status: 'rejected' })
    await expect(rows).toHaveCount(1)
    await expect(page.getByLabel('Exact system label')).toHaveValue(' ERP ')
    await rows.getByText('2 included sources', { exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(rows.getByText('SOURCE-A', { exact: true })).toBeVisible()
    await rows.getByText('Event details', { exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(rows.getByText('Reporting API key')).toBeVisible()

    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(rows).toHaveCount(1)
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true)
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        const systemInput = page.locator('input[name="system"]:visible')
        await expect(systemInput).toHaveCount(1)
        await expect(systemInput).toHaveCSS('font-size', width < 768 ? '16px' : '14px')
        const region = page
          .locator('[role="region"]:visible')
          .filter({ has: page.locator('table') })
        await expect(region).toHaveCount(1)
        await region.focus()
        await expect(region).toBeFocused()
        if (width === 375) {
          expect(
            (await rows.locator('a[href$="#acknowledgements"]').boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44)
          await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
          await expect
            .poll(() => region.evaluate((node) => Math.abs(node.scrollLeft)))
            .toBeGreaterThan(0)
        }
        await region.evaluate((node) => node.scrollTo({ left: 0 }))
        await page.screenshot({
          path: testInfo.outputPath(`regional-integrations-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.reload()
    await rows.getByRole('link', { name: 'Open evidence and history' }).click()
    await expect(page).toHaveURL(new RegExp(`/handoffs/${ids[0]}#acknowledgements$`), {
      timeout: 30_000,
    })
    await expect(page.getByRole('region', { name: 'Integration acknowledgements' })).toContainText(
      'Superseded rejection',
    )
    for (let i = 0; i < 25; i++) await report(`System-${i}`, `reference-${i}`)
    await page.goto(base)
    await expect(page.getByText('31 package/system results', { exact: true })).toBeVisible()
    await expect(rows).toHaveCount(25)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(rows).toHaveCount(6)
    await page.goto(`${base}?page=100000`)
    await expect(page).toHaveURL(/integrations\?page=2$/)
    await page.goto(`${base}?q=old-reference`)
    await expect(rows).toHaveCount(0)
    await page.goto(`${base}?q=SECOND-PART&kind=batch&system=ERP`)
    await expect(rows).toHaveCount(1)
    await page.goto(`${base}?source=UNKNOWN`)
    await expect(rows).toHaveCount(0)
    await page.goto(`${base}?source=DEST`)
    await expect(rows).toHaveCount(0)
    await page.goto(`${base}?system=ERP&kind=handoff`)
    await rows.first().getByRole('link', { name: 'Northern sourcing region', exact: true }).click()
    await expect(page.locator('input[name="region"]:visible')).toHaveValue(region)
    await expect(rows).toHaveCount(2)
    const unknownRegion = randomUUID()
    await page.getByLabel('Saved region ID', { exact: true }).fill(unknownRegion)
    await applyFilters({ kind: 'handoff', system: 'ERP', region: unknownRegion })
    await expect(rows).toHaveCount(0)
    await approve()
    await page.goto(`${base}?system=ERP&selection=historical`)
    await expect(rows).toHaveCount(3)
    await expect(rows.filter({ hasText: 'latest-reference' })).toContainText('Historical')

    const viewerEmail = `regional-batches-viewer-${seedKey}@example.com`
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(sys.argv[2],sys.argv[4]))`)
    const viewerContext = await browser.newContext()
    try {
      const viewerPage = await viewerContext.newPage()
      await signInWithPassword(viewerPage, viewerEmail, password)
      await viewerPage.goto(`${base}?system=ERP`)
      await expect(viewerPage.locator('tbody tr:visible')).toHaveCount(4)
    } finally {
      await viewerContext.close()
    }
    const branchContext = await browser.newContext()
    try {
      const branchPage = await branchContext.newPage()
      await signInWithPassword(branchPage, branchEmail, password)
      await branchPage.goto(`${base}?source=SOURCE-B&system=ERP`)
      await expect(branchPage.locator('tbody tr')).toHaveCount(0)
      await expect(branchPage.getByText('0 package/system results', { exact: true })).toBeVisible()
      expect(
        (
          await branchPage.request.get(`/replenishment/regional-stock/sourcing/handoffs/${ids[0]}`)
        ).status(),
      ).toBe(404)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='SOURCE-A'",(sys.argv[5],sys.argv[2]))`)
      await branchPage.reload()
      await expect(branchPage.locator('tbody tr')).toHaveCount(4)
      expect(
        await (await page.request.get(`/api/regional-handoffs/${ids[0]}/json`)).json(),
      ).toEqual(individual)
      expect(await (await page.request.get(`/api/regional-batches/${batch}/json`)).json()).toEqual(
        original,
      )
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_regions set archived_at=now(),archived_by=%s where id=%s',(sys.argv[3],'${region}'))`)
      await page.goto(`${base}?region=${region}&q=Northern%20sourcing%20region&system=ERP`)
      await expect(rows).toHaveCount(4)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.stock_regions where id=%s',('${region}',))`)
      await page.reload()
      await expect(rows).toHaveCount(4)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.regional_sourcing_scenarios where organization_id=%s and id=%s",(sys.argv[2],'${parent}'))`)
      await page.goto(`${base}?source=SOURCE-A&q=REG-P&selection=unavailable&system=ERP`)
      await expect(rows).toHaveCount(2)
      await expect(rows.filter({ hasText: 'Batch mapping missing' })).toHaveCount(1)
      await expect(rows.filter({ hasText: 'No report' })).toHaveCount(1)
      await rows
        .filter({ hasText: 'Batch mapping missing' })
        .getByRole('link', { name: 'Open evidence and history' })
        .click()
      await expect(page).toHaveURL(new RegExp(`/batches/${batch}#acknowledgements$`), {
        timeout: 30_000,
      })
      await expect(
        page.getByRole('region', { name: 'Integration acknowledgements' }),
      ).toContainText('Batch mapping missing')
      expect(await (await page.request.get(`/api/regional-batches/${batch}/json`)).json()).toEqual(
        original,
      )
      expect(await (await page.request.get(`/api/regional-batches/${batch}/csv`)).text()).toBe(
        originalCsv,
      )
      await branchPage.goto(`${base}?selection=unavailable&system=ERP`)
      await expect(branchPage.locator('tbody tr')).toHaveCount(2)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id in (select id from public.locations where organization_id=%s and code='SOURCE-A')",(sys.argv[2],sys.argv[5],sys.argv[2]))`)
      await branchPage.reload()
      await expect(branchPage.locator('tbody tr')).toHaveCount(0)
    } finally {
      await branchContext.close()
    }
    expect(errors).toEqual([])
  } finally {
    await cleanup()
  }
})
