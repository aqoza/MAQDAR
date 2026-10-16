import { expect as baseExpect, test, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { inviteMember } from './helpers/invitations'
import { waitForEmailLink } from './helpers/mailpit'
import {
  createBrand,
  createButton,
  createItem,
  createLocation,
  createSupplier,
  deleteRecord,
  expectFieldError,
  field,
  fillBrand,
  listRow,
  openNewForm,
  optionLabel,
  saveButton,
  saveChanges,
  searchList,
  submitNew,
} from './helpers/master-data'
import {
  DASHBOARD_URL,
  createOrganization,
  expectActiveOrganization,
  openSettings,
  switchOrganization,
} from './helpers/organizations'

// The dev server compiles every master-data route on its first visit; give assertions room.
const expect = baseExpect.configure({ timeout: 15_000 })

const run = Date.now()
const owner = { email: `md-owner-${run}@example.com`, password: `Md-owner-pass-${run}` }
const viewer = { email: `md-viewer-${run}@example.com`, password: `Md-viewer-pass-${run}` }
const organization = { name: `Master Data ${run}`, slug: `md-${run}` }
const otherOrganization = { name: `Master Data Other ${run}`, slug: `md-other-${run}` }

// One organization (home country SA, base currency SAR) serves the whole file; later tests use
// records created by earlier ones.
test.describe.configure({ mode: 'serial', timeout: 120_000 })

const item = { code: 'FLT-100', nameEn: 'Oil filter', id: '' }

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  await createConfirmedUser(owner.email, owner.password)
  await createConfirmedUser(viewer.email, viewer.password)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  await context.close()
})

test.beforeEach(async ({ page }) => {
  await signInWithPassword(page, owner.email, owner.password)
})

test('brands: create, refuse a duplicate code, edit with an Arabic name, delete', async ({
  page,
}) => {
  const brand = { code: 'BRD-CRUD', nameEn: 'Crud Motors' }
  const arabicName = 'كرود موتورز'
  const id = await createBrand(page, brand)

  // The same code again is refused next to the Code field, and the typed values stay.
  await openNewForm(page, '/items/brands')
  await fillBrand(page, { code: brand.code, nameEn: 'Another brand' })
  await createButton(page).click()
  await expectFieldError(page, 'Code', 'This code is already used in this organization.')
  await expect(page).toHaveURL(/\/items\/brands\/new$/)
  await expect(field(page, 'Name (English)')).toHaveValue('Another brand')

  // The Arabic name is typed right to left and saved.
  await page.goto(`/items/brands/${id}`)
  const nameAr = field(page, 'Name (Arabic)')
  await expect(nameAr).toHaveAttribute('dir', 'rtl')
  await expect(nameAr).toHaveAttribute('lang', 'ar')
  await nameAr.fill(arabicName)
  await saveChanges(page)
  await page.reload()
  await expect(field(page, 'Name (Arabic)')).toHaveValue(arabicName)

  // The list shows both names, the Arabic one marked up as Arabic.
  await page.goto('/items/brands')
  const row = listRow(page, brand.code)
  await expect(row).toContainText(brand.nameEn)
  await expect(row.locator('[lang="ar"]')).toHaveText(arabicName)

  await page.goto(`/items/brands/${id}`)
  await deleteRecord(page, '/items/brands')
  await expect(listRow(page, brand.code)).toHaveCount(0)
})

test('items: create with a brand, list it with money formatted, edit and save', async ({
  page,
}) => {
  const brand = { code: 'BRD-ITEM', nameEn: 'Item Motors' }
  const brandId = await createBrand(page, brand)

  // KWD has three decimals, so 12.5 is listed as KWD 12.500.
  item.id = await createItem(page, {
    code: item.code,
    nameEn: item.nameEn,
    productGroup: 'Filters',
    unitCost: '12.5',
    currency: 'KWD',
    brand: optionLabel(brand.code, brand.nameEn),
  })
  await expect(field(page, 'Brand')).toHaveValue(brandId)
  await expect(field(page, 'Unit cost')).toHaveValue('12.5')

  await page.goto('/items')
  await searchList(page, item.code)
  const row = listRow(page, item.code)
  await expect(row).toContainText(item.nameEn)
  await expect(row).toContainText(brand.code)
  await expect(row).toContainText(/KWD\s12\.500/)

  // Edit from the list: a grouped amount and a new name.
  await row.getByRole('link', { name: item.code }).click()
  await page.waitForURL(new RegExp(`/items/${item.id}$`))
  item.nameEn = 'Oil filter, long life'
  await field(page, 'Name (English)').fill(item.nameEn)
  await field(page, 'Unit cost').fill('1,250.75')
  await saveChanges(page)

  await page.goto('/items')
  await searchList(page, item.code)
  await expect(listRow(page, item.code)).toContainText(item.nameEn)
  await expect(listRow(page, item.code)).toContainText(/KWD\s1,250\.750/)
})

