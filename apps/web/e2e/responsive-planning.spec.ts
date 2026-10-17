import { expect, test, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

const screens = [
  { path: '/forecasts', title: 'Forecasts and planning runs', reset: null },
  { path: '/forecasts/quality', title: 'Saved forecast quality', reset: 'Reset' },
  { path: '/forecasts/workbench', title: 'Policy review workbench', reset: 'Reset filters' },
  { path: '/forecasts/new', title: 'Create forecast', reset: null },
  { path: '/replenishment', title: 'Replenishment drafts', reset: 'Reset' },
  { path: '/replenishment/batches', title: 'Purchase handoff batches', reset: 'Reset' },
] as const

async function expectContainedLayout(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1)

  // No clipping the page to hide the defect: the actual form controls must fit too.
  for (const control of await page
    .locator('main input:not([type=hidden]), main select, main textarea')
    .all()) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    const width = await page.evaluate(() => document.documentElement.clientWidth)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
  }
}

for (const width of [375, 768, 1440]) {
  test(`planning screens fit ${width}px with keyboard-accessible tables`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    const run = `${Date.now()}-${width}`
    const email = `responsive-${run}@example.com`
    const password = `Responsive-pass-${run}`
    await createConfirmedUser(email, password)
    await signInWithPassword(page, email, password)
    await createOrganization(page, { name: `Responsive ${run}`, slug: `responsive-${run}` })
    await page.setViewportSize({ width, height: 900 })

    for (const screen of screens) {
      await test.step(screen.path, async () => {
        await page.goto(screen.path)
        await expect(
          page.getByRole('heading', { level: 1, name: screen.title, exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '20px')
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '28px')
        if (screen.path === '/forecasts') {
          await expect(
            page.getByRole('navigation', { name: 'Planning tools' }).getByRole('link'),
          ).toHaveCount(6)
          await page.getByRole('link', { name: 'Check demand data', exact: true }).focus()
          await page.keyboard.press('Enter')
          await expect(
            page.getByRole('form', { name: 'Check demand data', exact: true }),
          ).toBeFocused()
          await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(245, 248, 246)')
          await expect(
            page.getByRole('button', { name: 'Check demand data', exact: true }),
          ).toHaveCount(1)
        } else {
          // Other planning routes retain their existing surface.
          await expect(page.locator('main')).toHaveCSS('background-image', 'none')
          await expect(page.locator('main')).not.toHaveCSS('background-color', 'rgb(245, 248, 246)')
        }
        for (const control of await page
          .locator('main select, main input:not([type=hidden]):not([type=checkbox]), main textarea')
          .all()) {
          await expect(control).toHaveCSS('font-size', width < 768 ? '16px' : '14px')
        }
        if (screen.path === '/forecasts/quality') {
          const help = page.locator('summary').filter({ hasText: 'About these scores' })
          const explanation = page.getByText('RMSE and MAE measure error', { exact: false })
          await expect(explanation).toBeHidden()
          await help.focus()
          await page.keyboard.press('Enter')
          await expect(explanation).toBeVisible()
          await page.keyboard.press('Space')
          await expect(explanation).toBeHidden()
          await expect(
            page.getByText('Historical model-selection scores', { exact: true }),
          ).toBeVisible()
        }
        await expectContainedLayout(page)

        // Long native options caused the original overflow, even in an empty organization.
        for (const select of await page.locator('main select').all()) {
          const longest = await select
            .locator('option')
            .evaluateAll((options) =>
              options
                .reduce((longest, option) =>
                  (option.textContent?.length ?? 0) > (longest.textContent?.length ?? 0)
                    ? option
                    : longest,
                )
                .getAttribute('value'),
            )
          if (longest !== null) await select.selectOption(longest)
        }
        await expectContainedLayout(page)

        if (screen.reset) {
          const region = page.getByRole('region', { name: screen.title, exact: true })
          await page.getByRole('link', { name: screen.reset, exact: true }).focus()
          await page.keyboard.press('Tab')
          await expect(region).toBeFocused()
          if (width === 375) {
            expect(await region.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(
              0,
            )
            await page.keyboard.press('ArrowRight')
            await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
            await expectContainedLayout(page)
          }
        }
        await page.screenshot({
          path: testInfo.outputPath(`${screen.path.replaceAll('/', '-')}.png`),
          fullPage: true,
        })
        if (screen.path === '/forecasts') {
          await page.getByRole('link', { name: 'Saved forecast quality', exact: true }).click()
          await expect(
            page.getByRole('heading', { name: 'Saved forecast quality', exact: true }),
          ).toBeVisible()
          // The route-scoped accents must disappear after client navigation as well.
          await expect(page.locator('main')).toHaveCSS('background-image', 'none')
          await expect(page.locator('main')).not.toHaveCSS('background-color', 'rgb(245, 248, 246)')
        }
      })
    }

    if (width === 375) {
      const toggle = page.getByRole('button', { name: 'Toggle sidebar' })
      await toggle.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog')
      await expect(drawer).toBeVisible()
      await drawer.getByRole('link', { name: 'Forecasts', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/forecasts$/)
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      await expect(toggle).toBeFocused()
      await expectContainedLayout(page)
    }
  })
}
