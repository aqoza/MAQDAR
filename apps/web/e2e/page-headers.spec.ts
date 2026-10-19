import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

const sections = [
  'items',
  'locations',
  'suppliers',
  'imports',
  'forecasts',
  'replenishment',
  'settings',
]

test('illustrated headers stay compact, cover the tabs and preserve English/Arabic controls', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `headers-${key}@example.com`
  const password = `Headers-${key}`
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, { name: 'Acme', slug: `headers-${key}`, arabicEnabled: true })
  const measurements = []
  for (const locale of ['en', 'ar']) {
    if (locale === 'ar') {
      await page.goto('/settings')
      await selectSettingsSection(page, 'language')
      await page.getByRole('radio', { name: 'العربية' }).click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    }
    for (const width of locale === 'en' ? [1920, 1366, 375] : [1366, 375]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
      for (const section of sections) {
        await page.goto(`/${section}`)
        const banner = page.locator(`[data-page-banner="${section}"]`)
        if (section === 'settings') {
          await expect(page.locator('[data-settings-loading]')).toHaveCount(0)
        }
        await expect(page.locator('[data-page-banner]')).toHaveCount(1)
        await expect(banner).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '28px')
        await expect(banner.locator('.page-banner-backdrop')).toHaveAttribute('aria-hidden', 'true')
        await expect(banner.locator('svg').first()).toHaveCSS('pointer-events', 'none')
        await page.evaluate(() => document.fonts.ready)
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width)
        const background = (await banner.locator('.page-banner-backdrop').boundingBox())!
        const tagline = (await page
          .locator('[data-slot="sidebar-inset"] > header > span')
          .boundingBox())!
        const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!
        const taglineToHeadingGap = heading.y - tagline.y - tagline.height
        expect(
          taglineToHeadingGap,
          `${section} ${locale} ${width}px tagline-to-title gap`,
        ).toBeLessThanOrEqual(12)
        expect(background.y).toBeLessThanOrEqual(1)
        const navigation = banner.locator(':scope > nav, :scope > [role="tablist"]')
        if (await navigation.count()) {
          const tabs = (await navigation.boundingBox())!
          expect(background.y + background.height).toBeGreaterThanOrEqual(tabs.y + tabs.height)
        }
        if (section === 'items' && locale === 'en' && width >= 768) {
          const subtitle = (await banner.locator('.page-heading-copy p').boundingBox())!
          const tabs = (await navigation.boundingBox())!
          expect(tabs.y - subtitle.y - subtitle.height).toBeLessThanOrEqual(8)
          expect(background.height).toBeLessThanOrEqual(144)
          await banner.getByRole('link', { name: 'Import', exact: true }).focus()
          await page.keyboard.press('Tab')
          await expect(banner.getByRole('link', { name: 'New', exact: true })).toBeFocused()
        }
        await page.getByRole('heading', { level: 1 }).click()
        measurements.push({
          locale,
          width,
          section,
          background,
          taglineToHeadingGap,
          banner: await banner.boundingBox(),
        })
        await page.screenshot({ path: testInfo.outputPath(`${section}-${locale}-${width}.png`) })
      }
    }
  }
  await writeFile(
    testInfo.outputPath('header-bounds.json'),
    JSON.stringify(measurements, null, 2) + '\n',
  )
  expect(errors).toEqual([])
})
