import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  test(`guidance overlays results and restores focus at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/e2e/fixtures/integration-results-help/')
    const trigger = page.getByRole('button', { name: 'How to read these results' })
    const supplier = page.getByLabel('Supplier code')
    await supplier.fill('ACME')
    const before = await supplier.boundingBox()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'How to read these results' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('No report does not mean failed delivery.')).toBeVisible()
    expect(await supplier.boundingBox()).toEqual(before)
    const bounds = (await dialog.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('guidance.png') })
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