test('supplier items: a supplier, then a supplier item entered by part code', async ({ page }) => {
  const supplier = {
    code: 'SUP-GULF',
    nameEn: 'Gulf Parts Trading',
    leadTimeP50: '7',
    leadTimeP90: '14',
  }
  await createSupplier(page, supplier)

  await openNewForm(page, '/suppliers/supplier-items')
  await field(page, 'Supplier').selectOption({ label: optionLabel(supplier.code, supplier.nameEn) })
  await field(page, 'Part code').fill('NO-SUCH-PART')
  await field(page, 'Lead time (days)').fill('10')
  await field(page, 'Unit price').fill('8.5')
  await createButton(page).click()
  await expectFieldError(page, 'Part code', 'No item has this code.')
  await expect(field(page, 'Unit price')).toHaveValue('8.5')

  await field(page, 'Part code').fill(item.code)
  await submitNew(page, '/suppliers/supplier-items')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `${supplier.code} · ${item.code}`,
  )

  await page.goto('/suppliers/supplier-items')
  const row = listRow(page, item.code)
  await expect(row).toContainText(supplier.code)
  await expect(row).toContainText(/SAR\s8\.50/)
})

test('work calendars and holiday overrides: weekday checkboxes, overlapping dates refused', async ({
  page,
}) => {
  const calendar = { code: 'CAL-RETAIL', nameEn: 'Retail calendar' }
  await openNewForm(page, '/locations/calendars')
  await field(page, 'Code').fill(calendar.code)
  await field(page, 'Name (English)').fill(calendar.nameEn)
  await weekday(page, 'Friday').check()
  await weekday(page, 'Saturday').check()
  await submitNew(page, '/locations/calendars')
  await expect(weekday(page, 'Friday')).toBeChecked()
  await expect(weekday(page, 'Saturday')).toBeChecked()
  await expect(weekday(page, 'Sunday')).not.toBeChecked()

  await page.goto('/locations/calendars')
  await expect(listRow(page, calendar.code)).toContainText('Fri, Sat')

  // Two closures of the same calendar may not share a day.
  const scope = optionLabel(calendar.code, calendar.nameEn)
  await openNewForm(page, '/locations/holidays')
  await field(page, 'Applies to').selectOption({ label: scope })
  await field(page, 'From').fill('2026-12-01')
  await field(page, 'To').fill('2026-12-03')
  await field(page, 'Name (English)').fill('Stocktake')
  await submitNew(page, '/locations/holidays')

  await openNewForm(page, '/locations/holidays')
  await field(page, 'Applies to').selectOption({ label: scope })
  await field(page, 'From').fill('2026-12-03')
  await field(page, 'To').fill('2026-12-05')
  await field(page, 'Name (English)').fill('Year-end closure')
  await createButton(page).click()
  await expectFieldError(page, 'From', 'This overlaps an existing entry.')
  await expect(page).toHaveURL(/\/locations\/holidays\/new$/)
})

