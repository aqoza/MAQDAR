import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
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
    const slug = `tabs-${run}`
    await createOrganization(page, { name: `Tabs ${run}`, slug })
    const organization = await organizationIdBySlug(slug)
    await seedRows(
      'locations',
      [
        { code: 'ACTIVE', name_en: 'Current workflow branch', is_active: true },
        { code: 'ARCHIVE', name_en: 'Retired workflow branch', is_active: false },
      ].map((location) => ({
        ...location,
        organization_id: organization,
        location_type: 'branch',
        country_code: 'SA',
        timezone: 'Asia/Riyadh',
      })),
    )
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
        if (index === 1) {
          await expect(
            panel.getByText('No saved forecast results yet.', { exact: true }),
          ).toBeVisible()
        }
      }
      if (index === 0 || index >= 2) {
        const location = panel.getByRole('combobox', { name: 'Location code', exact: true })
        await expect(location).toHaveAttribute('placeholder', 'Search location code or name')
        await expect(location).toHaveCSS('font-size', width < 768 ? '16px' : '14px')
        await location.fill('workflow branch')
        await expect(
          page.getByRole('option', { name: /ACTIVE.*Current workflow branch/ }),
        ).toBeVisible()
        if (index === 2) {
          await expect(
            page.getByRole('option', { name: /ARCHIVE.*Retired workflow branch/ }),
          ).toBeVisible()
        } else {
          await expect(page.getByRole('option', { name: /ARCHIVE/ })).toHaveCount(0)
        }
        await location.press('ArrowDown')
        await location.press('Enter')
        await expect(location).toHaveValue('ACTIVE')
        await location.fill(`TEST-${index}`)
        await expect(location).toHaveAttribute('aria-expanded', 'true')
        await location.press('Escape')
        await expect(location).toHaveAttribute('aria-expanded', 'false')
      }
      expect(page.url()).toBe(url)
      expect(await originalDocument.evaluate((original) => original === document)).toBe(true)
    }
    for (const index of [0, 2, 3, 4, 5]) {
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
