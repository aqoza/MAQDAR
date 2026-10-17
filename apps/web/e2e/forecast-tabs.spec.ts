import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

const labels = [
  'Check demand data',
  'Saved forecast quality',
  'Policy review workbench',
  'Classify demand',
  'Create forecast',
  'Prepare demand',
]

for (const width of [375, 1440]) {
  test(`all six forecast tabs switch in place and retain form values at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const run = `${Date.now()}-${width}`
    const email = `tabs-${run}@example.com`
    const password = `Tabs-pass-${run}`
    await createConfirmedUser(email, password)
    await signInWithPassword(page, email, password)
    await createOrganization(page, { name: `Tabs ${run}`, slug: `tabs-${run}` })
    await page.goto('/forecasts')
    const url = page.url()
    const originalDocument = await page.evaluateHandle(() => document)
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(6)
    for (let index = 0; index < labels.length; index++) {
      const tab = page.getByRole('tab', { name: labels[index], exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toHaveCSS('background-color', 'rgb(233, 244, 237)')
      await expect(tab).toHaveCSS('font-weight', '600')
      const panel = page.getByRole('tabpanel')
      await expect(panel).toHaveCount(1)
      await expect(panel).toHaveAttribute('aria-labelledby', (await tab.getAttribute('id'))!)
      if (index === 0) {
        await expect(panel.getByRole('form', { name: labels[index], exact: true })).toBeVisible()
      } else {
        await expect(panel.getByRole('heading', { name: labels[index], exact: true })).toBeVisible()
      }
      if (index === 0 || index >= 3) {
        await panel.getByLabel('Location code', { exact: true }).fill(`TEST-${index}`)
      }
      expect(page.url()).toBe(url)
      expect(await originalDocument.evaluate((original) => original === document)).toBe(true)
    }
    for (const index of [0, 3, 4, 5]) {
      await tabs.nth(index).click()
      await expect(
        page.getByRole('tabpanel').getByLabel('Location code', { exact: true }),
      ).toHaveValue(`TEST-${index}`)
    }
    await tabs.first().focus()
    await tabs.first().press('End')
    await expect(tabs.last()).toBeFocused()
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
    await tabs.last().press('Home')
    await expect(tabs.first()).toBeFocused()
    await tabs.first().press('ArrowRight')
    await expect(tabs.nth(1)).toBeFocused()
    expect(page.url()).toBe(url)
    await originalDocument.dispose()
  })
}
