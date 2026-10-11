import { expect, type Locator, type Page } from '@playwright/test'

/*
 * Helpers for the master-data screens (src/components/master-data). Labels come from en.json:
 * MasterDataClient (buttons), MasterData.form / MasterData.list (notices, pager) and the entity
 * namespaces (field labels). Every form posts through saveEntity, which redirects a created record
 * to `<basePath>/<id>?notice=created` and answers an update in place with "Saved.".
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Escapes a literal for use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Create', exact: true })
}

export function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Save changes', exact: true })
}

/** The form control labelled exactly `label` (inputs, selects, switches). */
export function field(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true })
}

/** Opens `<basePath>/new` and waits for the form. */
export async function openNewForm(page: Page, basePath: string): Promise<void> {
  await page.goto(`${basePath}/new`)
  await expect(createButton(page)).toBeVisible()
}

/**
 * Clicks Create and waits for the redirect to the new record's page; returns the record's id.
 */
export async function submitNew(page: Page, basePath: string): Promise<string> {
  const created = new RegExp(`${escapeRegExp(basePath)}/(${UUID})\\?notice=created$`)
  await createButton(page).click()
  await page.waitForURL(created)
  await expect(page.getByText('Created.', { exact: true })).toBeVisible()
  const id = created.exec(page.url())?.[1]
  if (!id) throw new Error(`No record id in ${page.url()}`)
  return id
}

/** Clicks "Save changes" on an edit page and waits for the "Saved." status. */
export async function saveChanges(page: Page): Promise<void> {
  await saveButton(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
}

/**
 * The field is marked invalid and its accessible description (hint plus error, through
 * aria-describedby) carries `message`, so the error is tied to that field and not just on the page.
 */
export async function expectFieldError(page: Page, label: string, message: string): Promise<void> {
  const control = field(page, label)
  await expect(control).toHaveAttribute('aria-invalid', 'true')
  await expect(control).toHaveAccessibleDescription(new RegExp(escapeRegExp(message)))
}

/** Deletes the record open on its edit page through the confirmation dialog. */
export async function deleteRecord(page: Page, basePath: string): Promise<void> {
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL(new RegExp(`${escapeRegExp(basePath)}\\?notice=deleted$`))
  await expect(page.getByText('Deleted.', { exact: true })).toBeVisible()
}

/** Searches a list through its toolbar (submits on Enter) and waits for the new URL. */
export async function searchList(page: Page, query: string): Promise<void> {
  const box = page.getByRole('searchbox')
  await box.fill(query)
  await box.press('Enter')
  await page.waitForURL((url) => url.searchParams.get('q') === query)
}

/** The body row of a list table that contains `text`. */
export function listRow(page: Page, text: string): Locator {
  return page.locator('tbody tr').filter({ hasText: text })
}

/** The pager's "N rows · Page X of Y" line. */
export function pagerSummary(page: Page): Locator {
  return page.getByText(/^[\d,]+ rows? · Page [\d,]+ of [\d,]+$/)
}

/* ------------------------------------------------------------------------------------------ */
/* Entities                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export type BrandInput = { code: string; nameEn: string; nameAr?: string }

export async function fillBrand(page: Page, brand: BrandInput): Promise<void> {
  await field(page, 'Code').fill(brand.code)
  await field(page, 'Name (English)').fill(brand.nameEn)
  if (brand.nameAr !== undefined) await field(page, 'Name (Arabic)').fill(brand.nameAr)
}

/** Creates a brand through /items/brands/new and returns its id. */
export async function createBrand(page: Page, brand: BrandInput): Promise<string> {
  await openNewForm(page, '/items/brands')
  await fillBrand(page, brand)
  return submitNew(page, '/items/brands')
}

export type ItemInput = {
  code: string
  nameEn: string
  productGroup?: string
  unitCost?: string
  currency?: string
  /** The brand option's label, `<code> · <English name>`. */
  brand?: string
}

export async function fillItem(page: Page, item: ItemInput): Promise<void> {
  await field(page, 'Part code').fill(item.code)
  await field(page, 'Name (English)').fill(item.nameEn)
  if (item.brand) await field(page, 'Brand').selectOption({ label: item.brand })
  await field(page, 'Product group').fill(item.productGroup ?? 'Filters')
  await field(page, 'Unit cost').fill(item.unitCost ?? '10')
  if (item.currency) await field(page, 'Currency').selectOption(item.currency)
}

/** Creates an item through /items/new and returns its id. */
export async function createItem(page: Page, item: ItemInput): Promise<string> {
  await openNewForm(page, '/items')
  await fillItem(page, item)
  return submitNew(page, '/items')
}

export type LocationInput = { code: string; nameEn: string }

/** Creates a location (type Branch, the organization's home country) and returns its id. */
export async function createLocation(page: Page, location: LocationInput): Promise<string> {
  await openNewForm(page, '/locations')
  await field(page, 'Code').fill(location.code)
  await field(page, 'Name (English)').fill(location.nameEn)
  return submitNew(page, '/locations')
}

export type SupplierInput = {
  code: string
  nameEn: string
  leadTimeP50: string
  leadTimeP90: string
}

/** Creates a supplier (home country, base currency) and returns its id. */
export async function createSupplier(page: Page, supplier: SupplierInput): Promise<string> {
  await openNewForm(page, '/suppliers')
  await field(page, 'Code').fill(supplier.code)
  await field(page, 'Name (English)').fill(supplier.nameEn)
  await field(page, 'Typical lead time (p50, days)').fill(supplier.leadTimeP50)
  await field(page, 'Slow lead time (p90, days)').fill(supplier.leadTimeP90)
  return submitNew(page, '/suppliers')
}

/** The label a reference select shows for a code/name record (query.ts codeNameOptions). */
export function optionLabel(code: string, nameEn: string): string {
  return `${code} · ${nameEn}`
}
