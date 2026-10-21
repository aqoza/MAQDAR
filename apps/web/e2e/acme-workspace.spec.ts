import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  localEmailToken,
  seedWorkspaceMembership,
  signedInClient,
} from './helpers/auth'

const run = Date.now()
const email = `acme-host-${run}@example.com`
const oteEmail = `ote-only-${run}@example.com`
const password = `Workspace-${run}-pass`
const acmeId = '00000000-0000-4000-8000-000000000096'
const oteId = '00000000-0000-4000-8000-000000000095'

test.beforeAll(async () => {
  const userId = await createConfirmedUser(email, password)
  const oteUserId = await createConfirmedUser(oteEmail, password)
  await seedWorkspaceMembership(userId, 'acme')
  await seedWorkspaceMembership(userId, 'ote')
  await seedWorkspaceMembership(oteUserId, 'ote')
  const client = await signedInClient(email, password)
  const selected = await client.rpc('set_active_organization', { p_organization_id: oteId })
  if (selected.error) throw selected.error
})

test('the public workspace finder opens ACME without accepting arbitrary destinations', async ({
  page,
  baseURL,
}) => {
  await page.goto('/workspaces')
  await page.getByLabel('Workspace name').fill('acme.evil.com')
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await expect(page.locator('#workspace-error')).toContainText('couldn’t find')
  await page.getByLabel('Workspace name').fill(' ACME ')
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await expect(page).toHaveURL(`${baseURL!.replace('localhost', 'acme.localhost')}/login`)
  await expect(page.getByText('ACME workspace', { exact: true })).toBeVisible()
})

test('ACME shows only its existing membership, recovers an OTE claim and keeps cookies on its host', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!.replace('localhost', 'acme.localhost')
  await page.goto(`${origin}/login`)
  await page.getByLabel('Work email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/organizations`)
  await expect(page.getByText('ACME workspace fixture', { exact: true })).toBeVisible()
  await expect(page.getByText('OTE workspace fixture', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create organization', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Organization', exact: true })).toContainText(
    'ACME workspace fixture',
  )
  const cookies = (await page.context().cookies()).filter((cookie) => cookie.name.startsWith('sb-'))
  expect(cookies.length).toBeGreaterThan(0)
  for (const cookie of cookies) expect(cookie.domain).toBe('acme.localhost')
  await page.goto(`${baseURL!.replace('localhost', 'ote.localhost')}/dashboard`)
  await expect(page).toHaveURL(/ote\.localhost:\d+\/login/)
  await page.goto(`${origin}/organizations/new`)
  await expect(page).toHaveURL(`${origin}/organizations`)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/login`)
})

test('an OTE-only account cannot access ACME', async ({ page, baseURL }) => {
  const origin = baseURL!.replace('localhost', 'acme.localhost')
  await page.goto(`${origin}/login`)
  await page.getByLabel('Work email', { exact: true }).fill(oteEmail)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Access to ACME is required')).toBeVisible()
  await expect(page.getByText('OTE workspace fixture', { exact: true })).toHaveCount(0)
  await page.goto(`${origin}/dashboard`)
  await expect(page).toHaveURL(`${origin}/organizations`)
})

test('ACME rejects mutations from OTE and forged forwarded hosts', async ({ request, baseURL }) => {
  const acme = new URL(baseURL!.replace('localhost', 'acme.localhost'))
  const ote = new URL(baseURL!.replace('localhost', 'ote.localhost'))
  const response = await request.post(`${baseURL}/api/imports`, {
    headers: { host: acme.host, origin: ote.origin },
    data: {},
  })
  expect(response.status()).toBe(403)
  expect(await response.json()).toEqual({ code: 'cross_origin' })
  const forged = await request.post(`${baseURL}/api/imports`, {
    headers: { host: acme.host, origin: acme.origin, 'x-forwarded-host': ote.host },
    data: {},
  })
  expect(forged.status()).toBe(400)
})

test('ACME sign-in links return to its bound workspace', async ({ page, baseURL }) => {
  const origin = baseURL!.replace('localhost', 'acme.localhost')
  const client = await signedInClient(email, password)
  const selected = await client.rpc('set_active_organization', { p_organization_id: acmeId })
  if (selected.error) throw selected.error
  const token = await localEmailToken(email, 'magiclink')
  await page.goto(`${origin}/auth/email/dashboard?token_hash=${token}&type=email`)
  await expect(page).toHaveURL(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Organization', exact: true })).toContainText(
    'ACME workspace fixture',
  )
})

test('ACME login keeps sign-in and password reset visible on mobile', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${baseURL!.replace('localhost', 'acme.localhost')}/login`)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: testInfo.outputPath('acme-login-320x568.png') })
})
