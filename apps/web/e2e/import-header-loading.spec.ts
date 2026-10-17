import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createConfirmedUser, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('Import history keeps its illustrated header while the server response streams', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const key = randomUUID()
  const email = `import-header-${key}@example.com`
  const password = `Import-header-${key}`
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  await createOrganization(page, { name: 'Acme', slug: `import-header-${key}` })
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/items')
  await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // Keep the real streamed server fallback visible; do not replace the route or its markup.
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  const measurements = []
  try {
    for (const mode of ['entry', 'reload']) {
      await network.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 200,
        downloadThroughput: 1_000,
        uploadThroughput: -1,
      })
      if (mode === 'entry') {
        await page.goto('/imports', { waitUntil: 'commit' })
      } else {
        await page.reload({ waitUntil: 'commit' })
      }
      const loading = page.locator(
        '[data-app-content] > [aria-busy="true"]:has([data-page-banner="imports"])',
      )
      await expect(loading).toBeVisible({ timeout: 30_000 })
      const banner = loading.locator('[data-page-banner="imports"]')
      await expect(banner).toBeVisible()
      // The HTML is parsed progressively at this throughput: wait for the complete header.
      await expect(banner.locator('.page-actions')).toBeVisible({ timeout: 30_000 })
      const backdrop = (await banner.locator('.page-banner-backdrop').boundingBox())!
      expect(backdrop.y).toBeLessThanOrEqual(1)
      await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      )
      await page.screenshot({ path: testInfo.outputPath(`imports-loading-${mode}-1366.png`) })
      await expect(loading).toBeVisible()
      await network.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      await expect(page.getByRole('heading', { name: 'Imports', exact: true })).toBeVisible()
      await expect(loading).toHaveCount(0)
      const loaded = (await page.locator('.page-banner-backdrop').boundingBox())!
      expect(loaded).toEqual(backdrop)
      measurements.push({ mode, loading: backdrop, loaded })
      await page.screenshot({ path: testInfo.outputPath(`imports-loaded-${mode}-1366.png`) })
    }
  } finally {
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    await network.detach()
  }
  await writeFile(
    testInfo.outputPath('loading-bounds.json'),
    JSON.stringify(measurements, null, 2) + '\n',
  )
  await page.goto('/items')
  await page.getByRole('link', { name: 'Imports', exact: true }).click()
  await expect(page.locator('[data-page-banner="imports"]')).toBeVisible()
  await page.getByRole('link', { name: 'New import', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New import', exact: true })).toBeVisible()
  await expect(page.locator('[data-page-banner]')).toHaveCount(0)
  expect(errors).toEqual([])
})
