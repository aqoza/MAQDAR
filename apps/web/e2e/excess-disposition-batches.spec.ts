import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signedInClient,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle, expectEvidenceValue } from './helpers/typography'

test.use({ actionTimeout: 30_000 })
test('disposition batches preserve compatible selections, exact files, overlap and source deletion history', async ({
  page,
  browser,
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
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const widths = [375, 768, 1024, 1366, 1440, 1920]
  const capture = async (name: string) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
      await page.evaluate(() => document.fonts.ready)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await expectPageTitle(page.getByRole('heading', { level: 1 }))
      const family = await page
        .locator('html')
        .evaluate((node) => getComputedStyle(node).fontFamily)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', family)
      const values = page.locator('main .text-evidence-value:visible')
      if (['batch-preview', 'batch-detail', 'batch-ar'].includes(name)) {
        await expect(values).toHaveCount(4)
      }
      for (const value of await values.all()) {
        await expectEvidenceValue(value)
        await expect(value).toHaveCSS('font-family', family)
      }
      for (const action of await page
        .locator('[data-page-banner]:visible .page-actions > a')
        .all()) {
        await expect(action).toBeVisible()
        await expect(action).toHaveCSS('font-size', '14px')
        if (width < 768) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true })
      const typography = await page
        .locator('main h1, main .text-evidence-value')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getBoundingClientRect().height > 0)
            .map((node) => {
              const css = getComputedStyle(node)
              return {
                role: node.tagName === 'H1' ? 'page-title' : 'evidence-value',
                text: node.textContent?.trim(),
                size: css.fontSize,
                lineHeight: css.lineHeight,
                weight: css.fontWeight,
                family: css.fontFamily,
              }
            }),
        )
      await writeFile(
        testInfo.outputPath(`${name}-${width}-type.json`),
        JSON.stringify(typography, null, 2),
      )
    }
  }
  await page.goto('/replenishment/excess/handoffs')
  await page.getByRole('link', { name: 'Disposition batches', exact: true }).click()
  await page.getByRole('link', { name: 'Choose batch lines', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select EXCESS-1', exact: true }).check()
  await page.getByRole('button', { name: 'Add selected lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 line selected', exact: true })).toBeVisible()
  await page.getByLabel('Search', { exact: true }).fill('EXCESS-2')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'EXCESS-2')
  // The selected count is unchanged by filtering. Wait for the new candidate
  // form before checking a row that was also present in the previous results.
  await expect(
    page.getByRole('region', { name: 'Available handoffs', exact: true }).getByRole('checkbox'),
  ).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '1 line selected', exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select EXCESS-2', exact: true }).check()
  await page.getByRole('button', { name: 'Add selected lines', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2 lines selected', exact: true })).toBeVisible()
  await capture('batch-selection')
  await page.getByRole('link', { name: 'Preview batch', exact: true }).click()
  await expect(page.getByText('7.49925 KWD', { exact: true })).toBeVisible()
  await expectEvidenceValue(page.getByText('7.49925 KWD', { exact: true }).locator('..'))
  await capture('batch-preview')
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page).toHaveURL(/\/excess\/batches\/[0-9a-f-]+$/)
  const batchUrl = page.url()
  const batchId = new URL(batchUrl).pathname.split('/').at(-1)!
  const jsonUrl = `/api/excess-disposition-batches/${batchId}/json`
  const csvUrl = `/api/excess-disposition-batches/${batchId}/csv`
  const originalJson = await (await page.request.get(jsonUrl)).body()
  const originalCsv = await (await page.request.get(csvUrl)).body()
  const payload = JSON.parse(originalJson.toString())
  expect(payload.summary.reference_value).toBe('7.499250')
  expect(payload.lines).toHaveLength(2)
  expect(payload.selection).toBeUndefined()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toBe(`excess-disposition-batch-${batchId}.csv`)
  const help = page.getByRole('button', { name: 'Method and assumptions', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Quantities are never pooled')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  await capture('batch-detail')
  const replay = await editorClient.rpc('excess_disposition_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: [ids[1], ids[0]],
  })
  expect(replay.error).toBeNull()
  expect(replay.data).toBe(batchId)
  const overlap = await editorClient.rpc('excess_disposition_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: [ids[0]],
  })
  expect(overlap.error).toBeNull()
  await page.reload()
  await expect(page.getByText('1 other batch shares these handoffs', { exact: true })).toBeVisible()
  // The preview is advisory: save must reject evidence changed after the preview.
  await page.goto(`/replenishment/excess/batches/preview?handoff=${ids[1]}&handoff=${ids[2]}`)
  await expect(page.getByRole('button', { name: 'Save batch', exact: true })).toBeVisible()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.stock_snapshots set unit_cost=2 where organization_id=%s and item_id=%s',(sys.argv[2],'${fixture.lines[1].item}'))`)
  await page.getByRole('button', { name: 'Save batch', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('as-of evidence changed')
  expect(await (await page.request.get(jsonUrl)).body()).toEqual(originalJson)
  expect(await (await page.request.get(csvUrl)).body()).toEqual(originalCsv)
  // Replace the unchanged first item's approval; the second item's correction stays historical.
  await approve('4', 'Replacement for first line')
  await page.goto(batchUrl)
  await expect(
    page.getByRole('status').filter({ hasText: 'Historical approval included' }),
  ).toBeVisible()
  await page.goto('/replenishment/excess/batches')
  await page.getByLabel('Search', { exact: true }).fill('Batch line 2')
  await page
    .getByRole('combobox', { name: 'Planning selection', exact: true })
    .selectOption('historical')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByText('1 batch', { exact: true })).toBeVisible()
  await capture('batch-history')
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(sys.argv[2],'${reviewer}'))`)
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  await signInWithPassword(viewerPage, reviewerEmail, password)
  await viewerPage.goto('/replenishment/excess/batches/new')
  await expect(viewerPage).toHaveURL(/\/excess\/batches$/)
  await expect(
    viewerPage.getByRole('link', { name: 'Choose batch lines', exact: true }),
  ).toHaveCount(0)
  expect(await (await viewerPage.request.get(jsonUrl)).body()).toEqual(originalJson)
  await viewerContext.close()
  const branchContext = await browser.newContext()
  const branchPage = await branchContext.newPage()
  await signInWithPassword(branchPage, branchEmail, password)
  await branchPage.goto(batchUrl)
  await expect(
    branchPage.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible()
  expect((await branchPage.request.get(jsonUrl)).status()).toBe(404)
  expect((await branchPage.request.get(csvUrl)).status()).toBe(404)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],'${branch}','${fixture.location}'))`)
  await branchPage.reload()
  await expect(branchPage.getByText('7.49925 KWD', { exact: true })).toBeVisible()
  expect(await (await branchPage.request.get(csvUrl)).body()).toEqual(originalCsv)
  await branchContext.close()
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.excess_stock_assessments where organization_id=%s and id=%s',(sys.argv[2],'${assessment.data}'))`)
  await page.goto(batchUrl)
  await expect(
    page.getByRole('status').filter({ hasText: 'Live context unavailable' }),
  ).toBeVisible()
  expect(await (await page.request.get(jsonUrl)).body()).toEqual(originalJson)
  expect(await (await page.request.get(csvUrl)).body()).toEqual(originalCsv)
  await page.getByText('Complete copied handoff evidence', { exact: true }).click()
  await expect(page.locator('pre')).toContainText('Batch line 1')
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto(batchUrl)
  await capture('batch-ar')
  expect(errors).toEqual([])
})
