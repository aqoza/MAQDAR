import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { seedNetworkHandoffs } from './helpers/network-handoffs'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { expectPageTitle } from './helpers/typography'
import { generateApiKey } from '../src/lib/api/keys'

test('network workbench keeps whole-package reports, all-branch access and retained copied evidence', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(360_000)
  page.setDefaultTimeout(30_000)
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
    branchUser,
    branchEmail,
    password,
    fixture,
  } = await seedNetworkHandoffs(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const base = '/replenishment/network/integrations'
  const overlapResult = await editorClient.rpc('network_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: [ids[0], ids[2]],
  })
  expect(overlapResult.error).toBeNull()
  const overlap = overlapResult.data as string
  const originalCsv = await (await page.request.get(`/api/network-batches/${batch}/csv`)).text()
  const key = await generateApiKey()
  expect(
    (
      await editorClient.rpc('create_api_key', {
        p_organization_id: org,
        p_name: 'Network workbench reporter',
        p_scopes: ['network_handoffs:acknowledge'],
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
      ? 'network-handoff-batches'
      : 'network-handoffs'
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

  await page.goto('/replenishment/network')
  await page.getByRole('link', { name: 'Network integrations', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Network integration workbench')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(7)
  await expect(rows.filter({ hasText: 'old-reference' })).toHaveCount(0)
  await expect(rows.filter({ hasText: 'latest-reference' })).toContainText('Reported received')
  await expect(rows.filter({ hasText: 'case-reference' })).toContainText('Reported rejected')
  await expect(rows.filter({ hasText: 'No report' })).toHaveCount(3)
  await expect(rows.filter({ hasText: 'space-reference' })).toContainText(
    'Branch mapping <script>alert(1)</script>',
  )
  expect(await page.locator('tbody script').count()).toBe(0)
  await page.getByLabel('Included branch code', { exact: true }).fill('BRANCH-B')
  await page.getByLabel('Warehouse code', { exact: true }).fill('WAREHOUSE')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('branch') === 'BRANCH-B' &&
      url.searchParams.get('source') === 'WAREHOUSE',
  )
  await expect(rows).toHaveCount(7)
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('rejected')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'rejected')
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Exact system label').fill('ERP')
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('no_report')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('system') === 'ERP' && url.searchParams.get('status') === 'no_report',
  )
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Exact system label').fill(' ERP ')
  await page
    .getByRole('combobox', { name: 'Latest reported status', exact: true })
    .selectOption('rejected')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('system') === ' ERP ' && url.searchParams.get('status') === 'rejected',
  )
  await expect(rows).toHaveCount(1)
  await expect(page.getByLabel('Exact system label')).toHaveValue(' ERP ')
  await rows.getByText('2 included branches', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(rows.getByText('BRANCH-B', { exact: true })).toBeVisible()
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
      await expect(page.locator('input[name="system"]:visible')).toHaveCSS(
        'font-size',
        width < 768 ? '16px' : '14px',
      )
      const region = page.locator('[role="region"]').filter({ has: page.locator('table') })
      await region.focus()
      await expect(region).toBeFocused()
      if (width === 375) {
        expect((await rows.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
        await expect
          .poll(() => region.evaluate((node) => Math.abs(node.scrollLeft)))
          .toBeGreaterThan(0)
      }
      await region.evaluate((node) => node.scrollTo({ left: 0 }))
      await page.screenshot({
        path: testInfo.outputPath(`network-integrations-${locale}-${width}.png`),
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
  await expect(page.getByText('32 package/system results', { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(25)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(rows).toHaveCount(7)
  await page.goto(`${base}?page=100000`)
  await expect(page).toHaveURL(/integrations\?page=2$/)
  await page.goto(`${base}?q=old-reference`)
  await expect(rows).toHaveCount(0)
  await page.goto(`${base}?q=NETWORK-SECOND&kind=batch&system=ERP`)
  await expect(rows).toHaveCount(1)
  await page.goto(`${base}?source=UNKNOWN`)
  await expect(rows).toHaveCount(0)
  await page.goto(`${base}?branch=WAREHOUSE`)
  await expect(rows).toHaveCount(0)
  await approve()
  await page.goto(`${base}?system=ERP&selection=historical`)
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'latest-reference' })).toContainText('Historical')

  const viewerEmail = `network-viewer-${randomUUID()}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'viewer')",(sys.argv[2],'${viewer}'))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, viewerEmail, password)
  await viewerPage.goto(`${base}?system=ERP`)
  await expect(viewerPage.locator('tbody tr')).toHaveCount(5)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(`${base}?branch=BRANCH-A&system=ERP`)
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await expect(branchPage.getByText('0 package/system results', { exact: true })).toBeVisible()
  expect((await branchPage.request.get(`/replenishment/network/handoffs/${ids[0]}`)).status()).toBe(
    404,
  )
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations values(%s,%s,%s)",(sys.argv[2],'${branchUser}','${fixture.second}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(5)
  expect(await (await page.request.get(`/api/network-handoffs/${ids[0]}/json`)).json()).toEqual(
    individual,
  )
  expect(await (await page.request.get(`/api/network-batches/${batch}/json`)).json()).toEqual(
    original,
  )
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.network_allocation_scenarios where organization_id=%s and id=%s",(sys.argv[2],'${parent}'))`)
  await page.goto(`${base}?branch=BRANCH-B&q=NETWORK-ITEM&selection=unavailable&system=ERP`)
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Batch mapping missing' })).toHaveCount(1)
  await expect(rows.filter({ hasText: 'No report' })).toHaveCount(1)
  await rows.filter({ hasText: 'Batch mapping missing' }).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/batches/${batch}#acknowledgements$`), {
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Integration acknowledgements' })).toContainText(
    'Batch mapping missing',
  )
  expect(await (await page.request.get(`/api/network-batches/${batch}/json`)).json()).toEqual(
    original,
  )
  expect(await (await page.request.get(`/api/network-batches/${batch}/csv`)).text()).toBe(
    originalCsv,
  )
  await branchPage.goto(`${base}?selection=unavailable&system=ERP`)
  await expect(branchPage.locator('tbody tr')).toHaveCount(2)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=%s",(sys.argv[2],'${branchUser}','${fixture.second}'))`)
  await branchPage.reload()
  await expect(branchPage.locator('tbody tr')).toHaveCount(0)
  await branchContext.close()
  expect(errors).toEqual([])
})
