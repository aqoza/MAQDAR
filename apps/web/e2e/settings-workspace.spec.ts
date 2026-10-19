import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { inviteAndAccept } from './helpers/imports'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection, type SettingsSectionKey } from './helpers/settings'
import { expectPageTitle } from './helpers/typography'

const sections: SettingsSectionKey[] = [
  'organization',
  'preferences',
  'members',
  'invitations',
  'api-keys',
  'password',
  'language',
]

async function createWorkspace(page: Page) {
  const key = randomUUID()
  const email = `settings-${key}@example.com`
  const password = `Settings-${key}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, {
    name: 'Acme',
    slug: `settings-${key}`,
    arabicEnabled: true,
    baseCurrency: 'OMR',
    homeCountry: 'OM',
  })
  await page.goto('/settings')
  await expect(page.locator('[data-settings-workspace]')).toHaveCount(1)
  await expect(page.locator('[data-settings-workspace]')).toBeVisible()
}

test('settings preserve drafts, validation and URL history while searching and switching sections', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await createWorkspace(page)
  let navigations = 0
  const countNavigation = (request: import('@playwright/test').Request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname === '/settings' &&
      request.headers().rsc === '1'
    )
      navigations++
  }
  page.on('request', countNavigation)
  await page.getByLabel('Name', { exact: true }).fill('Acme unsaved')
  await selectSettingsSection(page, 'preferences')
  await page.getByLabel('Time zone', { exact: true }).selectOption('Asia/Dubai')
  await selectSettingsSection(page, 'api-keys')
  await page.getByLabel('Key name', { exact: true }).fill('ERP draft')
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(page.getByText('Choose at least one permission.', { exact: true })).toBeVisible()
  await selectSettingsSection(page, 'preferences')
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Dubai')
  await page.goBack()
  await expect(page.getByLabel('Key name', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Key name', { exact: true })).toHaveValue('ERP draft')
  await expect(page.getByText('Choose at least one permission.', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('Time zone', { exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByLabel('Key name', { exact: true })).toHaveValue('ERP draft')
  await page.goBack()
  await expect(page.getByLabel('Time zone', { exact: true })).toBeVisible()
  await selectSettingsSection(page, 'organization')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Acme unsaved')
  expect(navigations).toBe(0)
  page.off('request', countNavigation)

  // Saving one form must not reset unsaved values in another mounted panel.
  await selectSettingsSection(page, 'preferences')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible()
  await selectSettingsSection(page, 'organization')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Acme unsaved')
  await selectSettingsSection(page, 'preferences')
  await page.reload()
  await expect(page.getByLabel('Time zone', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Dubai')

  const search = page.getByRole('searchbox', { name: 'Find a setting', exact: true })
  await search.fill('time zone')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Preferences', exact: true })).toBeVisible()
  await search.fill('key name')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'API keys', exact: true })).toBeVisible()
  await search.fill('no-such-setting')
  await expect(page.getByRole('status')).toHaveText('No matching settings. Try another search.')
  await expect(page.getByLabel('Time zone', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('settings-search-empty-1366.png') })
  await page.getByRole('button', { name: 'Clear settings search' }).click()
  await expect(page.getByRole('tab')).toHaveCount(7)
  const organization = page.getByRole('tab', { name: 'Organization', exact: true })
  await organization.focus()
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Interface language' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(organization).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('tab', { name: 'Preferences', exact: true })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'Preferences', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tabpanel', { name: 'Preferences', exact: true })).toBeFocused()
})

test('all settings panels fit desktop, laptop, mobile and Arabic with shared typography', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await createWorkspace(page)
  const measurements = []
  for (const locale of ['en', 'ar']) {
    if (locale === 'ar') {
      await selectSettingsSection(page, 'language')
      await page.getByRole('radio', { name: 'العربية' }).click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    }
    for (const width of locale === 'en' ? [1920, 1366, 375] : [1366, 375]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
      for (const section of sections) {
        await selectSettingsSection(page, section)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.getByRole('tabpanel')).toHaveCount(1)
        await expectPageTitle(page.getByRole('heading', { level: 1 }))
        const active = page.locator(`[data-settings-section="${section}"]`)
        await expect(active).toHaveCSS('font-size', '14px')
        await expect(active.locator('svg')).toHaveCSS('width', '16px')
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width)
        if (width < 1100) {
          await expect(page.locator('[data-settings-workspace] aside > button')).toHaveAttribute(
            'aria-expanded',
            'false',
          )
          const toggle = (await page
            .locator('[data-settings-workspace] aside > button')
            .boundingBox())!
          expect(toggle.height).toBeGreaterThanOrEqual(44)
        }
        if (section === 'organization') {
          const menu = (await page.locator('[data-settings-workspace] aside').boundingBox())!
          const panel = (await page.getByRole('tabpanel').boundingBox())!
          measurements.push({ locale, width, menu, panel })
          if (width >= 1100) {
            expect(menu.width).toBe(224)
            expect(Math.abs(menu.y - panel.y)).toBeLessThan(1)
          }
        }
        if (section === 'members' && width === 375) {
          const region = page.getByRole('tabpanel').getByRole('region')
          await region.focus()
          expect(await region.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0)
          await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
          await expect
            .poll(() => region.evaluate((el) => Math.abs(el.scrollLeft)))
            .toBeGreaterThan(0)
          await region.evaluate((el) => {
            el.scrollLeft = 0
          })
        }
        await page.getByRole('heading', { level: 1 }).click()
        await expect(page.locator('[data-slot="sidebar-inset"] > header > span')).toBeInViewport()
        if (section === 'api-keys') {
          // Keep the entire permissions form and save action reviewable. Full-page capture
          // also avoids Chromium clipping the top bar in viewport captures of this tall panel.
          await page.screenshot({
            path: testInfo.outputPath(`settings-${section}-${locale}-${width}-full.png`),
            fullPage: true,
          })
        } else {
          await page.screenshot({
            path: testInfo.outputPath(`settings-${section}-${locale}-${width}.png`),
          })
        }
      }
    }
  }
  await writeFile(
    testInfo.outputPath('settings-bounds.json'),
    JSON.stringify(measurements, null, 2) + '\n',
  )
  expect(errors).toEqual([])
})

test('viewers receive read-only organization panels and no administration tools, including deep links', async ({
  page,
  browser,
  request,
}) => {
  await createWorkspace(page)
  const key = randomUUID()
  const email = `settings-viewer-${key}@example.com`
  const password = `Viewer-${key}`
  await createConfirmedUser(email, password)
  await inviteAndAccept(page, browser, request, email, 'Viewer', 'Acme')
  const context = await browser.newContext()
  try {
    const viewer = await context.newPage()
    await signInWithPassword(viewer, email, password)
    await viewer.goto('/settings?section=api-keys')
    await expect(viewer.getByRole('tabpanel', { name: 'Organization', exact: true })).toBeVisible()
    await expect(viewer.locator('[data-settings-section]')).toHaveCount(4)
    for (const section of ['members', 'invitations', 'api-keys']) {
      await expect(viewer.locator(`[data-settings-section="${section}"]`)).toHaveCount(0)
    }
    await expect(viewer.getByLabel('Key name', { exact: true })).toHaveCount(0)
    await expect(viewer.getByLabel('Name', { exact: true })).toHaveCount(0)
    await expect(
      viewer.getByText('Only owners and administrators can change these settings.'),
    ).toBeVisible()
    await selectSettingsSection(viewer, 'preferences')
    await expect(viewer.getByLabel('Time zone', { exact: true })).toHaveCount(0)
    await expect(
      viewer.getByText('Only owners and administrators can change these preferences.'),
    ).toBeVisible()
    await selectSettingsSection(viewer, 'password')
    await expect(viewer.getByLabel('New password', { exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('Settings streams the illustrated header before its workspace data is ready', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await createWorkspace(page)
  await page.evaluate(() => document.fonts.ready)
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  try {
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 200,
      downloadThroughput: 1000,
      uploadThroughput: -1,
    })
    await page.reload({ waitUntil: 'commit' })
    const loading = page.locator('[data-settings-loading]')
    await expect(loading.locator('.page-heading-copy p span')).toBeVisible({ timeout: 30_000 })
    const background = (await loading.locator('.page-banner-backdrop').boundingBox())!
    expect(background.y).toBe(0)
    expect(background.height).toBe(100)
    await page.screenshot({ path: testInfo.outputPath('settings-loading-1366.png') })
    await expect(loading).toBeVisible()
  } finally {
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    await network.detach()
  }
  await expect(page.locator('[data-settings-workspace]')).toHaveCount(1)
  await expect(page.locator('[data-settings-workspace]')).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
})
