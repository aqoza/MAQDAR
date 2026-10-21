import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('installed-base demand preserves explicit rates, exact expectations and scoped responsive history', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID(),
    password = `Demand-${key}`,
    email = `demand-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `demand-viewer-${key}@example.com`,
    branchEmail = `demand-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `installed-demand-${key}`
  await createOrganization(page, { name: 'Installed demand evidence', slug, arabicEnabled: true })
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
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const visual = async (kind: string, locale: string) => {
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      await page.screenshot({
        path: testInfo.outputPath(`installed-base-demand-${kind}-${locale}-${width}.png`),
        fullPage: true,
      })
    }
  }
  const locale = async (value: string) => {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    org=sys.argv[2]
    db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'BASE-L','Service location','branch','SA','Asia/Riyadh'),(%s,'OTHER-L','Other location','branch','SA','Asia/Riyadh')",(org,org))
    db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'BASE-P','Installed part','Test','EA',1,'SAR')",(org,))
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='OTHER-L'",(sys.argv[5],org))
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=org,role='authenticated')),))
    source=dict(item_code='BASE-P',location_code='BASE-L',dataset_name='Equipment population',unit='EA',source='Synthetic source',as_of='2026-01-02',available_on='2026-01-03',confirmed=True,non_overlapping=True,rows=[dict(group_code='A',group_name='Known group',installed_on='2026-01-01',active_assets='12',parts_per_asset='2.5'),dict(group_code='B',group_name='Unknown age',installed_on=None,active_assets='3',parts_per_asset='0.001'),dict(group_code='C',group_name='Zero group',installed_on=None,active_assets='0',parts_per_asset='1')])
    preview=db.execute('select public.installed_base_preview(%s,%s)',(org,Jsonb(source))).fetchone()[0]
    saved=db.execute('select public.installed_base_save(%s,%s,%s,%s)',(org,Jsonb(source),uuid4(),preview['fingerprint'])).fetchone()[0]
    print(saved)`)
    const dataset = seeded.stdout.trim(),
      sourceUrl = `/forecasts/installed-base/${dataset}`,
      createUrl = `${sourceUrl}/demand`
    await page.goto(sourceUrl)
    await page.getByRole('link', { name: 'Create demand scenario', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${dataset}/demand$`))
    await expect(page.getByLabel('Horizon (calendar days)', { exact: true })).toHaveValue('28')
    const preview = page.getByRole('button', { name: 'Preview expected demand', exact: true })
    await expect(preview).toBeDisabled()
    await page.getByLabel('Scenario name', { exact: true }).fill('Conditional replacement demand')
    await page.getByLabel('Planning cutoff', { exact: true }).fill('2026-01-03')
    for (const [group, rate] of [
      ['A · Known group', '0.01'],
      ['B · Unknown age', '0.000000001'],
    ]) {
      const fieldset = page.getByRole('group', { name: group, exact: true })
      await fieldset.getByLabel('Daily replacement rate', { exact: true }).fill(rate)
      await fieldset.getByLabel('Rate declared available on', { exact: true }).fill('2026-01-03')
      await fieldset
        .getByLabel('Rate source or reason', { exact: true })
        .fill('Planner assumption <script>not executable</script>')
    }
    await expect(preview).toBeDisabled() // zero-asset groups also require explicit rates
    const zero = page.getByRole('group', { name: 'C · Zero group', exact: true })
    await zero.getByLabel('Daily replacement rate', { exact: true }).fill('0')
    await zero.getByLabel('Rate declared available on', { exact: true }).fill('2026-01-04')
    await zero.getByLabel('Rate source or reason', { exact: true }).fill('Explicit zero')
    await expect(preview).toBeDisabled()
    await zero.getByLabel('Rate declared available on', { exact: true }).fill('2026-01-03')
    await preview.click()
    const table = page.getByRole('region', { name: 'Group demand contributions', exact: true })
    await expect(table.getByText('0.000000000003', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Conditional expected demand', exact: true }),
    ).toContainText('8.400000000084')
    await expect(
      page.getByRole('button', { name: 'Save demand scenario', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('checkbox').check()
    await expect(table).toHaveCount(0)
    await preview.click()
    await expect(
      page.getByRole('button', { name: 'Save demand scenario', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Horizon (calendar days)', { exact: true }).fill('29')
    await expect(
      page.getByRole('button', { name: 'Save demand scenario', exact: true }),
    ).toHaveCount(0)
    await page.getByLabel('Horizon (calendar days)', { exact: true }).fill('28')
    await page.getByText('Import rates from CSV', { exact: true }).click()
    const header = 'group_code,daily_rate,source,available_on\n'
    const file = (text: string) => ({
      name: 'rates.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(text),
    })
    await page
      .getByLabel('Replacement rates CSV', { exact: true })
      .setInputFiles(file(header + 'A,0,Source,2026-01-03\n'))
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'exactly the saved population groups',
    )
    await expect(preview).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Save demand scenario', exact: true }),
    ).toHaveCount(0)
    await page
      .getByLabel('Replacement rates CSV', { exact: true })
      .setInputFiles(
        file(
          header +
            'C,0,Explicit zero,2026-01-03\nB,0.000000001,"Assumption, not learned",2026-01-02\nA,0.01,Assumption A,2026-01-03\n',
        ),
      )
    await expect(page.getByRole('status')).toContainText('3 of 3 groups')
    await preview.click()
    await expect(table.getByText('0.000000000003', { exact: true })).toBeVisible()
    await visual('form', 'en')
    await page.getByRole('button', { name: 'Save demand scenario', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/installed-base\/demand\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await expect(
      page.getByRole('heading', { name: 'Conditional replacement demand', exact: true }),
    ).toBeVisible()
    await page.getByText('Daily expected demand ledger', { exact: true }).first().click()
    const ledger = page.getByRole('region', { name: 'Daily expected demand ledger', exact: true })
    await expect(ledger.getByRole('row')).toHaveCount(29)
    await expect(ledger.getByText('2026-01-04', { exact: true })).toBeVisible()
    await expect(ledger.getByText('2026-01-31', { exact: true })).toBeVisible()
    await page.getByText('Copied population and age evidence', { exact: true }).click()
    await expect(
      page
        .getByRole('region', { name: 'Equipment group evidence', exact: true })
        .getByRole('row')
        .filter({ hasText: 'Unknown age' }),
    ).toContainText('Unknown')
    for (const lang of ['en', 'ar']) {
      await locale(lang)
      await visual('detail', lang)
      await page.setViewportSize({ width: 375, height: 1000 })
      const region = page.getByRole('region', {
        name: lang === 'en' ? 'Group demand contributions' : 'مساهمات المجموعات في الطلب',
        exact: true,
      })
      await region.focus()
      await expect(region).toBeFocused()
      await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight')
      await expect.poll(() => region.evaluate((e) => Math.abs(e.scrollLeft))).toBeGreaterThan(0)
    }
    await page.goto(createUrl)
    await visual('form', 'ar')
    await locale('en')
    await page.goto('/forecasts/installed-base/demand')
    await page.getByLabel('Scenario name', { exact: true }).fill('replacement')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page).toHaveURL(/q=replacement/)
    await expect(
      page.getByRole('link', { name: 'Conditional replacement demand', exact: true }),
    ).toBeVisible()
    for (const lang of ['en', 'ar']) {
      await locale(lang)
      await visual('history', lang)
    }
    await locale('en')
    await page.getByLabel('Service location code', { exact: true }).fill('OTHER-L')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(
      'No saved demand scenarios match these filters.',
    )
    const many = await python(`import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    original=db.execute('select report from public.installed_base_demand_scenarios where organization_id=%s',(sys.argv[2],)).fetchone()[0]['input']
    for n in range(26):
        payload={**original,'scenario_name':f'Pagination demand {n:02d}'}
        report=db.execute('select public.installed_base_demand_preview(%s,%s)',(sys.argv[2],Jsonb(payload))).fetchone()[0]
        db.execute('select public.installed_base_demand_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(payload),uuid4(),report['fingerprint']))
    population=db.execute('select report from public.installed_base_datasets where organization_id=%s',(sys.argv[2],)).fetchone()[0]['input']
    population={**population,'rows':[dict(group_code=f'G{i:03d}',group_name=f'Group {i}',installed_on=None,active_assets='1',parts_per_asset='1') for i in range(65)]}
    report=db.execute('select public.installed_base_preview(%s,%s)',(sys.argv[2],Jsonb(population))).fetchone()[0]
    dataset=db.execute('select public.installed_base_save(%s,%s,%s,%s)',(sys.argv[2],Jsonb(population),uuid4(),report['fingerprint'])).fetchone()[0]
    print(dataset)`)
    await page.goto('/forecasts/installed-base/demand')
    const history = page.getByRole('region', { name: 'Installed-base demand', exact: true })
    await expect(history.getByRole('row')).toHaveCount(26)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(history.getByRole('row')).toHaveCount(3)
    await page.goto(`/forecasts/installed-base/${many.stdout.trim()}/demand`)
    await expect(page.getByLabel('Daily replacement rate', { exact: true })).toHaveCount(25)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('group', { name: 'G025 · Group 25', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByLabel('Daily replacement rate', { exact: true })).toHaveCount(15)
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
            scoped.getByRole('heading', { name: 'Conditional replacement demand', exact: true }),
          ).toBeVisible()
        else expect(await response!.text()).not.toContain('Conditional replacement demand')
        expect((await scoped.goto(createUrl))?.status()).toBe(404)
        await scoped.goto('/forecasts/installed-base/demand?q=Conditional')
        await expect(
          scoped.getByRole('link', { name: 'Conditional replacement demand', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
      } finally {
        await context.close()
      }
    }
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.installed_base_datasets where organization_id=%s',(sys.argv[2],))`)
    await page.goto(savedUrl)
    await expect(
      page.getByText(
        'The original population is unavailable. Its copied evidence remains part of this saved scenario.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Conditional expected demand', exact: true }),
    ).toContainText('8.400000000084')
    await expect(
      page.getByRole('link', { name: 'Create demand scenario', exact: true }),
    ).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:6],))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
