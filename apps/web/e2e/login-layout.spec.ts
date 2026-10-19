import { expect, test } from '@playwright/test'

const phoneViewports = [
  { width: 320, height: 568 },
  { width: 320, height: 740 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
]

for (const viewport of phoneViewports) {
  test(`both sign-in options fit without scrolling at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/login')
    await page.evaluate(() => document.fonts.ready)

    for (const name of ['Sign in', 'Email me a sign-in link']) {
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeInViewport({ ratio: 1 })
      const bounds = await button.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 8)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }

    for (const label of ['Email', 'Password']) {
      const input = page.getByLabel(label, { exact: true })
      await expect(input).toHaveCSS('font-size', '16px')
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
  })
}
