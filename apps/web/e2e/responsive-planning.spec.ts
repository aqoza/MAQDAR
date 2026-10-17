import { expect, test, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

const screens = [
  { path: '/dashboard', title: 'Dashboard', reset: null },
  { path: '/items', title: 'Items', reset: null },
  { path: '/items/new', title: 'New item', reset: null },
  { path: '/locations', title: 'Locations', reset: null },
  { path: '/suppliers', title: 'Suppliers', reset: null },
  { path: '/imports', title: 'Imports', reset: null },
  { path: '/forecasts', title: 'Forecasts and planning runs', reset: null },
  { path: '/forecasts/quality', title: 'Saved forecast quality', reset: 'Reset' },
  { path: '/forecasts/workbench', title: 'Policy review workbench', reset: 'Reset filters' },
  { path: '/forecasts/new', title: 'Create forecast', reset: null },
  { path: '/replenishment', title: 'Replenishment drafts', reset: 'Reset' },
  { path: '/replenishment/batches', title: 'Purchase handoff batches', reset: 'Reset' },
  { path: '/replenishment/review', title: 'Purchase proposal review', reset: null },
  { path: '/replenishment/handoffs', title: 'Purchase handoffs', reset: null },
  { path: '/replenishment/integrations', title: 'Integration workbench', reset: 'Reset' },
  {
    path: '/replenishment/redistribution',
    title: 'Redistribution drafts',
    reset: 'Show all drafts',
  },
  {
    path: '/replenishment/redistribution/dates',
    title: 'Transfer date scenarios',
    reset: 'Show all scenarios',
  },
  {
    path: '/replenishment/redistribution/freight',
    title: 'Transfer freight estimates',
    reset: 'Clear filters',
  },
  { path: '/settings', title: 'Settings', reset: null },
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
    .locator('main input:not([type=hidden]):visible, main select:visible, main textarea:visible')
    .all()) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    const width = await page.evaluate(() => document.documentElement.clientWidth)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
  }
}

for (const { width, height } of [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`application screens fit ${width}px with keyboard-accessible tables`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const run = `${Date.now()}-${width}`
    const email = `responsive-${run}@example.com`
    const password = `Responsive-pass-${run}`
    await createConfirmedUser(email, password)
    await signInWithPassword(page, email, password)
    await createOrganization(page, { name: `Responsive ${run}`, slug: `responsive-${run}` })
    await page.setViewportSize({ width, height })
    if (width === 1024) await page.emulateMedia({ reducedMotion: 'reduce' })

    for (const screen of screens) {
      await test.step(screen.path, async () => {
        await page.goto(screen.path)
        await expect(
          page.getByRole('heading', { level: 1, name: screen.title, exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
          'font-size',
          screen.path === '/dashboard' ? (width < 768 ? '32px' : '40px') : '20px',
        )
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
          'line-height',
          screen.path === '/dashboard' ? (width < 768 ? '42px' : '48px') : '28px',
        )
        if (screen.path !== '/dashboard')
          await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(245, 248, 246)')
        if (width === 1024 && screen.path === '/items') {
          await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCSS(
            'transition-property',
            'none',
          )
          await expect(
            page
              .getByRole('navigation', { name: 'Sections' })
              .getByRole('link', { name: 'Items', exact: true }),
          ).toHaveCSS('transition-property', 'none')
        }
        if (screen.path === '/forecasts') {
          await expect(
            page.getByRole('tablist', { name: 'Planning tools' }).getByRole('tab'),
          ).toHaveCount(6)
          await page.getByRole('tab', { name: 'Check demand data', exact: true }).focus()
          await page.keyboard.press('Enter')
          await expect(
            page.getByRole('tab', { name: 'Check demand data', exact: true }),
          ).toBeFocused()
          await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(245, 248, 246)')
          await expect(
            page.getByRole('button', { name: 'Check demand data', exact: true }),
          ).toHaveCount(1)
        }
        for (const control of await page
          .locator(
            'main select:visible, main input:not([type=hidden]):not([type=checkbox]):visible, main textarea:visible',
          )
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
        for (const select of await page.locator('main select:not([disabled]):visible').all()) {
          // Editable forms and master-data auto-submit filters are covered by their workflow tests.
          if (!screen.reset && screen.path !== '/forecasts') continue
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
          await page.getByRole('tab', { name: 'Saved forecast quality', exact: true }).click()
          await expect(
            page.getByRole('heading', { name: 'Saved forecast quality', exact: true }),
          ).toBeVisible()
          // Shared application styling stays consistent after client navigation.
          await expect(page.locator('main')).toHaveCSS('background-image', 'none')
          await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(245, 248, 246)')
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
