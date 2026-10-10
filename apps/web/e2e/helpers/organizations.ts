import { expect, type Page } from '@playwright/test'

export const DASHBOARD_URL = /\/dashboard(?:[?#].*)?$/
export const ORGANIZATIONS_URL = /\/organizations(?:[?#].*)?$/

/** The seven sidebar entries of the app shell (Nav.* in en.json). */
export const NAV_LABELS = [
  'Dashboard',
  'Items',
  'Locations',
  'Suppliers',
  'Forecasts',
  'Replenishment',
  'Settings',
] as const

export type NewOrganization = {
  name: string
  slug: string
  arabicEnabled?: boolean
  baseCurrency?: string
  homeCountry?: string
}

/**
 * Creates an organization through /organizations/new and waits for the dashboard. The slug is
 * only typed when the field is editable (it may be derived from the name); either way the caller
 * passes unique values per run.
 */
export async function createOrganization(page: Page, organization: NewOrganization): Promise<void> {
  const {
    name,
    slug,
    arabicEnabled = false,
    baseCurrency = 'SAR',
    homeCountry = 'SA',
  } = organization

  await page.goto('/organizations/new')
  await page.getByLabel('Name', { exact: true }).fill(name)
  const slugInput = page.getByLabel('URL identifier', { exact: true })
  if (await slugInput.isEditable()) await slugInput.fill(slug)
  await page.getByLabel('Base currency', { exact: true }).selectOption(baseCurrency)
  await page.getByLabel('Home country', { exact: true }).selectOption(homeCountry)

  const toggle = arabicToggle(page)
  if (arabicEnabled) await toggle.check()
  else await toggle.uncheck()

  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await page.waitForURL(DASHBOARD_URL)
}

/** The "Enable Arabic" control, rendered either as a Base UI switch or a native checkbox. */
function arabicToggle(page: Page) {
  const name = 'Enable Arabic for this organization'
  return page.getByRole('switch', { name }).or(page.getByRole('checkbox', { name }))
}

/** Every sidebar link is present. */
export async function expectAppShell(page: Page): Promise<void> {
  for (const label of NAV_LABELS) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
}

/** The organization switcher (closed) names the active organization. */
export async function expectActiveOrganization(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
}

/** Opens the switcher, picks another organization and waits for the dashboard to show it. */
export async function switchOrganization(page: Page, from: string, to: string): Promise<void> {
  const trigger = page
    .getByRole('button', { name: from })
    .or(page.getByRole('button', { name: 'Organization', exact: true }))
  await trigger.first().click()
  await page.getByRole('menu').getByText(to, { exact: true }).click()
  await page.waitForURL(DASHBOARD_URL)
  await expectActiveOrganization(page, to)
}

/** Opens Settings from the sidebar. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings(?:[?#].*)?$/)
}
