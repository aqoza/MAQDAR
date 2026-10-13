import { expect as baseExpect, test } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import {
  MUST_FIX,
  addFiles,
  batchById,
  commitFromCheck,
  continueButton,
  continueToCheck,
  download,
  expectCounts,
  expectMapped,
  fileInput,
  fileRow,
  fixtureBytes,
  fixtureFile,
  inviteAndAccept,
  mappingRow,
  openNewImport,
  parseCsv,
  pickWizardFile,
  removeOriginals,
  rowsOf,
  runCheck,
  signedInPage,
  stepButton,
  storedOriginals,
} from './helpers/imports'
import { createSupplier, listRow } from './helpers/master-data'
import {
  createOrganization,
  expectActiveOrganization,
  switchOrganization,
} from './helpers/organizations'

/*
 * The import wizard end to end on the local stack (Storage included): a planner imports brands,
 * a Windows-1256 items file and an Excel "Unicode Text" supplier items file in one batch, reads
 * the errors and the downloaded report, commits the fixed files atomically, re-imports them
 * without changes and imports XLSX workbooks in both date systems. A viewer cannot reach the
 * wizard; a stale tab cannot commit; an import is canceled and deleted with its original.
 */

const expect = baseExpect.configure({ timeout: 15_000 })

const run = Date.now()
const owner = { email: `imp-owner-${run}@example.com`, password: `Imp-owner-pass-${run}` }
const planner = { email: `imp-planner-${run}@example.com`, password: `Imp-planner-pass-${run}` }
const viewer = { email: `imp-viewer-${run}@example.com`, password: `Imp-viewer-pass-${run}` }
const organization = { name: `Imports ${run}`, slug: `imports-${run}` }
const otherOrganization = { name: `Imports Other ${run}`, slug: `imports-other-${run}` }

// One organization (home country SA, base currency SAR) for the whole file; later tests build on
// the data and imports of earlier ones.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

let organizationId = ''
let canceledBatchId = ''

const BATCH_FILES = {
  brands: () => fixtureFile('brands.csv'),
  itemsWithErrors: () => fixtureFile('items-errors.csv', 'items.csv'),
  itemsFixed: () => fixtureFile('items-fixed.csv', 'items.csv'),
  supplierItems: () => fixtureFile('supplier_items.txt'),
}
const FORMULA_NAME = '=HYPERLINK("http://evil.test","x")'

test.beforeAll(async ({ browser, playwright }) => {
  test.setTimeout(180_000)
  await createConfirmedUser(owner.email, owner.password)
  await createConfirmedUser(planner.email, planner.password)
  await createConfirmedUser(viewer.email, viewer.password)
  const context = await browser.newContext()
  const page = await context.newPage()
  const request = await playwright.request.newContext()
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  organizationId = await organizationIdBySlug(organization.slug)
  await inviteAndAccept(page, browser, request, planner.email, 'Planner', organization.name)
  await inviteAndAccept(page, browser, request, viewer.email, 'Viewer', organization.name)
  await request.dispose()
  await context.close()
})

test.afterAll(async () => {
  if (organizationId) await removeOriginals(organizationId)
})

