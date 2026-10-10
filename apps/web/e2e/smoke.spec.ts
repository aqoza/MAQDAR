import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signOut } from './helpers/auth'
import {
  ORGANIZATIONS_URL,
  createOrganization,
  expectActiveOrganization,
  expectAppShell,
  openSettings,
} from './helpers/organizations'

const run = Date.now()
const PASSWORD = `Smoke-pass-${run}`

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/)
  await expect(page.getByRole('heading', { name: 'Sign in to MAQDAR' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
})

test('a seeded user creates an organization, uses the shell and mirrors for Arabic', async ({
  page,
}) => {
  const email = `smoke-${run}@example.com`
  const organization = { name: `Smoke Org ${run}`, slug: `smoke-${run}`, arabicEnabled: true }
  await createConfirmedUser(email, PASSWORD)

  // Without a membership the app sends the user to the organizations hub.
  await signInWithPassword(page, email, PASSWORD)
  await expect(page).toHaveURL(ORGANIZATIONS_URL)
  await expect(page.getByText('You do not belong to an organization yet.')).toBeVisible()

  await createOrganization(page, organization)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expectAppShell(page)
  await expectActiveOrganization(page, organization.name)

  // Arabic is enabled for this organization, so the switch mirrors the whole document.
  await openSettings(page)
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.getByRole('link', { name: 'الإعدادات' })).toBeVisible()

  await page.getByRole('radio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()

  await signOut(page)
})
