import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  test(`six tabs preserve the document and each form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/e2e/fixtures/forecast-tabs/')
    const url = page.url()
    const original = await page.evaluateHandle(() => document)
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(6)
    for (let index = 0; index < 6; index++) {
      await tabs.nth(index).click()
      const panel = page.getByRole('tabpanel')
      await expect(panel).toHaveCount(1)
      await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
      await expect(tabs.nth(index)).toHaveCSS('background-color', 'rgb(233, 244, 237)')
      await expect(tabs.nth(index)).toHaveCSS('font-weight', '600')
      await expect(panel).toHaveAttribute(
        'aria-labelledby',
        (await tabs.nth(index).getAttribute('id'))!,
      )
      await expect(panel.getByRole('heading')).toHaveText((await tabs.nth(index).textContent())!)
      await panel.getByLabel('Location code').fill(`location-${index}`)
      expect(page.url()).toBe(url)
      expect(await original.evaluate((doc) => doc === document)).toBe(true)
    }
    for (let index = 0; index < 6; index++) {
      await tabs.nth(index).click()
      await expect(page.getByRole('tabpanel').getByLabel('Location code')).toHaveValue(
        `location-${index}`,
      )
    }
    await original.dispose()
  })
}

for (const direction of ['ltr', 'rtl']) {
  test(`keyboard navigation and focus follow ${direction} direction`, async ({ page }) => {
    await page.goto('/e2e/fixtures/forecast-tabs/')
    await page.locator('html').evaluate((el, dir) => {
      el.setAttribute('dir', dir)
    }, direction)
    const tabs = page.getByRole('tab')
    await tabs.first().focus()
    await page.keyboard.press('ArrowRight')
    const next = direction === 'rtl' ? 5 : 1
    await expect(tabs.nth(next)).toBeFocused()
    await expect(tabs.nth(next)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tabs.first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(tabs.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(tabs.first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('tabpanel')).toBeFocused()
  })
}
