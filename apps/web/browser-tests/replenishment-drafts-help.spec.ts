import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`draft guidance preserves the page at ${width}px ${direction}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width, height: width === 375 ? 500 : 800 })
      await page.goto(`/e2e/fixtures/replenishment-drafts-help/?dir=${direction}`)
      const trigger = page.getByRole('button', { name: 'How to read these drafts' })
      const search = page.getByLabel('Search item code')
      await search.fill('ACME-001')
      const before = await search.boundingBox()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: 'How to read these drafts' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'Policy comparison' })).toBeVisible()
      await expect(dialog.getByText('A planning draft, not a purchase order.')).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'Policy comparison' })).toHaveCSS(
        'font-size',
        '16px',
      )
      await expect(dialog.getByRole('heading', { name: 'How to read these drafts' })).toHaveCSS(
        'font-size',
        '20px',
      )
      expect(await search.boundingBox()).toEqual(before)
      const bounds = (await dialog.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(direction === 'rtl' ? bounds.x : width - bounds.x - bounds.width).toBe(0)
      const closeButtons = dialog.getByRole('button', { name: 'Close', exact: true })
      await expect(closeButtons.last()).toBeInViewport()
      const nextSteps = dialog.getByText(
        'Supplier constraints, arrival scheduling, and order execution follow separately.',
      )
      await nextSteps.scrollIntoViewIfNeeded()
      await expect(nextSteps).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath('draft-guidance.png') })
      // Tab stays in the modal, including when content needs its own scroll area.
      await closeButtons.last().focus()
      await page.keyboard.press('Tab')
      await expect(closeButtons.first()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(search).toHaveValue('ACME-001')
      expect(await search.boundingBox()).toEqual(before)
      for (const index of [0, 1]) {
        await trigger.click()
        await closeButtons.nth(index).click()
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()
      }
      expect(errors).toEqual([])
    })
  }
}
