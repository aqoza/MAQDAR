import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  seedRows,
  signedInClient,
  signInWithPassword,
  signOut,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('dashboard projection retains tenant, branch and hidden-location 404 boundaries', async ({
  page,
}) => {
  const prefetched = new Set<string>()
  page.on('request', (request) => {
    if (
      new URL(page.url()).pathname === '/dashboard' &&
      request.headers()['next-router-prefetch']
    ) {
      prefetched.add(new URL(request.url()).pathname)
    }
  })
  const key = randomUUID()
  const password = `Dashboard-isolation-${key}`
  const ownerEmail = `dashboard-owner-${key}@example.com`
  await createConfirmedUser(ownerEmail, password)
  await signInWithPassword(page, ownerEmail, password)
  const slug = `dashboard-isolation-${key}`
  await createOrganization(page, { name: 'Synthetic dashboard isolation', slug })
  const organization = await organizationIdBySlug(slug)

  const foreignEmail = `dashboard-foreign-${key}@example.com`
  await createConfirmedUser(foreignEmail, password)
  const foreign = await signedInClient(foreignEmail, password)
  const created = await foreign.rpc('create_organization', {
    p_name: 'Synthetic foreign dashboard',
    p_slug: `foreign-dashboard-${key}`,
  })
  if (created.error || !created.data) throw new Error('Could not create local isolation fixture')
  const foreignOrganization = created.data
  const allowed = randomUUID()
  const restricted = randomUUID()
  const hidden = randomUUID()
  await seedRows(
    'locations',
    [
      { id: allowed, organization_id: organization, code: 'ALLOWED', name_en: 'Allowed branch' },
      {
        id: restricted,
        organization_id: organization,
        code: 'RESTRICTED',
        name_en: 'Other branch',
      },
      {
        id: hidden,
        organization_id: foreignOrganization,
        code: 'FOREIGN',
        name_en: 'Foreign branch',
      },
    ].map((row) => ({
      ...row,
      location_type: 'branch',
      country_code: 'SA',
      timezone: 'Asia/Riyadh',
    })),
  )
  const item = randomUUID()
  const foreignItem = randomUUID()
  await seedRows(
    'items',
    [
      { id: item, organization_id: organization, code: 'LOCAL', name_en: 'Local fixture' },
      {
        id: foreignItem,
        organization_id: foreignOrganization,
        code: 'FOREIGN',
        name_en: 'Foreign fixture',
      },
    ].map((row) => ({
      ...row,
      product_group: 'Isolation fixture',
      unit_of_measure: 'EA',
      unit_cost: '1.125',
      currency: 'SAR',
    })),
  )
  await seedRows(
    'stock_snapshots',
    [
      { organization_id: organization, item_id: item, location_id: allowed, quantity: '2' },
      { organization_id: organization, item_id: item, location_id: restricted, quantity: '0' },
      {
        organization_id: foreignOrganization,
        item_id: foreignItem,
        location_id: hidden,
        quantity: '900',
      },
    ].map((row) => ({ ...row, snapshot_date: '2026-10-17', unit_cost: '1.125', currency: 'SAR' })),
  )

  await page.goto('/dashboard?day=2026-10-17')
  await expect(page.locator('.dashboard-location-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.dashboard-metric').first()).toContainText('50%')
  await expect(page.locator('#dashboard-location-options option')).toHaveCount(2)
  const foreignResponse = await page.goto('/dashboard?day=2026-10-17&location=FOREIGN')
  expect(foreignResponse?.status()).toBe(404)

  const branchEmail = `dashboard-branch-${key}@example.com`
  const branchUser = await createConfirmedUser(branchEmail, password)
  await seedRows('memberships', [
    { organization_id: organization, user_id: branchUser, role: 'branch_user' },
  ])
  await seedRows('membership_locations', [
    { organization_id: organization, user_id: branchUser, location_id: allowed },
  ])
  const branch = await signedInClient(branchEmail, password)
  const active = await branch.rpc('set_active_organization', { p_organization_id: organization })
  if (active.error) throw new Error('Could not activate local branch fixture')
  await signOut(page)
  await signInWithPassword(page, branchEmail, password)
  await page.goto('/dashboard?day=2026-10-17')
  await expect(page.locator('.dashboard-location-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.dashboard-location-table')).toContainText('ALLOWED')
  await expect(page.locator('.dashboard-location-table')).not.toContainText('RESTRICTED')
  await expect(page.locator('.dashboard-metric').first()).toContainText('100%')
  await expect(page.locator('#dashboard-location-options option')).toHaveCount(1)
  for (const location of ['RESTRICTED', 'FOREIGN']) {
    const response = await page.goto(`/dashboard?day=2026-10-17&location=${location}`)
    expect(response?.status()).toBe(404)
  }
  expect([...prefetched]).toEqual([])
})
