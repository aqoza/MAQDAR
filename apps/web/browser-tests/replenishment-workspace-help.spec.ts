import { expect, test } from '@playwright/test'
import messages from '../messages/en.json'

const guidance = [
  {
    workspace: 'redistribution',
    title: messages.Redistribution.title,
    paragraphs: [messages.Redistribution.asOf, messages.Redistribution.noReservation],
  },
  {
    workspace: 'locator',
    title: messages.StockLocator.title,
    paragraphs: [
      messages.StockLocator.stockHelp,
      messages.StockLocator.distanceHelp,
      messages.StockLocator.historyHelp,
      messages.StockLocator.relationshipHelp,
      messages.StockLocator.substituteHelp,
    ],
  },
  {
    workspace: 'review',
    title: messages.PurchaseReview.title,
    paragraphs: [messages.PurchaseReview.description],
  },
  {
    workspace: 'handoffs',
    title: messages.PurchaseHandoffs.title,
    paragraphs: [messages.PurchaseHandoffs.description],
  },
  {
    workspace: 'batches',
    title: messages.HandoffBatches.title,
    paragraphs: [messages.HandoffBatches.description],
  },
]

for (const width of [375, 1440]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`workspace methods preserve copy and filters at ${width}px ${direction}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      const gutter = width === 375 ? 8 : 20
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width, height: width === 375 ? 500 : 800 })
      await page.goto(`/e2e/fixtures/replenishment-workspace-help/?dir=${direction}`)
      const search = page.getByLabel('Search item code')
      await search.fill('ACME-001')

      for (const { workspace, title, paragraphs } of guidance) {
        const trigger = page
          .locator(`[data-workspace="${workspace}"]`)
          .getByRole('button', { name: messages.Common.methodDetails })
        await trigger.scrollIntoViewIfNeeded()
        const before = await search.boundingBox()
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: messages.Common.methodDetails })
        await expect(dialog).toBeVisible()
        await expect(dialog.locator('p')).toHaveText([title, ...paragraphs])
        await expect(
          dialog.getByRole('heading', { name: messages.Common.methodDetails }),
        ).toHaveCSS('font-size', '16px')
        await expect(dialog.locator('p').first()).toHaveCSS('font-size', '12px')
        await expect(dialog.locator('p').last()).toHaveCSS('font-size', '13px')
        await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        expect(await search.boundingBox()).toEqual(before)
        const bounds = (await dialog.boundingBox())!
        expect(bounds.width).toBe(Math.min(width - 2 * gutter, 420))
        expect(bounds.y).toBe(gutter)
        expect(bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 2 * gutter)
        if (width === 1440 && workspace !== 'locator') {
          expect(bounds.height).toBeLessThan(800 - 2 * gutter)
        }
        expect(direction === 'rtl' ? bounds.x : width - bounds.x - bounds.width).toBe(gutter)
        const closeButtons = dialog.getByRole('button', {
          name: messages.Common.close,
          exact: true,
        })
        await expect(closeButtons.last()).toBeInViewport()
        if (workspace === 'locator') {
          await page.screenshot({ path: testInfo.outputPath('stock-locator-guidance.png') })
        }
        await dialog.locator('p').last().scrollIntoViewIfNeeded()
        await expect(dialog.locator('p').last()).toBeInViewport()
        await closeButtons.last().focus()
        await page.keyboard.press('Tab')
        await expect(closeButtons.first()).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()
        await expect(search).toHaveValue('ACME-001')
        expect(await search.boundingBox()).toEqual(before)
        await trigger.click()
        await closeButtons.last().click()
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()
      }
      expect(errors).toEqual([])
    })
  }
}