test('network links: a lane from a location to itself is refused, a valid lane saves', async ({
  page,
}) => {
  const central = { code: 'LOC-RUH', nameEn: 'Riyadh central warehouse' }
  const branch = { code: 'LOC-JED', nameEn: 'Jeddah branch' }
  await createLocation(page, central)
  await createLocation(page, branch)

  await openNewForm(page, '/locations/network')
  await field(page, 'From location').selectOption({
    label: optionLabel(central.code, central.nameEn),
  })
  await field(page, 'To location').selectOption({
    label: optionLabel(central.code, central.nameEn),
  })
  await field(page, 'Typical lead time (p50, days)').fill('2')
  await field(page, 'Slow lead time (p90, days)').fill('4')
  await createButton(page).click()
  await expectFieldError(page, 'To location', 'Choose two different values.')

  await field(page, 'To location').selectOption({ label: optionLabel(branch.code, branch.nameEn) })
  await field(page, 'Freight basis').selectOption({ label: 'Per unit' })
  await field(page, 'Freight cost').fill('1.5')
  await field(page, 'Freight currency').selectOption('SAR')
  await submitNew(page, '/locations/network')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `${central.code} → ${branch.code}`,
  )

  await page.goto('/locations/network')
  const row = listRow(page, central.code)
  await expect(row).toContainText(branch.code)
  await expect(row).toContainText(/SAR\s1\.50/)
})

test('exchange rates: the reverse pair on the same date is refused', async ({ page }) => {
  await openNewForm(page, '/suppliers/fx-rates')
  await field(page, 'From currency').selectOption('USD')
  await field(page, 'To currency').selectOption('SAR')
  await field(page, 'Valid from').fill('2026-10-01')
  await field(page, 'Rate').fill('3.75')
  await submitNew(page, '/suppliers/fx-rates')

  await openNewForm(page, '/suppliers/fx-rates')
  await field(page, 'From currency').selectOption('SAR')
  await field(page, 'To currency').selectOption('USD')
  await field(page, 'Valid from').fill('2026-10-01')
  await field(page, 'Rate').fill('0.2666666667')
  await createButton(page).click()
  await expectFieldError(page, 'Valid from', 'The reverse rate for this date already exists.')

  await page.goto('/suppliers/fx-rates')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(listRow(page, 'USD')).toContainText('3.75')
})

test('supersessions: a chain is allowed, closing it into a cycle is refused', async ({ page }) => {
  const parts = ['PART-A', 'PART-B', 'PART-C']
  for (const code of parts) await createItem(page, { code, nameEn: `Chain part ${code}` })

  const [a, b, c] = parts as [string, string, string]
  await fillSupersession(page, a, b)
  await submitNew(page, '/items/supersessions')
  await fillSupersession(page, b, c)
  await submitNew(page, '/items/supersessions')

  await fillSupersession(page, c, a)
  await createButton(page).click()
  await expectFieldError(page, 'Successor part code', 'This would create a cycle.')
  await expect(page).toHaveURL(/\/items\/supersessions\/new$/)
})

test('an item form from a stale tab is refused after switching organizations elsewhere', async ({
  page,
  context,
}) => {
  // Creating a second organization makes it active; switch back before opening the form.
  await createOrganization(page, otherOrganization)
  await switchOrganization(page, otherOrganization.name, organization.name)
  await page.goto(`/items/${item.id}`)
  await expect(field(page, 'Name (English)')).toHaveValue(item.nameEn)

  // Another tab of the same browser switches to the other organization.
  const otherTab = await context.newPage()
  await otherTab.goto('/dashboard')
  await switchOrganization(otherTab, organization.name, otherOrganization.name)
  await otherTab.close()

  await field(page, 'Name (English)').fill(`${item.nameEn} (stale)`)
  await saveButton(page).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'The active organization changed in another tab or window.' }),
  ).toBeVisible()

  // Nothing was saved; the owner ends on the first organization again for the next tests.
  await page.goto('/dashboard')
  await switchOrganization(page, otherOrganization.name, organization.name)
  await page.goto(`/items/${item.id}`)
  await expect(field(page, 'Name (English)')).toHaveValue(item.nameEn)
})

