import { expect, test } from '@playwright/test'

const viewports = [
  { width: 320, height: 568 },
  { width: 320, height: 740 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1672, height: 941 },
]

for (const viewport of viewports) {
  test(`compact password login fits at ${viewport.width}x${viewport.height}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto(`${baseURL!.replace('localhost', 'acme.localhost')}/login`)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '32px')
    await expect(page.getByRole('img', { name: 'ZeeSpare', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toHaveCount(0)
    await expect(page.getByText(/Ask an administrator|Access is by invitation/)).toHaveCount(0)
    for (const target of [
      page.getByRole('button', { name: 'Sign in', exact: true }),
      page.getByRole('link', { name: 'Forgot password?' }),
      page.getByRole('link', { name: 'Change workspace' }),
      page.getByRole('button', { name: 'Show password', exact: true }),
    ]) {
      await expect(target).toBeInViewport({ ratio: 1 })
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    for (const label of ['Work email', 'Password']) {
      const input = page.getByLabel(label, { exact: true })
      await expect(input).toHaveCSS('font-size', '16px')
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await page.screenshot({
      path: testInfo.outputPath(`login-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    })
  })
}

test('password visibility, keyboard focus and recovery navigation remain usable', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Password', { exact: true }).fill('Example-password')
  await page.getByRole('button', { name: 'Show password', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByLabel('Work email', { exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/auth\/forgot-password$/)
  await expect(
    page.getByRole('heading', { name: 'Reset your password', exact: true }),
  ).toBeVisible()
})

test('enlarged text wraps without horizontal clipping', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '48px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('button', { name: 'Sign in', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('login-mobile-text-200.png'), fullPage: true })
})
