import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createConfirmedUser, getAuthUser, signedInClient } from './helpers/auth'
import { firstLink } from './helpers/mailpit'

const directory = path.resolve(__dirname, '../../../supabase/templates')
const content = JSON.parse(readFileSync(path.join(directory, 'content.en.json'), 'utf8')) as {
  templates: { file: string; title: string; action?: string; subject: string }[]
}

for (const width of [1440, 390, 320]) {
  test(`all branded email previews fit ${width}px, including image-blocked fallback`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 390 ? 844 : 568 })
    for (const email of content.templates) {
      const source = await readFile(path.join(directory, email.file), 'utf8')
      const html = source
        .replaceAll('{{ .SiteURL }}', baseURL!)
        .replaceAll('{{ .RedirectTo }}', `${baseURL}/auth/recover`)
        .replaceAll('{{ .ConfirmationURL }}', `${baseURL}/auth/confirm?token_hash=preview-only`)
        .replaceAll('{{ .TokenHash }}', 'preview-only-not-a-real-token')
        .replaceAll('{{ .Token }}', '12345678')
      await page.setContent(html)
      await expect(page.getByRole('heading', { name: email.title })).toBeVisible()
      expect(await page.locator('html').getAttribute('lang')).toBe('en')
      expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
        800,
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      if (email.action) {
        const action = page.getByRole('link', { name: email.action, exact: false }).first()
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48)
        await action.focus()
        await expect(action).toBeFocused()
        await action.evaluate((element: HTMLElement) => element.blur())
      }
      await page.screenshot({
        path: testInfo.outputPath(email.file.replace('.html', '.png')),
        fullPage: true,
      })
    }

    // The final notification remains complete without the logo or responsive CSS.
    await page.route('**/images/email/**', (route) => route.abort())
    await page.emulateMedia({ colorScheme: 'dark' })
    const source = await readFile(path.join(directory, 'recovery.html'), 'utf8')
    await page.setContent(
      source.replaceAll('{{ .SiteURL }}', baseURL!).replace(/<style>[\s\S]*?<\/style>/, ''),
    )
    await expect(page.getByRole('link', { name: 'Reset password', exact: false })).toBeVisible()
    await expect(page.getByText('Your password has not changed.', { exact: false })).toBeVisible()
    await expect(page.getByAltText('ZeeSpare')).toHaveAttribute('width', '176')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('blocked-images-dark-preference.png'),
      fullPage: true,
    })
  })
}

async function deliveredHtml(request: APIRequestContext, email: string, subject: string) {
  const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
  if (!['localhost', '127.0.0.1'].includes(new URL(mailpit).hostname)) {
    throw new Error('Email tests may only read the local Mailpit inbox.')
  }
  let html = ''
  await expect
    .poll(
      async () => {
        const response = await request.get(`${mailpit}/api/v1/search`, {
          params: { query: `to:${email}`, limit: 10 },
        })
        if (!response.ok()) return false
        const result = (await response.json()) as { messages: { ID: string; Subject: string }[] }
        const message = result.messages.find((item) => item.Subject === subject)
        if (!message) return false
        const detail = await request.get(`${mailpit}/api/v1/message/${message.ID}`)
        if (!detail.ok()) return false
        html = ((await detail.json()) as { HTML: string }).HTML
        return true
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  // Assert booleans so matcher failures do not print actual delivery bodies or tokens.
  expect(html.includes('/images/email/zeespare-precision-reversed.png')).toBe(true)
  expect(html.includes('Every part. A clearer plan.')).toBe(true)
  expect(html.includes('{{')).toBe(false)
  return html
}

test('Auth renders branded code and email-change messages and still requires both confirmations', async ({
  request,
  baseURL,
}) => {
  const id = Date.now()
  const oldEmail = `brand-old-${id}@example.com`
  const newEmail = `brand-new-${id}@example.com`
  const password = `Brand-test-${id}`
  const userId = await createConfirmedUser(oldEmail, password)
  const client = await signedInClient(oldEmail, password)
  const codeResult = await client.auth.reauthenticate()
  expect(codeResult.error).toBeNull()
  await deliveredHtml(request, oldEmail, 'Your ZeeSpare verification code')
  const changeResult = await client.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${baseURL}/login` },
  )
  expect(changeResult.error).toBeNull()
  const oldHtml = await deliveredHtml(request, oldEmail, 'Confirm your ZeeSpare email change')
  const newHtml = await deliveredHtml(request, newEmail, 'Confirm your ZeeSpare email change')
  const oldLink = firstLink(oldHtml, /\/auth\/v1\/verify\?/)
  const newLink = firstLink(newHtml, /\/auth\/v1\/verify\?/)
  expect(Boolean(oldLink && newLink)).toBe(true)
  for (const link of [oldLink!, newLink!]) {
    if (new URL(link).origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) {
      throw new Error('Refusing to follow a verification link outside the local Auth origin.')
    }
  }
  await request.get(oldLink!, { maxRedirects: 0 })
  expect((await getAuthUser(userId)).email).toBe(oldEmail)
  await request.get(newLink!, { maxRedirects: 0 })
  expect((await getAuthUser(userId)).email).toBe(newEmail)
})
