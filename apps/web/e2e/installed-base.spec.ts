import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('installed-base groups preserve exact quantities, unknown ages and scoped responsive history', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const key = randomUUID(),
    password = `Population-${key}`,
    email = `population-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `population-viewer-${key}@example.com`,
    branchEmail = `population-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `population-${key}`
  await createOrganization(page, { name: 'Population evidence', slug, arabicEnabled: true })
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
    db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'BASE-L','Service location','branch','SA','Asia/Riyadh'),(%s,'OTHER-L','Other location','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'BASE-P','Installed part','Test','EA',1,'SAR')",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='OTHER-L'",(sys.argv[5],org))`)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/forecasts')
    await page.getByRole('link', { name: 'Installed base', exact: true }).click()
    await page.getByRole('link', { name: 'Import population', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/new$/)
    await expect(
      page.getByRole('heading', { name: 'Import population', exact: true }),
    ).toBeVisible()
    for (const [label, value] of [
      ['Part code', 'BASE-P'],
      ['Service location code', 'BASE-L'],
      ['Dataset name', 'Equipment population'],
      ['Part unit', 'EA'],
      ['Source and applicability notes', 'Synthetic source: <script>not executable</script>'],
      ['Population as of', '2026-01-02'],
      ['Source-declared availability date', '2026-01-03'],
    ]) {
      const field =
        label === 'Source and applicability notes'
          ? page.getByRole('textbox', { name: label, exact: true })
          : page.getByLabel(label, { exact: true })
      await field.fill(value)
      await expect(field).toHaveValue(value)
    }
    const header = 'group_code,group_name,installed_on,active_assets,parts_per_asset\n'
    const first = 'A,Known group,2026-01-01,12,2.500\n'
    const file = (text: string) => ({
      name: 'population.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(text),
    })
    await page
      .getByLabel('Equipment groups CSV', { exact: true })
      .setInputFiles(file(header + first + first))
    await expect(page.getByRole('main').getByRole('alert')).toContainText('record 3')
    await expect(
      page.getByRole('button', { name: 'Preview population', exact: true }),
    ).toBeDisabled()
    await page
      .getByLabel('Equipment groups CSV', { exact: true })
      .setInputFiles(
        file(header + first + 'B,Unknown age,,999999999999999,2.001\nC,Zero group,,0,1\n'),
      )
    await expect(page.getByRole('status')).toContainText('3 equipment groups')
    await expect(page.getByLabel('Part code', { exact: true })).toHaveValue('BASE-P')
    await expect(page.getByLabel('Service location code', { exact: true })).toHaveValue('BASE-L')
    await expect(page.getByLabel('Dataset name', { exact: true })).toHaveValue(
      'Equipment population',
    )
    await page.getByRole('button', { name: 'Preview population', exact: true }).click()
    const region = page.getByRole('region', { name: 'Equipment group evidence', exact: true })
    await expect(region.getByText('2000999999999997.999', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Part code', { exact: true })).toHaveValue('BASE-P')
    await expect(region.getByRole('row').filter({ hasText: 'Unknown age' })).toContainText(
      'Unknown',
    )
    await expect(region.getByRole('row').filter({ hasText: 'Known group' })).toContainText('30')
    await expect(
      page.getByRole('button', { name: 'Save population dataset', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox').nth(0).check()
    await page.getByRole('button', { name: 'Preview population', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save population dataset', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox').nth(1).check()
    await expect(region).toHaveCount(0)
    await page.getByRole('button', { name: 'Preview population', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save population dataset', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Part unit', { exact: true }).fill('BOX')
    await expect(
      page.getByRole('button', { name: 'Save population dataset', exact: true }),
    ).toHaveCount(0)
    await page.getByLabel('Part unit', { exact: true }).fill('EA')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      await expect(page.getByLabel('Part code', { exact: true })).toHaveCSS(
        'font-size',
        width < 768 ? '16px' : '14px',
      )
      await page.screenshot({
        path: testInfo.outputPath(`installed-base-form-en-${width}.png`),
        fullPage: true,
      })
    }
    await region.focus()
    await expect(region).toBeFocused()
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.items set name_en='Changed catalog name' where organization_id=%s",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save population dataset', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Refresh the preview')
    await page.getByRole('button', { name: 'Preview population', exact: true }).click()
    await expect(region).toBeVisible()
    await page.getByRole('button', { name: 'Save population dataset', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await expect(
      page.getByRole('heading', { name: 'Equipment population', exact: true }),
    ).toBeVisible()
    await expect(region.getByText('2000999999999997.999', { exact: true })).toBeVisible()
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(savedUrl).origin }])
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        const table = page.getByRole('region', {
          name: locale === 'ar' ? 'أدلة مجموعات المعدات' : 'Equipment group evidence',
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
          path: testInfo.outputPath(`installed-base-detail-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page.getByRole('link', { name: 'استيراد مجموعة معدات', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/new$/)
    await expect(
      page.getByRole('heading', { name: 'استيراد مجموعة معدات', exact: true }),
    ).toBeVisible()
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`installed-base-form-ar-${width}.png`),
        fullPage: true,
      })
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
    await page.goto('/forecasts/installed-base')
    await page.getByLabel('Dataset name', { exact: true }).fill('population')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/q=population/)
    await expect(
      page.getByRole('link', { name: 'Equipment population', exact: true }),
    ).toBeVisible()
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(savedUrl).origin }])
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(
        page.getByRole('link', { name: 'Equipment population', exact: true }),
      ).toBeVisible()
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        await page.screenshot({
          path: testInfo.outputPath(`installed-base-history-${locale}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
    await page.reload()
    await page.getByLabel('Service location code', { exact: true }).fill('OTHER-L')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/location=OTHER-L/)
    await expect(page.getByRole('status')).toHaveText('No population datasets match these filters.')
    const paged = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    original=db.execute('select report from public.installed_base_datasets where organization_id=%s',(sys.argv[2],)).fetchone()[0]['input']
    for n in range(1,27):
        payload={**original,'dataset_name':f'Pagination population {n:02d}', 'rows':[dict(group_code=f'GROUP-{i:03d}',group_name=f'Equipment {i}',installed_on=None,active_assets='1',parts_per_asset='0.001') for i in range(65)]}
        report=db.execute('select public.installed_base_preview(%s,%s)',(sys.argv[2],Jsonb(payload))).fetchone()[0]
        saved=db.execute('select public.installed_base_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(payload),uuid4(),report['fingerprint'])).fetchone()[0]
    print(saved)`)
    await page.goto('/forecasts/installed-base')
    const history = page.getByRole('region', { name: 'Installed base', exact: true })
    await expect(history.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(history.getByRole('row')).toHaveCount(3)
    await page.goto(`/forecasts/installed-base/${paged.stdout.trim()}`)
    await expect(region.getByRole('row')).toHaveCount(51)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(region.getByRole('row')).toHaveCount(16)
    await expect(region.getByRole('row').filter({ hasText: 'GROUP-064' })).toContainText('0.001')
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
            scoped.getByRole('heading', { name: 'Equipment population', exact: true }),
          ).toBeVisible()
        else expect(await response!.text()).not.toContain('Equipment population')
        const creation = await scoped.goto('/forecasts/installed-base/new')
        expect(creation?.status()).toBe(404)
        await scoped.goto('/forecasts/installed-base?q=Equipment')
        await expect(
          scoped.getByRole('link', { name: 'Import population', exact: true }),
        ).toHaveCount(0)
        await expect(
          scoped.getByRole('link', { name: 'Equipment population', exact: true }),
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
