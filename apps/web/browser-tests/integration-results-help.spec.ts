import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`guidance overlays results and restores focus at ${width}px ${direction}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      const gutter = width === 375 ? 8 : 20
      await page.setViewportSize({ width, height: width === 375 ? 500 : 800 })
      await page.goto(`/e2e/fixtures/integration-results-help/?dir=${direction}`)
      const trigger = page.getByRole('button', { name: 'How to read these results' })
      const supplier = page.getByLabel('Supplier code')
      await supplier.fill('ACME')
      const before = await supplier.boundingBox()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: 'How to read these results' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('No report does not mean failed delivery.')).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'How to read these results' })).toHaveCSS(
        'font-size',
        '20px',
      )
      await expect(dialog.getByRole('heading', { name: 'Reported statuses' })).toHaveCSS(
        'font-size',
        '16px',
      )
      await expect(
        dialog.getByText(
          'Names are supplied by API key holders. Matching is exact, including case and spaces.',
        ),
      ).toHaveCSS('font-size', '14px')
      await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      expect(await supplier.boundingBox()).toEqual(before)
      const bounds = (await dialog.boundingBox())!
      expect(bounds.width).toBe(Math.min(width - 2 * gutter, 420))
      expect(bounds.y).toBe(gutter)
      expect(bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 2 * gutter)
      expect(direction === 'rtl' ? bounds.x : width - bounds.x - bounds.width).toBe(gutter)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath('guidance.png') })
      const selection = dialog.getByText('Current refers to the current planning context.')
      await selection.scrollIntoViewIfNeeded()
      await expect(selection).toBeInViewport()
      await expect(
        dialog.getByRole('button', { name: 'Close', exact: true }).last(),
      ).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(supplier).toHaveValue('ACME')
      await trigger.click()
      await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  }
}
