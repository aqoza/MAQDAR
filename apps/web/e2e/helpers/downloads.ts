import { expect, type Page } from '@playwright/test'

/** Exercise repeated downloads without navigation, reloads, new tabs or request interception. */
export async function expectRepeatedDownloads(
  page: Page,
  filename: string,
  contents: { json: string | Buffer; csv: string | Buffer },
) {
  const detailUrl = page.url()
  for (const [index, format] of (['json', 'csv', 'json', 'csv'] as const).entries()) {
    const downloading = page.waitForEvent('download')
    const link = page.getByRole('link', { name: `Download ${format.toUpperCase()}`, exact: true })
    if (index < 2) await link.click()
    else await link.press('Enter')
    const download = await downloading
    expect(await download.failure()).toBeNull()
    expect(download.suggestedFilename()).toBe(`${filename}.${format}`)
    const stream = await download.createReadStream()
    expect(stream).not.toBeNull()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(contents[format]))
    await expect(page).toHaveURL(detailUrl)
    await expect(link).toBeVisible()
  }
}
