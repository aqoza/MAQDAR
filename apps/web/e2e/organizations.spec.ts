import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { inviteMember } from './helpers/invitations'
import { waitForEmailLink } from './helpers/mailpit'
import {
  DASHBOARD_URL,
  createOrganization,
  expectActiveOrganization,
  openSettings,
  switchOrganization,
} from './helpers/organizations'

const run = Date.now()
const PASSWORD = `Orgs-pass-${run}`
const owner = { email: `orgs-owner-${run}@example.com`, password: PASSWORD }
const viewer = { email: `orgs-viewer-${run}@example.com`, password: `Viewer-pass-${run}` }
const first = { name: `Orgs First ${run}`, slug: `orgs-first-${run}`, arabicEnabled: true }
const second = { name: `Orgs Second ${run}`, slug: `orgs-second-${run}`, arabicEnabled: false }

// The viewer test joins the second organization created by the first test.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await createConfirmedUser(owner.email, owner.password)
  await createConfirmedUser(viewer.email, viewer.password)
})

test('a member of two organizations switches between them', async ({ page }) => {
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, first)
  await expectActiveOrganization(page, first.name)

  // Creating a second organization makes it the active one.
  await createOrganization(page, second)
  await expectActiveOrganization(page, second.name)
  await openSettings(page)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(second.name)

  await page.goto('/dashboard')
  await switchOrganization(page, second.name, first.name)
  await openSettings(page)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(first.name)

  await page.goto('/dashboard')
  await switchOrganization(page, first.name, second.name)
  await openSettings(page)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(second.name)
})

test('an existing user invited as viewer joins by magic link and sees read-only settings', async ({
  browser,
  page,
  request,
}) => {
  // The owner's active organization is the second one (see the previous test).
  await signInWithPassword(page, owner.email, owner.password)
  await expectActiveOrganization(page, second.name)
  await inviteMember(page, viewer.email, 'Viewer')

  // Existing accounts get a sign-in link rather than an invite token.
  const link = await waitForEmailLink(request, viewer.email, /\/auth\/(?:confirm|callback)\?/)
  const context = await browser.newContext()
  const viewerPage = await context.newPage()
  await viewerPage.goto(link)

  // The sign-in link follows the invitation's redirect straight to the invitation page.
  await viewerPage.waitForURL(/\/invitations\/[0-9a-f-]{36}(?:[?#].*)?$/)
  await expect(viewerPage.getByText(`Join ${second.name}`, { exact: true })).toBeVisible()
  await viewerPage.getByRole('button', { name: 'Accept and continue', exact: true }).click()
  await viewerPage.waitForURL(DASHBOARD_URL)
  await expectActiveOrganization(viewerPage, second.name)
  await expect(viewerPage.getByText('Viewer', { exact: true }).first()).toBeVisible()

  // Viewers see the language card but neither the organization form nor the members tools. The
  // second organization has Arabic switched off, so the card explains that instead of offering it.
  await openSettings(viewerPage)
  await expect(
    viewerPage.getByText('Arabic is switched off for this organization.', { exact: false }),
  ).toBeVisible()
  await expect(viewerPage.getByRole('radiogroup', { name: 'Language' })).toHaveCount(0)
  await expect(viewerPage.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(viewerPage.getByRole('button', { name: 'Send invitation' })).toHaveCount(0)
  await expect(viewerPage.getByText('People with access to this organization.')).toHaveCount(0)
  await context.close()
})

test('a settings form from a stale tab is refused after switching organizations elsewhere', async ({
  page,
  context,
}) => {
  // After the previous tests the owner's active organization is the second one.
  await signInWithPassword(page, owner.email, owner.password)
  await expectActiveOrganization(page, second.name)
  await openSettings(page)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(second.name)

  // Another tab of the same browser switches to the first organization.
  const otherTab = await context.newPage()
  await otherTab.goto('/dashboard')
  await switchOrganization(otherTab, second.name, first.name)
  await otherTab.close()

  // The stale tab still shows the second organization; saving must not rename the first one.
  await page.getByLabel('Name', { exact: true }).fill(`${second.name} renamed`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('The active organization changed in another tab or window.', { exact: false }),
  ).toBeVisible()

  await page.goto('/settings')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(first.name)
})
