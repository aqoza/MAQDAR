import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { inviteAndAccept } from './helpers/imports'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { expectPageTitle } from './helpers/typography'

async function createWorkspace(page: Page) {
  const id = randomUUID()
  const email = `owner-${id}@example.com`
  const password = `Arabic-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `arabic-header-${id}`
  await createOrganization(page, { name: 'Acme', slug, arabicEnabled: true })
  return { email, slug }
}

async function switchToArabic(page: Page) {
  await page.goto('/settings')
  await selectSettingsSection(page, 'language')
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
}

test('rapid Settings keyboard navigation keeps focus and URL selection in sync', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await createWorkspace(page)
  await page.goto('/settings')
  await selectSettingsSection(page, 'preferences')
  await page.getByRole('tab', { name: 'Organization', exact: true }).evaluate((tab) => {
    tab.focus()
    // Deliver a burst before React renders the new search params, as fast key presses can do.
    for (const key of ['End', 'Home', 'ArrowDown']) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
  })
  await expect(page).toHaveURL((url) => url.searchParams.get('section') === 'preferences')
  const preferences = page.getByRole('tab', { name: 'Preferences', exact: true })
  await expect(preferences).toBeFocused()
  await expect(preferences).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Preferences', exact: true })).toBeVisible()
})

test('Arabic Settings translate member controls, dialogs, invitation feedback and errors', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const owner = await createWorkspace(page)
  const id = randomUUID()
  const colleague = `colleague-${id.slice(0, 8)}@example.com`
  await createConfirmedUser(colleague, `Colleague-${id}`)
  const organization = await organizationIdBySlug(owner.slug)
  await seedRows('locations', [
    {
      id: randomUUID(),
      organization_id: organization,
      code: 'DXB',
      name_en: 'Dubai',
      name_ar: 'دبي',
      location_type: 'branch',
      country_code: 'AE',
      timezone: 'Asia/Dubai',
    },
  ])
  await inviteAndAccept(page, browser, request, colleague, 'Branch user', 'Acme')
  await switchToArabic(page)
  await selectSettingsSection(page, 'members')
  const members = page.getByRole('tabpanel', { name: 'الأعضاء', exact: true })
  for (const label of ['البريد الإلكتروني', 'الدور', 'عضو منذ', 'المواقع']) {
    await expect(members.getByRole('columnheader', { name: label, exact: true })).toBeVisible()
  }
  const colleagueRow = members.getByRole('row').filter({ hasText: colleague })
  await expect(colleagueRow.getByRole('combobox', { name: 'الدور' })).toHaveValue('branch_user')
  const locations = colleagueRow.getByRole('group', { name: 'تعيين المواقع' })
  await locations.getByRole('checkbox', { name: /DXB/ }).check()
  await colleagueRow.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(colleagueRow.getByRole('status')).toHaveText('تم الحفظ.')
  await expect(members).not.toContainText('All locations')
  await page.screenshot({ path: testInfo.outputPath('members-ar-1366.png') })
  await colleagueRow.getByRole('button', { name: 'إزالة', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(`إزالة ${colleague}؟`)
  await expect(dialog).toContainText('يفقد العضو صلاحية الوصول فورًا.')
  await page.screenshot({ path: testInfo.outputPath('member-dialog-ar-1366.png') })
  await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()

  for (const width of [1366, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 900 : 768 })
    await selectSettingsSection(page, 'members')
    await expect(members).toBeVisible()
    const roleFits = await colleagueRow
      .getByRole('combobox', { name: 'الدور' })
      .evaluate((select) => {
        const style = getComputedStyle(select)
        const context = document.createElement('canvas').getContext('2d')!
        context.font = style.font
        const label = (select as HTMLSelectElement).selectedOptions[0].text
        const required =
          context.measureText(label).width +
          parseFloat(style.paddingInlineStart) +
          parseFloat(style.paddingInlineEnd)
        return select.clientWidth >= required
      })
    expect(roleFits, 'The translated member role must fit inside its select').toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: testInfo.outputPath(`members-ar-${width}.png`) })
    await selectSettingsSection(page, 'invitations')
    const panel = page.getByRole('tabpanel', { name: 'الدعوات', exact: true })
    await expect(panel.getByText('لا توجد دعوات معلّقة.')).toBeVisible()
    await panel.getByLabel('البريد الإلكتروني', { exact: true }).fill(owner.email)
    await panel.getByRole('button', { name: 'إرسال دعوة', exact: true }).click()
    await expect(panel.getByRole('alert')).toHaveText(`${owner.email} عضو في هذه المنظمة بالفعل.`)
    await page.screenshot({ path: testInfo.outputPath(`invitation-error-ar-${width}.png`) })
    const pending = `pending-${id.slice(0, 8)}-${width}@example.com`
    await panel.getByLabel('البريد الإلكتروني', { exact: true }).fill(pending)
    await panel.getByRole('button', { name: 'إرسال دعوة', exact: true }).click()
    const confirmation = `أُرسلت الدعوة إلى ${pending}.`
    // The directory also announces pagination; target the invitation feedback explicitly.
    await expect(panel.getByRole('status').filter({ hasText: confirmation })).toHaveText(
      confirmation,
    )
    const row = panel.getByRole('listitem').filter({ hasText: pending })
    await expect(row).toContainText('أُرسلت في')
    await expect(row).toContainText('تنتهي في')
    await expect(row.getByRole('button', { name: 'إعادة الإرسال', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: testInfo.outputPath(`invitations-ar-${width}.png`) })
    await row.getByRole('button', { name: 'إعادة الإرسال', exact: true }).click()
    await expect(row.getByRole('alert')).toHaveText(
      'تم إرسال دعوة إلى هذا العنوان قبل أقل من دقيقتين.',
    )
    await row.getByRole('button', { name: 'إلغاء الدعوة', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(panel.getByText('لا توجد دعوات معلّقة.')).toBeVisible()
  }
})

test('replenishment policy selection keeps the forecast banner, filters and back navigation', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await createWorkspace(page)
  await page.goto('/replenishment')
  const choose = page.getByRole('link', {
    name: 'Choose a policy maximum to start a draft',
    exact: true,
  })
  await expect(choose).toHaveAttribute('href', '/forecasts/workbench')
  await choose.click()
  await expect(page).toHaveURL(/\/forecasts\/workbench$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Policy review workbench', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('policy-workbench-en-1366.png') })
  await expect(page.locator('[data-page-banner="forecasts"]')).toHaveCount(1)
  const search = page.getByLabel('Search item code', { exact: true })
  await search.fill('BRAKE')
  await page.getByLabel('Location code', { exact: true }).fill('DXB')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('location') === 'DXB' && url.searchParams.get('q') === 'BRAKE',
  )
  await expect(search).toHaveValue('BRAKE')
  await page.getByRole('link', { name: 'Reset filters', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/workbench$/)
  await expect(search).toHaveValue('')

  for (const locale of ['en', 'ar']) {
    if (locale === 'ar') {
      await switchToArabic(page)
      await page.goto('/replenishment')
      await page.locator('a[href="/forecasts/workbench"]').click()
      await expect(page).toHaveURL(/\/forecasts\/workbench$/)
    }
    for (const width of locale === 'en' ? [1920, 1366, 375] : [1366, 375]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 })
      const banner = page.locator('[data-page-banner="forecasts"]')
      await expect(banner).toHaveCount(1)
      const heading = page.getByRole('heading', { level: 1 })
      await expectPageTitle(heading)
      const background = (await banner.locator('.page-banner-backdrop').boundingBox())!
      expect(background.y).toBe(0)
      if (width >= 768) expect(background.height).toBe(100)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({
        path: testInfo.outputPath(`policy-workbench-${locale}-${width}.png`),
      })
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  const back = page.locator('[data-page-banner] a[href="/forecasts"]')
  await back.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/forecasts$/)
  await expect(page.locator('[data-page-banner="forecasts"]')).toHaveCount(1)
})

test('the standalone policy list retains its forecast banner during streamed loading', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await createWorkspace(page)
  await page.goto('/forecasts/workbench')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Policy review workbench', exact: true }),
  ).toBeVisible()
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
    const loading = page.locator('[data-policy-workbench-loading]')
    await expect(loading.locator('.page-heading-copy p span')).toBeVisible({ timeout: 30_000 })
    const background = (await loading.locator('.page-banner-backdrop').boundingBox())!
    expect(background.y).toBe(0)
    expect(background.height).toBe(100)
    await page.screenshot({ path: testInfo.outputPath('policy-workbench-loading-1366.png') })
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
  await expect(page.locator('[data-policy-workbench-loading]')).toHaveCount(0)
  await expect(page.locator('[data-page-banner="forecasts"]')).toHaveCount(1)
})