test('a viewer sees master data read-only and cannot open a new form', async ({
  browser,
  page,
  request,
}) => {
  await expectActiveOrganization(page, organization.name)
  await inviteMember(page, viewer.email, 'Viewer')

  // An existing account gets a sign-in link that leads to the invitation (organizations.spec).
  const link = await waitForEmailLink(request, viewer.email, /\/auth\/(?:confirm|callback)\?/)
  const context = await browser.newContext()
  const viewerPage = await context.newPage()
  await viewerPage.goto(link)
  await viewerPage.waitForURL(/\/invitations\/[0-9a-f-]{36}(?:[?#].*)?$/)
  await viewerPage.getByRole('button', { name: 'Accept and continue', exact: true }).click()
  await viewerPage.waitForURL(DASHBOARD_URL)
  await expectActiveOrganization(viewerPage, organization.name)

  // Lists without "New".
  for (const path of ['/items', '/items/brands', '/locations/network', '/suppliers/fx-rates']) {
    await viewerPage.goto(path)
    await expect(viewerPage.locator('tbody tr').first()).toBeVisible()
    await expect(viewerPage.getByRole('link', { name: 'New', exact: true })).toHaveCount(0)
  }

  // The edit page shows the record with every field disabled and no Save or Delete.
  await viewerPage.goto(`/items/${item.id}`)
  await expect(field(viewerPage, 'Name (English)')).toHaveValue(item.nameEn)
  await expect(field(viewerPage, 'Name (English)')).toBeDisabled()
  await expect(field(viewerPage, 'Unit cost')).toBeDisabled()
  await expect(field(viewerPage, 'Brand')).toBeDisabled()
  await expect(viewerPage.getByText('You can view this record but not change it.')).toBeVisible()
  await expect(saveButton(viewerPage)).toHaveCount(0)
  await expect(viewerPage.getByRole('button', { name: 'Delete' })).toHaveCount(0)

  // /items/new does not exist for a viewer.
  await viewerPage.goto('/items/new')
  await expect(viewerPage.getByText('This page could not be found.')).toBeVisible()
  await expect(createButton(viewerPage)).toHaveCount(0)
  await viewerPage.goto('/forecasts')
  await expect(
    viewerPage.getByRole('heading', { name: 'Review your planning results', exact: true }),
  ).toBeVisible()
  await expect(
    viewerPage.getByRole('form', { name: 'Check demand data', exact: true }),
  ).toHaveCount(0)
  await expect(viewerPage.getByRole('link', { name: 'Create forecast', exact: true })).toHaveCount(
    0,
  )
  await expect(
    viewerPage.getByRole('link', { name: 'Saved forecast quality', exact: true }),
  ).toBeVisible()
  await context.close()
})

test('settings: an admin sets time zone and numbering, the viewer sees them read-only', async ({
  browser,
  page,
}) => {
  await openSettings(page)
  await field(page, 'Time zone').selectOption('Asia/Dubai')
  await field(page, 'Numbering').selectOption('arab')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible()
  await page.reload()
  await expect(field(page, 'Time zone')).toHaveValue('Asia/Dubai')
  await expect(field(page, 'Numbering')).toHaveValue('arab')

  const context = await browser.newContext()
  const viewerPage = await context.newPage()
  await signInWithPassword(viewerPage, viewer.email, viewer.password)
  await expectActiveOrganization(viewerPage, organization.name)
  await openSettings(viewerPage)
  await expect(summaryValue(viewerPage, 'Default language')).toHaveText('English')
  await expect(summaryValue(viewerPage, 'Time zone')).toHaveText('Asia/Dubai')
  await expect(summaryValue(viewerPage, 'Numbering')).toHaveText('Arabic-Indic (١٢٣)')
  await expect(
    viewerPage.getByText('Only owners and administrators can change these preferences.'),
  ).toBeVisible()
  await expect(field(viewerPage, 'Time zone')).toHaveCount(0)
  await expect(viewerPage.getByRole('button', { name: 'Save preferences' })).toHaveCount(0)
  await context.close()
})

/** A weekend-day checkbox of the work calendar form, by weekday name. */
function weekday(page: Page, name: string) {
  return page.getByRole('checkbox', { name, exact: true })
}

/** Opens a new supersession form with both part codes and an effective date filled in. */
async function fillSupersession(page: Page, from: string, to: string): Promise<void> {
  await openNewForm(page, '/items/supersessions')
  await field(page, 'Replaced part code').fill(from)
  await field(page, 'Successor part code').fill(to)
  await field(page, 'Effective from').fill('2026-11-01')
}

/** The value next to a label in a read-only settings summary (dt/dd pairs). */
function summaryValue(page: Page, label: string) {
  return page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')
}
