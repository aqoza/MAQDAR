import { expect, type Page } from '@playwright/test'

export type SettingsSectionKey =
  'organization' | 'preferences' | 'members' | 'invitations' | 'api-keys' | 'password' | 'language'

/** Follow the real local Settings navigation, including the collapsed laptop/mobile menu. */
export async function selectSettingsSection(page: Page, section: SettingsSectionKey) {
  const workspace = page.locator('[data-settings-workspace]')
  // React may briefly stage a hidden copy while the server response streams.
  await expect(workspace).toHaveCount(1)
  await expect(workspace).toBeVisible()
  const tab = workspace.locator(`[data-settings-section="${section}"]`)
  await tab.waitFor({ state: 'attached' })
  if (!(await tab.isVisible())) {
    await workspace.locator('aside > button').click()
  }
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}
