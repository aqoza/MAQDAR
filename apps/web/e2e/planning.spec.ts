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

test('preparation preserves contributions and forecasts a saved group with fixed-group evidence', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const id = randomUUID()
  const email = `prepare-${id}@example.com`
  const password = `Prepare-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `prepare-${id}`
  await createOrganization(page, { name: `Preparation ${id}`, slug })
  const org = await organizationIdBySlug(slug)
  const location = randomUUID()
  await seedRows('locations', [
    {
      id: location,
      organization_id: org,
      code: 'PREP',
      name_en: 'Preparation branch',
      location_type: 'branch',
      country_code: 'SA',
      timezone: 'Asia/Riyadh',
    },
  ])
  const ids = Array.from({ length: 5 }, () => randomUUID())
  await seedRows(
    'items',
    ['OLD', 'NEW', 'ZZ-ALT', 'BAD', 'BAD-SET'].map((code, index) => ({
      id: ids[index],
      organization_id: org,
      code,
      name_en: code,
      product_group: 'Test',
      unit_of_measure: index === 4 ? 'SET' : 'EA',
      unit_cost: '1',
      currency: 'SAR',
    })),
  )
  await seedRows('item_supersessions', [
    {
      organization_id: org,
      predecessor_item_id: ids[0],
      successor_item_id: ids[1],
      effective_on: '2026-09-30',
      quantity_factor: '2',
    },
  ])
  await seedRows('item_interchanges', [
    { organization_id: org, item_id: ids[1], alternate_item_id: ids[2], direction: 'two_way' },
    { organization_id: org, item_id: ids[3], alternate_item_id: ids[4], direction: 'two_way' },
  ])
  await seedRows('demand_history', [
    {
      organization_id: org,
      location_id: location,
      item_id: ids[0],
      demand_date: '2026-10-01',
      quantity: '1.123',
      lost_sales_quantity: '0.500',
    },
    {
      organization_id: org,
      location_id: location,
      item_id: ids[2],
      demand_date: '2026-09-29',
      quantity: '3',
      lost_sales_quantity: '2',
    },
  ])
  await page.goto('/forecasts')
  await page.getByRole('link', { name: 'Prepare demand', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Prepare demand', exact: true })).toBeVisible()
  await page.getByLabel('Location code', { exact: true }).fill('PREP')
  await page.getByLabel('From date', { exact: true }).fill('2026-07-01')
  await page.getByLabel('History through date', { exact: true }).fill('2026-10-01')
  await page.getByLabel('Item codes (one per line)', { exact: true }).fill('NEW\nBAD')
  await page.getByRole('button', { name: 'Queue preparation', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/prepare$/)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Queue preparation', exact: true }).click()
  await expect(page.getByText('Queued', { exact: true })).toBeVisible()
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
  await page.getByRole('link', { name: 'View prepared demand', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Prepared demand results' })).toBeVisible()
  await expect(
    page.getByText('Two-way interchanges have different units.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('cell', { name: '5.246', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Inspect Unresolved group', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Queue prepared-group forecast' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Inspect NEW', exact: true }).click()
  const sources = page.getByRole('table', { name: 'Source contributions', exact: true })
  await expect(sources.getByRole('row')).toHaveCount(4)
  await expect(
    sources.getByRole('row').filter({ has: page.getByRole('cell', { name: 'OLD', exact: true }) }),
  ).toContainText('2.246')
  const daily = page.getByRole('table', { name: 'Daily prepared demand and calendar', exact: true })
  await expect(daily.getByRole('row')).toHaveCount(94)
  await expect(daily.getByRole('row').filter({ hasText: '2026-10-01' })).toContainText('Unknown')
  await expect(daily.getByRole('row').filter({ hasText: '2026-10-01' })).toContainText('2.246')
  await page.getByLabel('Forecast horizon (days)', { exact: true }).fill('7')
  await page.getByRole('button', { name: 'Queue prepared-group forecast', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/prepared\/.+/)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Queue prepared-group forecast', exact: true }).click()
  await expect(page.getByText('Queued', { exact: true })).toBeVisible()
  await promisify(execFile)('uv', ['run', 'maqdar-worker', '--once'], {
    cwd: resolve(process.cwd(), '../../engine'),
    env: { ...process.env, MAQDAR_WORKER_DSN: dsn },
    timeout: 100_000,
  })
  await page.getByRole('button', { name: 'Refresh runs' }).click()
  await page.getByRole('link', { name: 'View forecast results', exact: true }).click()
  await expect(page.getByText(/^Fixed-group comparisons:/)).toBeVisible()
  await page.getByRole('link', { name: 'Inspect NEW', exact: true }).click()
  await expect(
    page.getByText('Quantities and adjustments use the saved group unit: EA.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Calendar candidate evidence', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(/Unknown event dates: 1 in training and 7 in the forecast horizon/),
  ).toBeVisible()
  const comparison = page.getByRole('table', { name: 'Model comparison', exact: true })
  await expect(comparison.getByRole('cell', { name: /^Weekday and regional events/ })).toBeVisible()
  expect(await comparison.getByRole('row').count()).toBeGreaterThanOrEqual(9)
  const forecast = page.getByRole('table', { name: 'Daily forecast', exact: true })
  await expect(forecast.getByRole('row')).toHaveCount(8)
  await expect(forecast.getByRole('columnheader', { name: '95% upper', exact: true })).toBeVisible()
  await expect(page.getByText(/Held-out window: 2026-09-25 – 2026-10-01/)).toBeVisible()
  await page.getByText('Captured forecast calendar', { exact: true }).first().click()
  const future = page.getByRole('table', { name: 'Captured forecast calendar', exact: true })
  await expect(future.getByRole('row').nth(1)).toContainText('2026-10-02')
  await expect(future.getByRole('row').nth(1)).toContainText('Unknown')
  await page
    .getByRole('link', { name: 'Inspect saved preparation and source contributions', exact: true })
    .click()
  await expect(
    page.getByRole('table', { name: 'Source contributions', exact: true }).getByRole('row'),
  ).toHaveCount(4)
})

for (const method of ['baseline-v1', 'expanded-v1']) {
  test(`planner compares ${method} forecasts and inspects daily quantities and held-out windows`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const id = randomUUID()
    const email = `forecast-${id}@example.com`
    const password = `Forecast-${id}`
    await createConfirmedUser(email, password)
    await signInWithPassword(page, email, password)
    const slug = `forecast-${id}`
    await createOrganization(page, { name: `Forecast ${id}`, slug })
    const org = await organizationIdBySlug(slug)
    const location = randomUUID()
    const item = randomUUID()
    const shortItem = randomUUID()
    await seedRows('locations', [
      {
        id: location,
        organization_id: org,
        code: 'FC',
        name_en: 'Forecast branch',
        location_type: 'branch',
        country_code: 'SA',
        timezone: 'Asia/Riyadh',
      },
    ])
    await seedRows('items', [
      {
        id: item,
        organization_id: org,
        code: 'WEEKLY',
        name_en: 'Weekly part',
        product_group: 'Test',
        unit_of_measure: 'EA',
        unit_cost: '1.123',
        currency: 'KWD',
      },
      {
        id: shortItem,
        organization_id: org,
        code: 'NEW',
        name_en: 'New part',
        product_group: 'Test',
        unit_of_measure: 'EA',
        unit_cost: '1',
        currency: 'SAR',
        introduced_on: '2026-05-01',
      },
    ])
    await seedRows(
      'demand_history',
      Array.from({ length: 140 }, (_, i) => ({
        organization_id: org,
        item_id: item,
        location_id: location,
        demand_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        quantity: String((i % 7) + 1),
        lost_sales_quantity: '2.123',
      })),
    )
    await page.goto('/forecasts')
    await page.getByRole('link', { name: 'Create forecast', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Create forecast', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Forecast method', exact: true }).selectOption(method)
    await page.getByLabel('Location code', { exact: true }).fill('FC')
    await page.getByLabel('From date', { exact: true }).fill('2026-01-01')
    await page.getByLabel('History through date', { exact: true }).fill('2026-05-20')
    await page.getByLabel('Forecast horizon (days)', { exact: true }).fill('7')
    await page.getByLabel('Item codes (one per line)', { exact: true }).fill('WEEKLY\nNEW')
    await page.getByRole('button', { name: 'Queue forecast', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/new$/)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Queue forecast', exact: true }).click()
    await expect(page.getByText('Queued', { exact: true })).toBeVisible()
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
    await page.getByRole('link', { name: 'View forecast results' }).click()
    await expect(page.getByRole('heading', { name: 'Forecast results', exact: true })).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'Insufficient history', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'Weekly seasonal naive', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('cell', { name: '28', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Inspect WEEKLY', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Model comparison', exact: true })).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'Weekly seasonal naive · Selected', exact: true }),
    ).toBeVisible()
    const daily = page.getByRole('table', { name: 'Daily forecast', exact: true })
    await expect(daily.getByRole('row')).toHaveCount(8)
    await expect(daily.getByRole('row').nth(1)).toContainText('2026-05-21')
    if (method === 'expanded-v1') {
      await expect(page.getByRole('cell', { name: 'Automatic ETS', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Automatic ARIMA', exact: true })).toBeVisible()
      await expect(
        daily.getByRole('columnheader', { name: '95% upper', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Observed coverage: 80% bands — 100%; 95% bands — 100%.', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/Held-out window: 2026-05-14 – 2026-05-20/)).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: 'Daily forecast uncertainty' })).toHaveCount(0)
    }
    await page.getByText('Backtest windows and scores', { exact: true }).click()
    await expect(
      page.getByText('Window 3: train 2026-01-01 – 2026-05-13; test 2026-05-14 – 2026-05-20', {
        exact: true,
      }),
    ).toBeVisible()
    await page
      .locator('summary')
      .filter({ hasText: /^Captured sales history$/ })
      .click()
    await expect(
      page
        .getByRole('table', { name: 'Captured sales history', exact: true })
        .getByRole('row')
        .nth(1),
    ).toContainText('2.123')
  })
}

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

test('confirmed history produces inspectable classifications with separate lost sales', async ({
  page,
}) => {
  const id = randomUUID()
  const email = `classify-${id}@example.com`
  const password = `Classify-${id}`
  await createConfirmedUser(email, password)
  await signInWithPassword(page, email, password)
  const slug = `classify-${id}`
  await createOrganization(page, { name: `Classification ${id}`, slug })
  const org = await organizationIdBySlug(slug)
  const location = randomUUID()
  const item = randomUUID()
  await seedRows('locations', [
    {
      id: location,
      organization_id: org,
      code: 'CLASS',
      name_en: 'Classification branch',
      location_type: 'branch',
      country_code: 'SA',
      timezone: 'Asia/Riyadh',
    },
  ])
  await seedRows('items', [
    {
      id: item,
      organization_id: org,
      code: 'PART-1',
      name_en: 'Test part',
      product_group: 'Test',
      unit_of_measure: 'EA',
      unit_cost: '1.123',
      currency: 'KWD',
      status: 'phase_out',
    },
  ])
  await seedRows(
    'demand_history',
    ['2026-10-01', '2026-10-02'].map((date) => ({
      organization_id: org,
      item_id: item,
      location_id: location,
      demand_date: date,
      quantity: '2',
      lost_sales_quantity: '3.456',
    })),
  )
  await page.goto('/forecasts')
  await page.getByRole('link', { name: 'Classify demand', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Classify demand', exact: true })).toBeVisible()
  await page.getByLabel('Location code', { exact: true }).fill('CLASS')
  await page.getByLabel('From date', { exact: true }).fill('2026-10-01')
  await page.getByLabel('To date', { exact: true }).fill('2026-10-02')
  await page.getByRole('button', { name: 'Queue classification', exact: true }).click()
  await expect(page).toHaveURL(/\/forecasts\/classify$/)
  await expect(page.getByLabel('Location code', { exact: true })).toHaveValue('CLASS')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Queue classification', exact: true }).click()
  await expect(page.getByText('Queued', { exact: true })).toBeVisible()
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
  await page.getByRole('link', { name: 'View classification results' }).click()
  await expect(page.getByRole('heading', { name: 'Demand classification results' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Smooth', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '4.492 KWD', exact: true })).toBeVisible()
  await page.getByText('Show evidence', { exact: true }).click()
  await expect(page.getByText('6.912', { exact: true })).toBeVisible()
  await expect(page.getByText('Phase out', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Demand pattern', exact: true }).selectOption('no_sales')
  await page.getByRole('button', { name: 'Filter results' }).click()
  await expect(page.getByText('No items match this view.')).toBeVisible()
})
