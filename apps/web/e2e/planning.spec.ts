import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signInWithPassword,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('planner queues a readiness check, the worker completes it, and another run can be canceled', async ({
  page,
}) => {
  const id = randomUUID()
  const email = `planning-${id}@example.com`
  const password = `Planning-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `planning-${id}`
  await createOrganization(page, { name: `Planning ${id}`, slug })
  const org = await organizationIdBySlug(slug)
  const location = randomUUID()
  await seedRows('locations', [
    {
      id: location,
      organization_id: org,
      code: 'TEST',
      name_en: 'Test branch',
      location_type: 'branch',
      country_code: 'SA',
      timezone: 'Asia/Riyadh',
    },
  ])
  await page.goto('/forecasts')
  await expect(page.getByRole('heading', { name: 'Forecasts and planning runs' })).toBeVisible()
  await page.getByLabel('Location code', { exact: true }).fill('TEST')
  await page.getByRole('button', { name: 'Check demand data', exact: true }).click()
  await expect(page.getByText('Queued', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check demand data', exact: true })).toHaveCount(0)
  // Runs only against the same loopback stack as seedRows, never a hosted worker.
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local worker test only')
  await promisify(execFile)('uv', ['run', 'maqdar-worker', '--once'], {
    cwd: resolve(process.cwd(), '../../engine'),
    env: { ...process.env, MAQDAR_WORKER_DSN: dsn },
    timeout: 100_000,
  })
  await page.getByRole('button', { name: 'Refresh runs' }).click()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(page.getByText('No stored demand records were found in this window.')).toBeVisible()
  await page.getByLabel('Location code', { exact: true }).fill('TEST')
  await page.getByRole('button', { name: 'Check demand data', exact: true }).click()
  await expect(page.getByText('Queued', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel run' }).click()
  await expect(page.getByText('Canceled', { exact: true })).toBeVisible()
})
