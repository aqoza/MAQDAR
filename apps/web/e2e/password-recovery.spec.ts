import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword, signedInClient } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { waitForEmailLink } from './helpers/mailpit'

test('a real reset email survives GET/reload, updates the password and cannot be reused', async ({
  page,
  request,
  browser,
  baseURL,
}, testInfo) => {
  const id = Date.now()
  const email = `recovery-${id}@example.com`
  const oldPassword = `Previous-pass-${id}`
  const newPassword = `Updated-pass-${id}`
  await createConfirmedUser(email, oldPassword)
  const origin = baseURL!.replace('localhost', 'acme.localhost')
  await page.goto(`${origin}/login`)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page).toHaveURL(`${origin}/auth/forgot-password`)
  await expect(
    page.getByRole('heading', { name: 'Reset your password', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Work email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('If an account exists for this email')
  const link = await waitForEmailLink(request, email, /\/auth\/recover\?token_hash=/)
  expect(new URL(link).origin).toBe(origin)
  const fresh = await browser.newContext()
  const resetPage = await fresh.newPage()
  const landing = await resetPage.goto(link)
  expect(landing?.headers()['referrer-policy']).toBe('no-referrer')
  await resetPage.reload()
  await expect(resetPage.getByRole('button', { name: 'Continue to reset password' })).toBeVisible()
  await resetPage.getByRole('button', { name: 'Continue to reset password' }).click()
  await expect(resetPage).toHaveURL(/\/auth\/reset-password$/)
  await resetPage.getByLabel('New password', { exact: true }).fill(newPassword)
  await resetPage.getByLabel('Confirm new password', { exact: true }).fill('Different-password')
  await resetPage.getByRole('button', { name: 'Save new password' }).click()
  await expect(resetPage.locator('main').getByRole('alert')).toContainText(
    'The passwords do not match.',
  )
  await resetPage.getByLabel('New password', { exact: true }).fill(newPassword)
  await resetPage.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await resetPage.screenshot({ path: testInfo.outputPath('reset-password.png') })
  await resetPage.getByRole('button', { name: 'Save new password' }).click()
  await expect(resetPage).toHaveURL(`${origin}/organizations`)
  const cookies = (await fresh.cookies()).filter((cookie) => cookie.name.startsWith('sb-'))
  expect(cookies.length).toBeGreaterThan(0)
  for (const cookie of cookies) expect(cookie.domain).toBe('acme.localhost')
  await fresh.close()
  await expect(signedInClient(email, oldPassword)).rejects.toThrow()
  await signedInClient(email, newPassword)
  await page.goto(link)
  await page.getByRole('button', { name: 'Continue to reset password' }).click()
  await expect(page).toHaveURL(/\/auth\/forgot-password\?error=link$/)
  await expect(page.locator('main').getByRole('alert')).toContainText('invalid or has expired')
})

test('invalid links and unauthenticated password changes fail closed', async ({ page }) => {
  await page.goto('/auth/reset-password')
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/auth/recover?token_hash=invalid')
  await page.getByRole('button', { name: 'Continue to reset password' }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('invalid or has expired')
})

test('recovery shell supports actual Arabic locale and RTL at laptop and mobile widths', async ({
  page,
}, testInfo) => {
  const run = Date.now()
  const email = `recovery-ar-${run}@example.com`
  const password = `Arabic-pass-${run}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, {
    name: 'Recovery Arabic',
    slug: `recovery-ar-${run}`,
    arabicEnabled: true,
  })
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: page.url() }])
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/auth/forgot-password')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعادة تعيين كلمة المرور')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px')
    await expect(page.getByRole('button', { name: 'إرسال رابط إعادة التعيين' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: testInfo.outputPath(`recovery-ar-${viewport.width}.png`),
      fullPage: true,
    })
  }
})
