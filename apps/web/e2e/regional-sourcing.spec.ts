import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional sourcing preserves allocation evidence, pagination, permissions and responsive layouts', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const key = randomUUID(),
    password = `Sourcing-${key}`,
    email = `sourcing-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `sourcing-viewer-${key}@example.com`,
    branchEmail = `sourcing-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `sourcing-${key}`
  await createOrganization(page, { name: 'Regional sourcing', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug),
    dsn = process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, viewer, branch], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60000,
    })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const root = '/replenishment/regional-stock/sourcing'
  async function visual(kind: string, lang: string) {
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const value = page.locator('.text-evidence-value').first()
      if (await value.count()) await expect(value).toHaveCSS('font-size', '14px')
      await page.screenshot({
        path: testInfo.outputPath(`regional-sourcing-${kind}-${lang}-${width}.png`),
        fullPage: true,
      })
    }
  }
  async function locale(value: string) {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    const seed = await python(`import sys,json,psycopg
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'tests')
from regional_sourcing_fixture import seed_regional_sourcing
with psycopg.connect(sys.argv[1]) as db:
    inputs,report=seed_regional_sourcing(db,sys.argv[2],sys.argv[3])
    for user,role in [(sys.argv[4],'viewer'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='DEST'",(sys.argv[5],sys.argv[2]))
    print(json.dumps(inputs))`)
    const inputs = JSON.parse(seed.stdout.trim()) as {
      region_id: string
      draft_id: string
      sources: { location_id: string; policy_id: string }[]
    }
    await python(`import sys,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    policy='${inputs.sources[0].policy_id}'
    db.execute("update public.planning_runs set finished_at=now()-interval '1 day' where id=(select run_id from public.inventory_policies where id=%s)",(policy,))
    for n in range(26):
        run=uuid4()
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) select %s,organization_id,location_id,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now() from public.inventory_policies where id=%s",(run,uuid4(),policy))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) select %s,organization_id,%s,location_id,%s,item_id,item_code,unit,status,summary,evidence from public.inventory_policies where id=%s",(uuid4(),run,uuid4(),policy))
        db.execute("insert into public.policy_overrides(organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id) select organization_id,id,location_id,%s,%s,%s,1,20,'Saved comparison','approved',%s,now(),'Reviewed',%s from public.inventory_policies where id=%s",(n+1,uuid4(),sys.argv[3],sys.argv[4],uuid4(),policy))`)
    await page.goto(root)
    await page.getByRole('link', { name: 'New regional sourcing scenario', exact: true }).click()
    await page.getByRole('link', { name: 'Northern sourcing region', exact: true }).click()
    await page.getByRole('link', { name: /REG-P · DEST/ }).click()
    const newUrl = page.url()
    const fill = async (ar = false) => {
      for (const [index, code] of ['SOURCE-A', 'SOURCE-B'].entries()) {
        const group = page.getByRole('group', { name: code, exact: true })
        if (index === 0) {
          await group.getByRole('button', { name: ar ? 'التالي' : 'Next', exact: true }).click()
          await expect(
            group.locator(`option[value="${inputs.sources[index].policy_id}"]`),
          ).toHaveCount(1)
        }
        await group
          .getByLabel(ar ? 'سياسة المصدر' : 'Source policy', { exact: true })
          .selectOption(inputs.sources[index].policy_id)
        await expect(
          group.getByLabel(ar ? 'الحد الأقصى المختار' : 'Selected maximum', { exact: true }),
        ).toBeEnabled()
        if (index === 0) {
          await group
            .getByRole('button', { name: ar ? 'الحدود التالية' : 'Next maxima', exact: true })
            .click()
          const maximum = group.getByLabel(ar ? 'الحد الأقصى المختار' : 'Selected maximum', {
            exact: true,
          })
          await maximum.selectOption({
            label: ar ? 'التعديل المعتمد 1 · 20' : 'Approved revision 1 · 20',
          })
          const selected = await maximum.inputValue()
          await group
            .getByRole('button', { name: ar ? 'الحدود السابقة' : 'Previous maxima', exact: true })
            .click()
          await expect(maximum).toHaveValue(selected)
        }
        await group
          .getByLabel(ar ? 'الحد الأقصى المختار' : 'Selected maximum', { exact: true })
          .selectOption('calculated')
        await group
          .getByLabel(ar ? 'طلبات متأخرة إضافية غير مخصصة' : 'Additional unallocated backorders', {
            exact: true,
          })
          .fill(ar ? '٠' : '0')
      }
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
      await page
        .getByRole('button', { name: ar ? 'معاينة التوريد' : 'Preview sourcing', exact: true })
        .click()
      await expect(
        page.getByRole('button', {
          name: ar ? 'حفظ سيناريو التوريد' : 'Save sourcing scenario',
          exact: true,
        }),
      ).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Preview sourcing', exact: true })).toBeDisabled()
    await fill()
    const allocations = page.getByRole('region', { name: 'Source allocations', exact: true })
    await expect(allocations).toContainText('4.667')
    await expect(allocations).toContainText('9.333')
    const backorders = page
      .getByRole('group', { name: 'SOURCE-A', exact: true })
      .getByLabel('Additional unallocated backorders', { exact: true })
    await backorders.fill('1')
    await expect(
      page.getByRole('button', { name: 'Save sourcing scenario', exact: true }),
    ).toHaveCount(0)
    await backorders.fill('0')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("update public.locations set name_en='Updated source' where organization_id=%s and code='SOURCE-A'",(sys.argv[2],))`)
    await page.getByRole('button', { name: 'Save sourcing scenario', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Evidence changed')
    await page.getByRole('button', { name: 'Preview sourcing', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await visual('preview', 'en')
    await page.setViewportSize({ width: 375, height: 1000 })
    await allocations.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => allocations.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Save sourcing scenario', exact: true }).click()
    await expect(page).toHaveURL(/sourcing\/[0-9a-f-]{36}$/)
    const savedUrl = page.url()
    await visual('detail', 'en')
    await locale('ar')
    await visual('detail', 'ar')
    await page.goto(newUrl)
    await fill(true)
    await visual('preview', 'ar')
    // A valid held preview must fail if its region is archived in another session.
    await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.stock_region_archive(%s,%s)',(sys.argv[2],'${inputs.region_id}'))`)
    await page.getByRole('button', { name: 'حفظ سيناريو التوريد', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
    expect((await page.goto(newUrl))?.status()).toBe(404)
    expect((await page.goto(savedUrl))?.status()).toBe(200)
    await page.goto(root)
    await visual('history', 'ar')
    await locale('en')
    await visual('history', 'en')
    await page.getByLabel('Search region, item or location', { exact: true }).fill('no-match')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('No scenarios match')
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(
      page.getByRole('link', { name: 'Northern sourcing region', exact: true }),
    ).toBeVisible()
    for (const [email, allowed] of [
      [viewerEmail, true],
      [branchEmail, false],
    ] as const) {
      const context = await browser.newContext(),
        scoped = await context.newPage()
      try {
        await signInWithPassword(scoped, email, password)
        const response = await scoped.goto(savedUrl)
        expect(response?.status()).toBe(allowed ? 200 : 404)
        if (!allowed) expect(await response!.text()).not.toContain('Northern sourcing region')
        expect((await scoped.goto(`${root}/new`))?.status()).toBe(404)
        await scoped.goto(root)
        await expect(
          scoped.getByRole('link', { name: 'Northern sourcing region', exact: true }),
        ).toHaveCount(allowed ? 1 : 0)
        if (!allowed) {
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code<>'DEST'",(sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(200)
          await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select id from public.locations where organization_id=%s and code='SOURCE-B')",(sys.argv[2],sys.argv[5],sys.argv[2]))`)
          expect((await scoped.goto(savedUrl))?.status()).toBe(404)
        }
      } finally {
        await context.close()
      }
    }
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
    db.execute('delete from auth.users where id in (%s,%s,%s)',tuple(sys.argv[3:6]))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
