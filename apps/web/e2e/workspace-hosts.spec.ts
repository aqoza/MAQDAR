import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  localEmailToken,
  seedWorkspaceMembership,
  signedInClient,
} from './helpers/auth'

const run = Date.now()
const email = `workspace-host-${run}@example.com`
const password = `Workspace-${run}-pass`
const memberEmail = `workspace-outsider-${run}@example.com`
let otherOrganizationId: string
let invitationId: string
const workspaceId = '00000000-0000-4000-8000-000000000095'

test.beforeAll(async () => {
  const userId = await createConfirmedUser(email, password)
  await createConfirmedUser(memberEmail, password)
  await seedWorkspaceMembership(userId)
  const client = await signedInClient(email, password)
  const org = await client.rpc('create_organization', {
    p_name: `Unrelated organization ${run}`,
    p_slug: `unrelated-host-${run}`,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  if (org.error) throw org.error
  otherOrganizationId = org.data as string
  const refreshed = await client.auth.refreshSession()
  if (refreshed.error) throw refreshed.error
  const invite = await client.rpc('invite_member', {
    p_organization_id: otherOrganizationId,
    p_email: memberEmail,
    p_role: 'viewer',
  })
  if (invite.error) throw invite.error
  invitationId = invite.data[0].id as string
})

test('public homepage, workspace finder and unknown host boundary', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Keep the right parts.')
  await page.getByRole('link', { name: 'Client sign in', exact: true }).first().click()
  await page.getByLabel('Workspace name').fill('https://evil.example')
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await expect(page.locator('#workspace-error')).toContainText('couldn’t find')
  await page.getByLabel('Workspace name').fill('ote')
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await expect(page).toHaveURL(new RegExp(`http://ote.localhost:${new URL(baseURL!).port}/login`))
  await expect(page.getByText('OTEGROUP workspace', { exact: true })).toBeVisible()
  const unknown = await request.get('/login', { headers: { host: 'unknown.zeespare.com' } })
  expect(unknown.status()).toBe(404)
})

test('OTE hostname hides unrelated memberships and recovers a mismatched active claim', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  await page.goto(`${origin}/login`)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/organizations`)
  await expect(page.getByText('OTE workspace fixture', { exact: true })).toBeVisible()
  await expect(page.getByText(`Unrelated organization ${run}`, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create organization', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/dashboard`)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  const cookies = await page.context().cookies()
  for (const cookie of cookies.filter((value) => value.name.startsWith('sb-'))) {
    expect(cookie.domain).toBe('ote.localhost')
  }
  await page.goto(`${origin}/organizations/new`)
  await expect(page).toHaveURL(`${origin}/organizations`)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/login`)
})

test('a nonmember sees no other organizations or invitations on the tenant host', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  await page.goto(`${origin}/login`)
  await page.getByLabel('Email', { exact: true }).fill(memberEmail)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Access to OTEGROUP is required')).toBeVisible()
  await expect(page.getByText(`Unrelated organization ${run}`, { exact: true })).toHaveCount(0)
  await page.goto(`${origin}/invitations/${invitationId}`)
  await expect(page.getByRole('button', { name: 'Accept and continue' })).toHaveCount(0)
  await expect(page.getByText('This invitation is for someone else', { exact: true })).toBeVisible()
})

test('tenant POSTs reject sibling origins even when forwarded headers are forged', async ({
  request,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  const response = await request.post(`${baseURL}/api/imports`, {
    headers: { host: new URL(origin).host, origin: baseURL! },
    data: {},
  })
  expect(response.status()).toBe(403)
  expect(await response.json()).toEqual({ code: 'cross_origin' })
  expect(response.headers()['cache-control']).toContain('no-store')
  const forged = await request.post(`${baseURL}/api/imports`, {
    headers: { host: new URL(origin).host, origin, 'x-forwarded-host': new URL(baseURL!).host },
    data: {},
  })
  expect(forged.status()).toBe(400)
})

test('email callbacks retain tenant host and do not consume invitation tokens on GET', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  await page.goto(`${origin}/auth/email/invitations/${workspaceId}?token_hash=invalid&type=invite`)
  await expect(page).toHaveURL(new RegExp(`${origin}/auth/invite\\?`))
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/login?error=inviteExpired`)
  await page.goto(`${origin}/auth/email/dashboard?token_hash=invalid&type=email`)
  await expect(page).toHaveURL(`${origin}/login?error=link`)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`public layout ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.screenshot({
      path: testInfo.outputPath(`public-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    })
  })
}

function renderedEmailLink(
  template: 'invite' | 'sign-in-link',
  origin: string,
  next: string,
  token: string,
) {
  const source = readFileSync(
    path.join(__dirname, '../../../supabase/templates', `${template}.html`),
    'utf8',
  )
  const html = source
    .replaceAll('{{ .RedirectTo }}', `${origin}/auth/email${next}`)
    .replaceAll('{{ .TokenHash }}', token)
    .replaceAll('&amp;', '&')
  const match = /href="([^"]+)"/.exec(html)
  if (!match?.[1]) throw new Error('Template has no callback link')
  return match[1]
}

test('the actual sign-in template verifies an OTP on the tenant host', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  const client = await signedInClient(email, password)
  const selected = await client.rpc('set_active_organization', { p_organization_id: workspaceId })
  if (selected.error) throw selected.error
  const token = await localEmailToken(email, 'magiclink')
  await page.goto(renderedEmailLink('sign-in-link', origin, '/dashboard', token))
  await expect(page).toHaveURL(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Organization', exact: true })).toContainText(
    'OTE workspace fixture',
  )
  await page.screenshot({ path: test.info().outputPath('workspace-success.png') })
})

test('the actual invite template survives GET and joins only the bound organization', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'ote.localhost')
  const invitedEmail = `ote-email-${Date.now()}@example.com`
  const client = await signedInClient(email, password)
  const invited = await client.rpc('invite_member', {
    p_organization_id: workspaceId,
    p_email: invitedEmail,
    p_role: 'viewer',
  })
  if (invited.error) throw invited.error
  const id = invited.data[0].id
  const token = await localEmailToken(invitedEmail, 'invite')
  await page.goto(renderedEmailLink('invite', origin, `/invitations/${id}`, token))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${origin}/auth/set-password`))
  await page.getByText('Skip for now', { exact: true }).click()
  await expect(page).toHaveURL(`${origin}/invitations/${id}`)
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Organization', exact: true })).toContainText(
    'OTE workspace fixture',
  )
})

test('tenant login keeps both options visible on the smallest supported phone', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${baseURL!.replace('localhost', 'ote.localhost')}/login`)
  for (const name of ['Sign in', 'Email me a sign-in link']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
  }
  await page.screenshot({ path: testInfo.outputPath('ote-login-320x568.png') })
})
