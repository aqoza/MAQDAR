import { expect, test, type APIRequestContext } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
const NAV_LABELS = [
  'Dashboard',
  'Items',
  'Locations',
  'Suppliers',
  'Forecasts',
  'Replenishment',
  'Settings',
]

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to MAQDAR' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
})

test('magic link signs in, shows the app shell and mirrors for Arabic', async ({
  page,
  request,
}) => {
  const email = `smoke-${Date.now()}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('status')).toContainText(email)

  const link = await waitForSignInLink(request, email)
  await page.goto(link)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  for (const label of NAV_LABELS) {
    await expect(page.getByRole('link', { name: label })).toBeVisible()
  }

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByRole('radio', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.getByRole('heading', { level: 1, name: 'الإعدادات' })).toBeVisible()

  await page.getByRole('radio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

/** Polls the local Mailpit API for the sign-in email and extracts the /auth/confirm link. */
async function waitForSignInLink(request: APIRequestContext, email: string): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const search = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:${email}`, limit: 5 },
    })
    if (search.ok()) {
      const { messages } = (await search.json()) as { messages: { ID: string }[] }
      for (const message of messages) {
        const detail = await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
        const body = (await detail.json()) as { HTML?: string; Text?: string }
        const haystack = `${body.HTML ?? ''}\n${body.Text ?? ''}`.replace(/&amp;/g, '&')
        const match = haystack.match(/https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+/)
        if (match) return match[0]
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`No sign-in email for ${email} arrived in Mailpit at ${MAILPIT_URL}`)
}