test('a planner checks brands, Windows-1256 items and UTF-16 supplier items in one batch', async ({
  page,
}) => {
  // The fixtures must reach the browser byte for byte (their .gitattributes stops git from
  // normalizing line endings): a BOM and CRLF, Windows-1256 with CRLF, UTF-16LE with a BOM.
  expect([...fixtureBytes('brands.csv').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(fixtureBytes('brands.csv').includes('\r\n')).toBe(true)
  expect(fixtureBytes('items-errors.csv').includes('\r\n')).toBe(true)
  expect([...fixtureBytes('supplier_items.txt').subarray(0, 2)]).toEqual([0xff, 0xfe])

  await signInWithPassword(page, planner.email, planner.password)
  await expectActiveOrganization(page, organization.name)
  // The supplier that the supplier items refer to exists already.
  await createSupplier(page, {
    code: 'SUP-GULF',
    nameEn: 'Gulf Parts Trading',
    leadTimeP50: '7',
    leadTimeP90: '14',
  })

  // Editors reach the wizard from a master-data list.
  await page.goto('/items')
  await page.getByRole('link', { name: 'Import', exact: true }).click()
  await page.waitForURL(/\/imports\/new\?entity=items$/)
  await expect(page.getByRole('heading', { level: 1, name: 'New import' })).toBeVisible()
  await addFiles(page, [
    BATCH_FILES.brands(),
    BATCH_FILES.itemsWithErrors(),
    BATCH_FILES.supplierItems(),
  ])

  // Each file's data is guessed from its name; the files are listed in load order.
  await expect(fileRow(page, 'brands.csv').getByRole('combobox')).toHaveValue('brands')
  await expect(fileRow(page, 'items.csv').getByRole('combobox')).toHaveValue('items')
  await expect(fileRow(page, 'supplier_items.txt').getByRole('combobox')).toHaveValue(
    'supplier_items',
  )
  await expect(page.locator('tbody tr bdi')).toHaveText([
    'brands.csv',
    'items.csv',
    'supplier_items.txt',
  ])

  // Format: the encodings and delimiters are detected per file.
  await continueButton(page).click()
  await expect(stepButton(page, 'Format')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('Detected: UTF-8', { exact: true })).toBeVisible()
  await pickWizardFile(page, 'items.csv')
  await expect(
    page.getByText('Detected: Windows-1256 (Arabic Excel)', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Detected: Comma (,)', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'فلتر زيت', exact: true })).toBeVisible()
  await pickWizardFile(page, 'supplier_items.txt')
  await expect(
    page.getByText('Detected: UTF-16 LE (Excel "Unicode text")', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Detected: Tab', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '٨٫٥', exact: true })).toBeVisible()

  // Map: matched by name, by Arabic label; the preview shows the values as they will be checked.
  await continueButton(page).click()
  await expect(stepButton(page, 'Map columns')).toHaveAttribute('aria-current', 'step')
  await pickWizardFile(page, 'items.csv')
  await expectMapped(page, 'item_code', 'رقم القطعة')
  await expect(mappingRow(page, 'item_code')).toContainText('Matched by label')
  await expectMapped(page, 'name_ar', 'الاسم (بالعربية)')
  await expectMapped(page, 'unit_cost', 'unit_cost')
  await expect(mappingRow(page, 'unit_cost')).toContainText('Matched by name')
  await expect(mappingRow(page, 'status')).toContainText(
    'Not imported: existing rows keep their value; new rows get active.',
  )
  await expect(page.getByRole('cell', { name: '1250.75', exact: true })).toBeVisible()
  await pickWizardFile(page, 'supplier_items.txt')
  await expectMapped(page, 'is_preferred', 'is_preferred')
  for (const value of ['14', '8.5', 'true', '2026-10-01', '1250.75', 'false']) {
    await expect(page.getByRole('cell', { name: value, exact: true }).first()).toBeVisible()
  }

  // Check: the bad decimal, the unknown brand, the duplicate code and the formula are refused.
  await continueButton(page).click()
  await expect(stepButton(page, 'Check')).toHaveAttribute('aria-current', 'step')
  canceledBatchId = await runCheck(page)
  await expect(page.getByText(MUST_FIX)).toHaveText(/^4 errors must be fixed/)
  await expect(continueButton(page)).toHaveCount(0)
  const itemsResult = fileRow(page, 'items.csv')
  await expect(itemsResult.locator('td')).toHaveText([
    'items.csv',
    'Items',
    '6',
    '5',
    '0',
    '4',
    '0',
  ])
  for (const message of [
    'Not a number.',
    'No record has this code, in your data or in this import.',
    'This key appears more than once in the import.',
  ]) {
    await expect(page.getByText(message, { exact: true })).toBeVisible()
  }
  await expect(page.locator('li').filter({ hasText: 'Row 4' })).toContainText('NOPE')

  // The report: UTF-8 with a BOM, every field quoted, the formula neutralized.
  const report = await download(
    page,
    page.getByRole('link', { name: 'Download error report', exact: true }),
  )
  expect(report.name).toMatch(/^import-errors-[0-9a-f]{8}\.csv$/)
  const text = report.bytes.toString('utf8')
  expect(text.startsWith('\uFEFF')).toBe(true)
  const [header, ...lines] = parseCsv(text.slice(1))
  expect(header).toEqual(['file', 'row', 'column', 'code', 'level', 'value', 'message'])
  const errors = lines
    .filter((line) => line[4] === 'error')
    .map(([file, row, column, code, , value]) => [file, row, column, code, value].join(' | '))
    .sort()
  expect(errors).toEqual(
    [
      'items.csv | 3 | unit_cost | invalid_decimal | 12.5.0',
      'items.csv | 4 | brand_code | unknown_reference | NOPE',
      'items.csv | 5 |  | duplicate_key | 00123',
      "items.csv | 6 | unit_cost | invalid_decimal | '=1+2",
    ].sort(),
  )
  for (const line of text.slice(1).trimEnd().split('\r\n')) expect(line).toMatch(/^"[^]*"$/)

  // Cancel and start over: back to the Files step with the files kept, so the bad one can be
  // swapped; the import is canceled.
  await page.getByRole('button', { name: 'Cancel and start over', exact: true }).click()
  await expect(page.getByText('Import canceled.', { exact: true })).toBeVisible()
  await expect(stepButton(page, 'Files')).toHaveAttribute('aria-current', 'step')
  await expect(page.locator('tbody tr bdi')).toHaveCount(3)
  await page.getByRole('button', { name: 'Remove items.csv', exact: true }).click()
  await expect(page.locator('tbody tr bdi')).toHaveText(['brands.csv', 'supplier_items.txt'])
  expect((await batchById(canceledBatchId))?.status).toBe('canceled')
})

test('the fixed files commit at once and the lists show the rows', async ({ page }) => {
  await signInWithPassword(page, planner.email, planner.password)
  await openNewImport(page)
  await addFiles(page, [
    BATCH_FILES.brands(),
    BATCH_FILES.itemsFixed(),
    BATCH_FILES.supplierItems(),
  ])
  await continueToCheck(page)
  const batchId = await runCheck(page)
  await expect(
    page.getByText('Every file passed: 10 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Original stored')).toHaveCount(3)

  await continueButton(page).click()
  await expect(
    page.getByText('Up to 5,000 rows are committed at once: either every row is saved or none.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await expect(page.getByText('Import committed.', { exact: true })).toBeVisible()
  await expectCounts(page, 'Brands', { inserted: 3 })
  await expectCounts(page, 'Items', { inserted: 5 })
  await expectCounts(page, 'Supplier items', { inserted: 2 })

  // The import's page: committed at once, the originals downloadable byte for byte.
  await page.getByRole('link', { name: 'View this import', exact: true }).click()
  await page.waitForURL(new RegExp(`/imports/${batchId}$`))
  const summary = page.locator('dl')
  await expect(summary).toContainText('Imported')
  await expect(summary).toContainText('All at once')
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(3)
  await expect(page.getByText('No errors or warnings.', { exact: true })).toBeVisible()
  const original = await download(
    page,
    fileRow(page, 'items.csv').getByRole('link', { name: 'Download', exact: true }),
  )
  expect(original.name).toBe('items.csv')
  expect(original.bytes.equals(fixtureBytes('items-fixed.csv'))).toBe(true)
  const batch = await batchById(batchId)
  expect(batch?.status).toBe('succeeded')
  expect(batch?.commit_mode).toBe('atomic')

  // The items list: leading zeros, the slash, the Arabic names, the grouped amount, the formula
  // kept as plain text.
  await page.goto('/items')
  await expect(listRow(page, '00123')).toContainText('Oil filter')
  await expect(listRow(page, '00123').locator('[lang="ar"]')).toHaveText('فلتر زيت')
  await expect(listRow(page, '90915/YZZD2')).toContainText(/SAR\s1,250\.75/)
  await expect(listRow(page, 'FRM-01')).toContainText(FORMULA_NAME)
  await expect(listRow(page, 'BAT-01')).toContainText('AFT')

  // Supplier items from the UTF-16 file: Arabic-Indic digits, ٫ and ٬, نعم/لا.
  await page.goto('/suppliers/supplier-items')
  await expect(listRow(page, '00123')).toContainText('SUP-GULF')
  await expect(listRow(page, '00123')).toContainText(/SAR\s8\.50/)
  await expect(listRow(page, '90915/YZZD2')).toContainText(/SAR\s1,250\.75/)

  const items = await rowsOf<{ code: string; name_ar: string | null; name_en: string }>(
    'items',
    organizationId,
    'code, name_en, name_ar',
    'code',
  )
  expect(items.map((item) => item.code)).toEqual([
    '00123',
    '90915/YZZD2',
    'BAT-01',
    'BRK-01',
    'FRM-01',
  ])
  expect(items.find((item) => item.code === '00123')?.name_ar).toBe('فلتر زيت')
  expect(items.find((item) => item.code === 'FRM-01')?.name_en).toBe(FORMULA_NAME)
  const supplierItems = await rowsOf<{
    lead_time_days: number
    unit_price: number
    is_preferred: boolean
    valid_from: string | null
    supplier_part_number: string | null
  }>(
    'supplier_items',
    organizationId,
    'supplier_part_number, lead_time_days, unit_price, is_preferred, valid_from',
    'supplier_part_number',
  )
  expect(supplierItems).toEqual([
    {
      supplier_part_number: 'GP-00123',
      lead_time_days: 14,
      unit_price: 8.5,
      is_preferred: true,
      valid_from: '2026-10-01',
    },
    {
      supplier_part_number: 'GP-90915',
      lead_time_days: 7,
      unit_price: 1250.75,
      is_preferred: false,
      valid_from: '2026-10-01',
    },
  ])
})

test('importing the same files again changes nothing', async ({ page }) => {
  type Stamped = { code?: string; id?: string; updated_at: string }
  const snapshot = async () => ({
    brands: await rowsOf<Stamped>('brands', organizationId, 'code, updated_at', 'code'),
    items: await rowsOf<Stamped>('items', organizationId, 'code, updated_at', 'code'),
    supplierItems: await rowsOf<Stamped>('supplier_items', organizationId, 'id, updated_at'),
  })
  const before = await snapshot()

  await signInWithPassword(page, planner.email, planner.password)
  await openNewImport(page)
  await addFiles(page, [
    BATCH_FILES.brands(),
    BATCH_FILES.itemsFixed(),
    BATCH_FILES.supplierItems(),
  ])
  // The same bytes were imported before; the wizard says so but lets them through.
  await expect(fileRow(page, 'items.csv')).toContainText('This file was already imported on')
  await continueToCheck(page)
  await runCheck(page)
  await expect(
    page.getByText('Every file passed: 0 new and 10 existing rows.', { exact: true }),
  ).toBeVisible()
  await commitFromCheck(page)
  await expectCounts(page, 'Brands', { unchanged: 3 })
  await expectCounts(page, 'Items', { unchanged: 5 })
  await expectCounts(page, 'Supplier items', { unchanged: 2 })

  // Unchanged rows are not written at all: updated_at stays as it was.
  expect(await snapshot()).toEqual(before)
})

test('XLSX workbooks in the 1904 and 1900 date systems', async ({ page }) => {
  await signInWithPassword(page, planner.email, planner.password)
  await openNewImport(page)
  await addFiles(page, [
    fixtureFile('items-1904.xlsx', 'items.xlsx'),
    fixtureFile('supplier_items-1900.xlsx', 'supplier_items.xlsx'),
  ])

  await continueButton(page).click()
  const date1904 = page.getByText(
    'This workbook counts dates from 1904; dates are converted accordingly.',
    { exact: true },
  )
  await pickWizardFile(page, 'items.xlsx')
  await expect(page.getByLabel('Sheet', { exact: true })).toHaveValue('Items')
  await expect(date1904).toBeVisible()
  await pickWizardFile(page, 'supplier_items.xlsx')
  await expect(page.getByLabel('Sheet', { exact: true })).toHaveValue('Supplier items')
  await expect(date1904).toHaveCount(0)

  // Both workbooks hold 2024-03-15 as a serial of their own date system.
  await continueButton(page).click()
  await expect(page.getByRole('cell', { name: '2024-03-15', exact: true })).toBeVisible()
  await pickWizardFile(page, 'items.xlsx')
  for (const value of ['2024-03-15', '2025-12-31', '2020-02-29', '000777', '4711', '18.25']) {
    await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible()
  }

  await continueButton(page).click()
  await runCheck(page)
  await expect(
    page.getByText('Every file passed: 5 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()
  // A code stored as a number is worth a word, but does not stop the import.
  await expect(
    page.getByText('Codes are stored as numbers in the workbook; leading zeros may be lost.'),
  ).toBeVisible()
  await commitFromCheck(page)
  await expectCounts(page, 'Items', { inserted: 3 })
  await expectCounts(page, 'Supplier items', { inserted: 2 })

  const items = await rowsOf<{ code: string; introduced_on: string | null; unit_cost: number }>(
    'items',
    organizationId,
    'code, introduced_on, unit_cost',
    'code',
  )
  const byCode = new Map(items.map((item) => [item.code, item]))
  expect(byCode.get('000777')).toEqual({
    code: '000777',
    introduced_on: '2024-03-15',
    unit_cost: 18.25,
  })
  expect(byCode.get('4711')?.introduced_on).toBe('2025-12-31')
  expect(byCode.get('XL-1904')?.introduced_on).toBe('2020-02-29')
  const prices = await rowsOf<{ unit_price: number; valid_from: string; is_preferred: boolean }>(
    'supplier_items',
    organizationId,
    'unit_price, valid_from, is_preferred',
    'valid_from',
  )
  expect(prices.filter((price) => price.unit_price === 15.75 || price.unit_price === 19)).toEqual([
    { unit_price: 15.75, valid_from: '2024-03-15', is_preferred: true },
    { unit_price: 19, valid_from: '2026-01-31', is_preferred: false },
  ])
})

test('a viewer sees no Imports link and gets 404 on the import pages', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, viewer.email, viewer.password)
  await expectActiveOrganization(page, organization.name)
  await expect(page.getByRole('link', { name: 'Items', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Imports', exact: true })).toHaveCount(0)

  await page.goto('/items')
  await expect(listRow(page, '00123')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0)

  for (const path of ['/imports/new', '/imports', `/imports/${canceledBatchId}`]) {
    await page.goto(path)
    await expect(page.getByText('This page could not be found.')).toBeVisible()
    await expect(fileInput(page)).toHaveCount(0)
  }
  // The report route refuses non-editors as well.
  const response = await page.request.get(`/api/imports/${canceledBatchId}/errors`)
  expect(response.status()).toBe(403)
  expect(await response.json()).toMatchObject({ code: 'MQ403' })
  await context.close()
})

test('a stale tab cannot commit; the import is canceled and deleted with its original', async ({
  page,
  context,
}) => {
  await signInWithPassword(page, owner.email, owner.password)
  // Creating a second organization makes it active; switch back before importing.
  await createOrganization(page, otherOrganization)
  await switchOrganization(page, otherOrganization.name, organization.name)

  await openNewImport(page)
  await addFiles(page, [fixtureFile('brands-extra.csv', 'brands.csv')])
  await continueToCheck(page)
  const batchId = await runCheck(page)
  await expect(
    page.getByText('Every file passed: 1 new and 0 existing rows.', { exact: true }),
  ).toBeVisible()
  await continueButton(page).click()
  await expect(stepButton(page, 'Commit')).toHaveAttribute('aria-current', 'step')

  // Another tab of the same browser switches to the other organization.
  const otherTab = await context.newPage()
  await otherTab.goto('/dashboard')
  await switchOrganization(otherTab, organization.name, otherOrganization.name)
  await otherTab.close()

  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'The active organization changed in another tab or window.' }),
  ).toBeVisible()
  expect((await batchById(batchId))?.status).toBe('validated')
  const brandCodes = (await rowsOf<{ code: string }>('brands', organizationId, 'code', 'code')).map(
    (brand) => brand.code,
  )
  expect(brandCodes).not.toContain('HYU')

  // Back in the first organization, the import waits on its page; cancel it there.
  await page.goto('/dashboard')
  await switchOrganization(page, otherOrganization.name, organization.name)
  await page.goto(`/imports/${batchId}`)
  await expect(page.locator('dl')).toContainText('Ready to commit')
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click()
  const cancelDialog = page.getByRole('alertdialog')
  await expect(cancelDialog).toContainText('Cancel this import?')
  await cancelDialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  await expect(page.locator('dl')).toContainText('Canceled')
  expect((await batchById(batchId))?.status).toBe('canceled')

  // Deleting it removes the stored original too; imported data is not touched.
  expect(await storedOriginals(organizationId, batchId)).toEqual(['1.csv'])
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const deleteDialog = page.getByRole('alertdialog')
  await expect(deleteDialog).toContainText('Delete this import?')
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL(/\/imports\?notice=deleted$/)
  await expect(page.getByText('Import deleted.', { exact: true })).toBeVisible()
  expect(await storedOriginals(organizationId, batchId)).toEqual([])
  expect(await batchById(batchId)).toBeNull()
  expect(
    (await rowsOf<{ code: string }>('brands', organizationId, 'code', 'code')).map((b) => b.code),
  ).toEqual(['AFT', 'NIS', 'TOY'])
})
