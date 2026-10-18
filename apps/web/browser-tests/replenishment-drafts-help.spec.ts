import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`draft guidance preserves the page at ${width}px ${direction}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      const gutter = width === 375 ? 8 : 20
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
        '13px',
      )
      await expect(dialog.getByRole('heading', { name: 'How to read these drafts' })).toHaveCSS(
        'font-size',
        '16px',
      )
      await expect(dialog.getByText('Replenishment drafts', { exact: true })).toHaveCSS(
        'font-size',
        '12px',
      )
      // The modal makes the page inert; its visual typography must still stay unchanged.
      await expect(
        page.getByRole('heading', {
          name: 'Replenishment drafts',
          exact: true,
          includeHidden: true,
        }),
      ).toHaveCSS('font-size', '20px')
      await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(dialog).toHaveCSS('border-radius', '24px')
      await expect(
        dialog.getByText('Each draft shows the unrounded gap against that maximum.'),
      ).toHaveCSS('font-size', '13px')
      await expect(
        dialog.getByText('Each draft shows the unrounded gap against that maximum.'),
      ).toHaveCSS('line-height', '19px')
      expect(await search.boundingBox()).toEqual(before)
      const bounds = (await dialog.boundingBox())!
      expect(bounds.width).toBe(Math.min(width - 2 * gutter, 420))
      expect(bounds.y).toBe(gutter)
      expect(bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 2 * gutter)
      if (width === 1440) expect(bounds.height).toBeLessThan(800 - 2 * gutter)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(direction === 'rtl' ? bounds.x : width - bounds.x - bounds.width).toBe(gutter)
      const closeButtons = dialog.getByRole('button', { name: 'Close', exact: true })
      await expect(closeButtons.last()).toHaveCSS('font-size', '14px')
      for (const close of await closeButtons.all()) {
        const closeBounds = (await close.boundingBox())!
        expect(closeBounds.width).toBeGreaterThanOrEqual(44)
        expect(closeBounds.height).toBeGreaterThanOrEqual(44)
      }
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
