import { expect, type Page } from '@playwright/test'

export const INVITATION_URL = /\/invitations\/[^/?#]+(?:[?#].*)?$/

/** Role labels as rendered from Roles.* in en.json. */
export type RoleLabel =
  'Owner' | 'Administrator' | 'Planner' | 'Approver' | 'Branch user' | 'Viewer'

/**
 * Sends an invitation from Settings > Invitations. The form is located by its submit button so
 * the Members table's own "Role" selects do not interfere.
 */
export async function inviteMember(page: Page, email: string, role: RoleLabel): Promise<void> {
  if (!/\/settings(?:[?#].*)?$/.test(page.url())) await page.goto('/settings')
  const form = page.locator('form', {
    has: page.getByRole('button', { name: 'Send invitation', exact: true }),
  })
  await form.getByLabel('Email', { exact: true }).fill(email)
  await form.getByLabel('Role', { exact: true }).selectOption({ label: role })
  await form.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible()
}

/** Revokes the pending invitation addressed to `email` from Settings and checks it disappears. */
export async function revokeInvitation(page: Page, email: string): Promise<void> {
  if (!/\/settings(?:[?#].*)?$/.test(page.url())) await page.goto('/settings')
  const revoke = page.getByRole('button', { name: 'Revoke', exact: true })
  // The innermost element holding both the address and a Revoke button is that invitation's row.
  const row = page.locator('li, tr, div').filter({ hasText: email }).filter({ has: revoke }).last()
  await row.getByRole('button', { name: 'Revoke', exact: true }).click()
  await expect(row).toBeHidden()
  // A fresh render drops the invite form's "Invitation sent to …" confirmation as well.
  await page.reload()
  await expect(page.getByText(email)).toHaveCount(0)
}

/**
 * Completes an /auth/invite link for a brand-new user: verify the token with the Accept button,
 * then set (or skip) the password on /auth/set-password and arrive on /invitations/<id>.
 */
export async function completeInviteLink(
  page: Page,
  link: string,
  password: string | null,
): Promise<void> {
  await page.goto(link)
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
  await page.waitForURL(/\/auth\/set-password(?:[?#].*)?$/)
  if (password) {
    await page.getByLabel('New password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Save password', exact: true }).click()
  } else {
    await page.getByText('Skip for now').click()
  }
  await page.waitForURL(INVITATION_URL)
}
