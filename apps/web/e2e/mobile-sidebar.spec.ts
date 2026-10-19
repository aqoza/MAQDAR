import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

for (const locale of ['en', 'ar'] as const) {
  test.describe(`sidebar navigation (${locale})`, () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
      const run = randomUUID()
      const email = `sidebar-${run}@example.com`
      const password = `Sidebar-${run}`
      await createConfirmedUser(email, password)
      await signInWithPassword(page, email, password)
      await createOrganization(page, {
        name: `Sidebar ${run}`,
        slug: `sidebar-${run}`,
        arabicEnabled: true,
      })
      if (locale === 'ar') {
        await page.goto('/settings')
        await selectSettingsSection(page, 'language')
        await page.getByRole('radio', { name: 'العربية' }).click()
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      }
      await page.goto('/items')
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    })

    test('mobile links dismiss the drawer for pointer, keyboard and current-page navigation', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const trigger = page.locator('[data-sidebar="trigger"]')
      const drawer = page.getByRole('dialog')

      await trigger.click()
      const newTabPromise = page.context().waitForEvent('page')
      await drawer
        .locator('a[href="/dashboard"]')
        .last()
        .click({ modifiers: ['ControlOrMeta'] })
      const newTab = await newTabPromise
      await expect(drawer).toBeVisible()
      await expect(page).toHaveURL(/\/items$/)
      await newTab.close()

      await drawer.locator('a[href="/dashboard"]').last().click()
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(drawer).toBeHidden()
      await expect(page.locator('main h1')).toBeVisible()

      await trigger.click()
      await drawer.locator('a[href="/items"]').focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/items$/)
      await expect(drawer).toBeHidden()

      // Active links must dismiss too: a pathname-change effect alone misses this case.
      await trigger.click()
      await drawer.locator('a[href="/items"]').click()
      await expect(drawer).toBeHidden()

      await trigger.click()
      await drawer.locator('a.app-brand').click()
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(drawer).toBeHidden()

      await trigger.click()
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      await expect(trigger).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`mobile-sidebar-${locale}.png`) })
    })

    test('desktop navigation preserves the collapsed sidebar', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.locator('[data-sidebar="trigger"]').click()
      const sidebar = page.locator('[data-slot="sidebar"][data-state]')
      await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
      await page.locator('[data-sidebar="group"] a[href="/dashboard"]').click()
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
      await expect(page.getByRole('dialog')).toBeHidden()
    })
  })
}
