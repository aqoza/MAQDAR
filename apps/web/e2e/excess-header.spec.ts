import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

test('excess header actions preserve shared typography and mobile targets', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const key = randomUUID()
  const email = `excess-header-${key}@example.com`
  const password = `Header-${key}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, {
    name: 'Header QA',
    slug: `excess-header-${key}`,
    arabicEnabled: true,
  })
  const measurements = []
  for (const locale of ['en', 'ar']) {
    if (locale === 'ar') {
      await page.goto('/settings')
      await selectSettingsSection(page, 'language')
      await page.getByRole('radio', { name: 'العربية' }).click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    }
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 375, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const { width } = viewport
      await page.setViewportSize(viewport)
      for (const route of ['/replenishment/excess', '/replenishment/excess/new']) {
        await page.goto(route)
        await page.evaluate(() => document.fonts.ready)
        const banner = page.locator('[data-page-banner="replenishment"]')
        await expect(banner).toHaveCount(1)
        const title = page.getByRole('heading', { level: 1 })
        await expect(title).toHaveCSS('font-size', '20px')
        await expect(title).toHaveCSS('line-height', '28px')
        await expect(title).toHaveCSS('font-weight', '600')
        const family = await page
          .locator('html')
          .evaluate((node) => getComputedStyle(node).fontFamily)
        await expect(title).toHaveCSS('font-family', family)
        await expect(banner.locator('.page-heading-copy > p')).toHaveCSS('font-size', '14px')
        await expect(banner.locator('.page-heading-copy > p')).toHaveCSS('line-height', '20px')
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width)
        await page.screenshot({
          path: testInfo.outputPath(
            `excess-header-${route.endsWith('/new') ? 'create' : 'list'}-${locale}-${width}.png`,
          ),
        })
        const actions = banner.locator('.page-actions a')
        for (const href of [
          '/replenishment/excess/integrations',
          '/replenishment/excess/handoffs',
          '/replenishment/excess/review',
          route.endsWith('/new') ? '/replenishment/excess' : '/replenishment/excess/new',
        ]) {
          await expect(banner.locator(`.page-actions a[href="${href}"]`)).toHaveCount(1)
        }
        measurements.push({
          locale,
          route,
          ...viewport,
          actions: await actions.evaluateAll((links) =>
            links.map((link) => {
              const css = getComputedStyle(link)
              return {
                label: link.textContent?.trim(),
                href: link.getAttribute('href'),
                height: link.getBoundingClientRect().height,
                fontSize: css.fontSize,
                lineHeight: css.lineHeight,
                fontFamily: css.fontFamily,
              }
            }),
          ),
        })
        const actionLinks = await actions.all()
        for (const action of actionLinks) {
          await expect(action).toBeVisible()
          await expect(action).toHaveCSS('font-size', '14px')
          await expect(action).toHaveCSS('line-height', '20px')
          await expect(action).toHaveCSS('font-family', family)
          const bounds = (await action.boundingBox())!
          expect(bounds.x).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
          expect(bounds.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 36)
        }
        if (width === 1366) {
          await actions.first().focus()
          for (const action of actionLinks.slice(1)) {
            await page.keyboard.press('Tab')
            await expect(action).toBeFocused()
          }
        }
      }
    }
  }
  await writeFile(testInfo.outputPath('header-actions.json'), JSON.stringify(measurements, null, 2))
})
