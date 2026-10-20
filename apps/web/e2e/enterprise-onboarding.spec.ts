import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './helpers/auth'
import { onboardingStatusSchema } from '../src/lib/organizations/onboarding'
import { completeInviteLink } from './helpers/invitations'
import { createOrganization } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'
import { waitForEmailLink } from './helpers/mailpit'

let cancelRemaining: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await cancelRemaining?.()
})

test('enterprise onboarding supports large directories, paced email delivery, progress and cancellation', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(300000)
  const key = randomUUID()
  const email = `onboarding-${key}@example.com`
  const password = `Local-Onboarding-${key}`
  const user = await createConfirmedUser(email, password)
  const existingEmail = `existing-${key}@example.com`
  const newEmail = `new-${key}@example.com`
  await createConfirmedUser(existingEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `onboarding-${key}`
  await createOrganization(page, { name: 'Enterprise onboarding verification', slug })
  const org = await organizationIdBySlug(slug)
  cancelRemaining = async () => {
    const client = await signedInClient(email, password)
    const { data, error } = await client.rpc('onboarding_status', { p_organization_id: org })
    if (error) throw error
    for (const batch of onboardingStatusSchema.parse(data).batches) {
      if (batch.pending) {
        const result = await client.rpc('onboarding_cancel', {
          p_organization_id: org,
          p_batch_id: batch.id,
        })
        if (result.error) throw result.error
      }
    }
  }
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user, key], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100000,
    })
  await python(`import sys,psycopg,uuid
with psycopg.connect(sys.argv[1]) as db:
    org,actor,key=sys.argv[2:5]
    db.execute("insert into onboarding.policies values(%s,2000,2000,now()+interval '1 day','Synthetic enterprise browser test')",(org,))
    for n in range(1,1002):
        uid=str(uuid.uuid5(uuid.UUID(key),str(n)))
        db.execute('insert into auth.users(id,email,email_confirmed_at) values(%s,%s,now())',(uid,f'directory{n:04d}-{key}@example.com'))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'viewer')",(org,uid))
        db.execute("insert into public.organization_invitations(organization_id,email,role,invited_by) values(%s,%s,'viewer',%s)",(org,f'pending{n:04d}-{key}@example.com',actor))`)
  await page.goto('/settings?section=members&members_page=11')
  await expect(page.getByRole('status').filter({ hasText: 'Page 11' })).toContainText(
    '1,002 results',
  )
  await page.getByRole('searchbox', { name: 'Search by email' }).fill('directory1001')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText(`directory1001-${key}@example.com`, { exact: true })).toBeVisible()
  await selectSettingsSection(page, 'invitations')
  await page.getByRole('searchbox', { name: 'Search by email' }).fill('pending1001')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText(`pending1001-${key}@example.com`, { exact: true })).toBeVisible()

  await page.getByLabel('Email addresses', { exact: true }).fill(`${newEmail}\n${existingEmail}`)
  await page.getByLabel('I confirm these recipients', { exact: false }).check()
  await page.getByRole('button', { name: 'Queue invitations', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 invitations queued' })).toBeVisible({
    timeout: 15000,
  })
  // Exercise the same cron consumer against local Auth + Mailpit, without production sends.
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), '../../scripts/onboarding-delivery.mjs'),
  ).href
  const { deliverInvitations } = await import(moduleUrl)
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3000')
  expect(
    await deliverInvitations({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.SUPABASE_SECRET_KEY,
      tenantOrigins: { [org]: baseURL },
      maxMessages: 2,
    }),
  ).toBe(2)
  let newUserLink = ''
  for (const recipient of [newEmail, existingEmail]) {
    const link = await waitForEmailLink(request, recipient, /\/auth\/email\/invitations\//)
    expect(new URL(link).origin).toBe(new URL(baseURL).origin)
    if (recipient === newEmail) newUserLink = link
  }
  const invitedContext = await browser.newContext()
  try {
    const invitedPage = await invitedContext.newPage()
    await completeInviteLink(invitedPage, newUserLink, null)
    await invitedPage.getByRole('button', { name: 'Accept and continue', exact: true }).click()
    await expect(invitedPage).toHaveURL(/\/dashboard(?:[?#].*)?$/)
    await expect(invitedPage.getByText('Viewer', { exact: true }).first()).toBeVisible()
  } finally {
    await invitedContext.close()
  }
  await page.reload()
  await expect(
    page.getByText('2 recipients · 2 sent · 0 pending · 0 need review · 0 skipped or cancelled', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 })
  await page
    .getByLabel('Email addresses', { exact: true })
    .fill(Array.from({ length: 1001 }, (_, n) => `queued${n}-${key}@example.com`).join('\n'))
  await page.getByLabel('I confirm these recipients', { exact: false }).check()
  await page.getByRole('button', { name: 'Queue invitations', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '1,001 invitations queued' }),
  ).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Cancel remaining invitations', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Remaining invitations cancelled' }),
  ).toBeVisible()
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: testInfo.outputPath(`onboarding-${width}.png`), fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
})
