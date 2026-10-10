import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  getAuthUser,
  signedInClient,
  signInWithPassword,
  signOut,
} from './helpers/auth'
import { completeInviteLink, inviteMember, revokeInvitation } from './helpers/invitations'
import { waitForEmailLink } from './helpers/mailpit'
import {
  DASHBOARD_URL,
  createOrganization,
  expectActiveOrganization,
} from './helpers/organizations'

const run = Date.now()
const PASSWORD = `Invite-pass-${run}`
const owner = { email: `invite-owner-${run}@example.com`, password: PASSWORD }
const organization = { name: `Invite Org ${run}`, slug: `invite-${run}` }

// One owner with one organization, created through the UI, serves every test in this file.
test.beforeAll(async ({ browser }) => {
  await createConfirmedUser(owner.email, owner.password)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, owner.email, owner.password)
  await createOrganization(page, organization)
  await context.close()
})

test('a new user is invited as planner, accepts and can sign in with a password', async ({
  browser,
  page,
  request,
}) => {
  const invitee = `invite-planner-${run}@example.com`
  const inviteePassword = `Planner-pass-${run}`

  await signInWithPassword(page, owner.email, owner.password)
  await inviteMember(page, invitee, 'Planner')
  const link = await waitForEmailLink(request, invitee, /\/auth\/invite\?/)

  // The invitee has no session yet: a fresh browser context stands in for their browser.
  const context = await browser.newContext()
  const invitedPage = await context.newPage()
  await completeInviteLink(invitedPage, link, inviteePassword)
  await expect(invitedPage.getByText(`Join ${organization.name}`)).toBeVisible()
  await invitedPage.getByRole('button', { name: 'Accept and continue', exact: true }).click()
  await invitedPage.waitForURL(DASHBOARD_URL)
  await expectActiveOrganization(invitedPage, organization.name)
  await expect(invitedPage.getByText('Planner', { exact: true }).first()).toBeVisible()

  // The password chosen during onboarding works for the next sign-in.
  await signOut(invitedPage)
  await signInWithPassword(invitedPage, invitee, inviteePassword)
  await expect(invitedPage).toHaveURL(DASHBOARD_URL)
  await expectActiveOrganization(invitedPage, organization.name)
  await context.close()
})

test('a magic-link request for an unknown address gets the neutral confirmation', async ({
  page,
}) => {
  const unknown = `nobody-${run}@example.com`
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(unknown)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('status')).toContainText(`If ${unknown} has a MAQDAR account`)
})

test('a revoked invitation is refused when its invitee opens the link', async ({
  browser,
  page,
  request,
}) => {
  const invitee = `invite-revoked-${run}@example.com`

  await signInWithPassword(page, owner.email, owner.password)
  await inviteMember(page, invitee, 'Viewer')
  const link = await waitForEmailLink(request, invitee, /\/auth\/invite\?/)
  await revokeInvitation(page, invitee)

  // The e-mail token still verifies the mailbox, but the invitation itself is gone.
  const context = await browser.newContext()
  const invitedPage = await context.newPage()
  await completeInviteLink(invitedPage, link, null)
  await expect(invitedPage.getByText('This invitation is for someone else')).toBeVisible()
  await expect(invitedPage.getByRole('button', { name: 'Accept and continue' })).toHaveCount(0)
  await context.close()
})

test('an e-mail change stays pending until confirmed, so it cannot be used to claim an invitation', async () => {
  // Invitations are bound to auth.users.email. With e-mail confirmations on, updateUser({ email })
  // only records new_email and mails a confirmation; the address used for matching stays the same.
  const attacker = { email: `invite-attacker-${run}@example.com`, password: `Attacker-pass-${run}` }
  const target = `invite-target-${run}@example.com`
  const attackerId = await createConfirmedUser(attacker.email, attacker.password)

  const client = await signedInClient(attacker.email, attacker.password)
  const { error } = await client.auth.updateUser({ email: target })
  expect(error).toBeNull()

  const user = await getAuthUser(attackerId)
  expect(user.email).toBe(attacker.email)
  expect(user.new_email).toBe(target)
})
