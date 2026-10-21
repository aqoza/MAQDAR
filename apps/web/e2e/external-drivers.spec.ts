import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('driver CSV evidence stays exact, scoped and responsive in both languages', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Driver-${key}`,
    email = `driver-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `driver-viewer-${key}@example.com`,
    branchEmail = `driver-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `driver-${key}`
  await createOrganization(page, { name: 'Driver evidence', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60_000,
    })
  try {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    org=sys.argv[2]
    db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'DRIVER-L','Driver location','branch','SA','Asia/Riyadh'),(%s,'OTHER-L','Other location','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'DRIVER-P','Driver part','Test','EA',1,'SAR')",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='OTHER-L'",(sys.argv[5],org))`)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/forecasts')
    await page.getByRole('link', { name: 'External drivers', exact: true }).click()
    await page.getByRole('link', { name: 'Import driver dataset', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/drivers\/new$/)
    await expect(
      page.getByRole('heading', { name: 'Import driver dataset', exact: true }),
    ).toBeVisible()
    for (const [label, value] of [
      ['Item code', 'DRIVER-P'],
      ['Location code', 'DRIVER-L'],
      ['Driver name', 'Daily temperature'],
      ['Driver unit', 'degrees Celsius'],
      ['Source and applicability notes', 'Synthetic source: <script>not executable</script>'],
      ['History starts', '2026-01-01'],
      ['History cutoff', '2026-01-02'],
      ['Forecast window ends', '2026-01-04'],
    ]) {
      const field =
        label === 'Source and applicability notes'
          ? page.getByRole('textbox', { name: label, exact: true })
          : page.getByLabel(label, { exact: true })
      await field.fill(value)
      await expect(field).toHaveValue(value)
    }
    const header = 'date,value,kind,available_on\n'
    const first = '2026-01-01,-0.123456,observed,2026-01-01\n'
    const file = (text: string) => ({
      name: 'drivers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(text),
    })
    await page
      .getByLabel('Daily values CSV', { exact: true })
      .setInputFiles(file(header + first + first))
    await expect(page.getByRole('main').getByRole('alert')).toContainText('record 3')
    await expect(page.getByRole('button', { name: 'Preview coverage', exact: true })).toBeDisabled()
    await page
      .getByLabel('Daily values CSV', { exact: true })
      .setInputFiles(
        file(
          header +
            first +
            '2026-01-03,999999999999.999999,observed,2026-01-04\n2026-01-04,0,planned,2026-01-01\n',
        ),
      )
    await expect(page.getByRole('status')).toContainText('3 daily values')
    await expect(page.getByLabel('Item code', { exact: true })).toHaveValue('DRIVER-P')
    await expect(page.getByLabel('Location code', { exact: true })).toHaveValue('DRIVER-L')
    await expect(page.getByLabel('Driver name', { exact: true })).toHaveValue('Daily temperature')
    await page.getByRole('button', { name: 'Preview coverage', exact: true }).click()
    const region = page.getByRole('region', { name: 'Daily driver evidence', exact: true })
    await expect(region.getByText('999999999999.999999', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Item code', { exact: true })).toHaveValue('DRIVER-P')
    await expect(region.getByRole('row').filter({ hasText: '2026-01-02' })).toContainText(
      'Missing — unknown',
    )
    await expect(region.getByRole('row').filter({ hasText: '999999999999.999999' })).toContainText(
      'Declared after cutoff',
    )
    await expect(
      page.getByRole('button', { name: 'Save driver dataset', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox').check()
    await expect(region).toHaveCount(0)
    await page.getByRole('button', { name: 'Preview coverage', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save driver dataset', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Driver unit', { exact: true }).fill('Kelvin')
    await expect(
      page.getByRole('button', { name: 'Save driver dataset', exact: true }),
    ).toHaveCount(0)
    await page.getByLabel('Driver unit', { exact: true }).fill('degrees Celsius')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      await expect(page.getByLabel('Item code', { exact: true })).toHaveCSS(
        'font-size',
        width < 768 ? '16px' : '14px',
      )
      await page.screenshot({
        path: testInfo.outputPath(`drivers-form-en-${width}.png`),
        fullPage: true,
      })
    }
    await region.focus()
    await expect(region).toBeFocused()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.items set name_en='Changed catalog name' where organization_id=%s",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save driver dataset', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Refresh the preview')
    await page.getByRole('button', { name: 'Preview coverage', exact: true }).click()
    await expect(region).toBeVisible()
    await page.getByRole('button', { name: 'Save driver dataset', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/drivers\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await expect(
      page.getByRole('heading', { name: 'Daily temperature', exact: true }),
    ).toBeVisible()
    await expect(region.getByText('-0.123456', { exact: true })).toBeVisible()
    for (const locale of ['en', 'ar']) {
      await page.context().addCookies([{ name: 'locale', value: locale, url: savedUrl }])
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        const table = page.getByRole('region', {
          name: locale === 'ar' ? 'الأدلة اليومية للعامل' : 'Daily driver evidence',
          exact: true,
        })
        await table.focus()
        await expect(table).toBeFocused()
        if (width === 375) {
          await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
          await expect
            .poll(() => table.evaluate((element) => Math.abs(element.scrollLeft)))
            .toBeGreaterThan(0)
          await table.evaluate((element) => {
            element.scrollLeft = 0
          })
        }
        await page.screenshot({
          path: testInfo.outputPath(`drivers-detail-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page.getByRole('link', { name: 'استيراد بيانات عامل خارجي', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/drivers\/new$/)
    await expect(
      page.getByRole('heading', { name: 'استيراد بيانات عامل خارجي', exact: true }),
    ).toBeVisible()
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`drivers-form-ar-${width}.png`),
        fullPage: true,
      })
    }
    await page.context().addCookies([{ name: 'locale', value: 'en', url: savedUrl }])
    await page.goto('/forecasts/drivers')
    await page.getByLabel('Driver name', { exact: true }).fill('temperature')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/q=temperature/)
    await expect(page.getByRole('link', { name: 'Daily temperature', exact: true })).toBeVisible()
    for (const locale of ['en', 'ar']) {
      await page.context().addCookies([{ name: 'locale', value: locale, url: savedUrl }])
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(page.getByRole('link', { name: 'Daily temperature', exact: true })).toBeVisible()
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        await page.screenshot({
          path: testInfo.outputPath(`drivers-history-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page.context().addCookies([{ name: 'locale', value: 'en', url: savedUrl }])
    await page.reload()
    await page.getByLabel('Location code', { exact: true }).fill('OTHER-L')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/location=OTHER-L/)
    await expect(page.getByRole('status')).toHaveText('No driver datasets match these filters.')
    const paged = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    original=db.execute('select report from public.external_driver_datasets where organization_id=%s',(sys.argv[2],)).fetchone()[0]['input']
    for n in range(1,27):
        payload={**original,'driver_name':f'Pagination driver {n:02d}','history_from':'2025-11-01'}
        report=db.execute('select public.external_driver_preview(%s,%s)',(sys.argv[2],Jsonb(payload))).fetchone()[0]
        saved=db.execute('select public.external_driver_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(payload),uuid4(),report['fingerprint'])).fetchone()[0]
    print(saved)`)
    await page.goto('/forecasts/drivers')
    const history = page.getByRole('region', { name: 'External drivers', exact: true })
    await expect(history.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(history.getByRole('row')).toHaveCount(3)
    await page.goto(`/forecasts/drivers/${paged.stdout.trim()}`)
    await expect(region.getByRole('row')).toHaveCount(51)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(region.getByRole('row')).toHaveCount(16)
    await expect(region.getByText('999999999999.999999', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    for (const [address, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, address, password)
        const response = await scoped.goto(savedUrl)
        expect(response?.status()).toBe(allowed ? 200 : 404)
        if (allowed)
          await expect(
            scoped.getByRole('heading', { name: 'Daily temperature', exact: true }),
          ).toBeVisible()
        else expect(await response!.text()).not.toContain('Daily temperature')
        const creation = await scoped.goto('/forecasts/drivers/new')
        expect(creation?.status()).toBe(404)
        await scoped.goto('/forecasts/drivers?q=temperature')
        await expect(
          scoped.getByRole('link', { name: 'Import driver dataset', exact: true }),
        ).toHaveCount(0)
        await expect(
          scoped.getByRole('link', { name: 'Daily temperature', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
      } finally {
        await context.close()
      }
    }
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:6],))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
