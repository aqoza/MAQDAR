import { expect, type Locator } from '@playwright/test'

// Owner-approved shared roles in design.MD. Keep expectations independent of the CSS tokens.
export async function expectPageTitle(title: Locator) {
  await expect(title).toHaveCSS('font-size', '16px')
  await expect(title).toHaveCSS('line-height', '24px')
  await expect(title).toHaveCSS('font-weight', '600')
}

export async function expectEvidenceValue(value: Locator) {
  await expect(value).toHaveCSS('font-size', '14px')
  await expect(value).toHaveCSS('line-height', '20px')
  await expect(value).toHaveCSS('font-weight', '600')
}
