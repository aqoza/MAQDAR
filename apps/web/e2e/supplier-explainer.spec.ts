import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './helpers/auth'
import { createOrganization } from './helpers/organizations'
test('supplier explanations preserve captured rounding, lead times and scoped history at every width', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const seed = randomUUID(),
    password = 'Explain-' + seed,
    email = 'supplier-ai-' + seed + '@example.com',
    branchEmail = 'supplier-ai-branch-' + seed + '@example.com'
  const owner = await createConfirmedUser(email, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = 'supplier-ai-' + seed
  await createOrganization(page, { name: 'Supplier explanations', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug),
    dsn = process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string, ...args: string[]) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, owner, branch, ...args], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 60_000,
    })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
sys.path.insert(0,'tests')
from supplier_explainer_fixture import seed_scenario
with psycopg.connect(sys.argv[1]) as db:
 org,actor,branch=sys.argv[2:5]
 location=uuid4()
 db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'AI','Supplier branch','branch','SA','Asia/Riyadh')",(location,org))
 db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(org,branch))
 db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(branch,org))
 scenario,run=seed_scenario(db,org,actor,location)
 print(json.dumps(dict(scenario=str(scenario),run=str(run),location=str(location))))`)
    const { scenario, run, location } = JSON.parse(seeded.stdout) as {
      scenario: string
      run: string
      location: string
    }
    const explain = `/replenishment/suppliers/explanations/new?scenario=${scenario}`
    await page.goto(`/replenishment/suppliers/${scenario}`)
    await page.getByRole('link', { name: 'Explain supplier rounding', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('owner or admin')
    await page.goto('/settings?section=policy-explainer')
    await page
      .getByRole('checkbox', {
        name: 'Enable Claude policy, forecast, replenishment and supplier scenario explanations for this organization.',
      })
      .check()
    await page.getByRole('button', { name: 'Save setting', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('AI explanations enabled.')
    await page.goto(explain)
    await expect(page.getByText('28.004', { exact: true })).toBeVisible()
    await expect(page.getByText('30.250', { exact: true })).toBeVisible()
    await expect(page.getByText('DO-NOT-SEND', { exact: false })).toHaveCount(0)
    await page.getByLabel('Your question', { exact: true }).fill('Why this rounding?')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Generate explanation', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    const savedUrl = page.url(),
      saved = savedUrl.split('/').pop()!
    await expect(
      page.getByRole('heading', { name: 'Saved supplier scenario explanation', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('The saved rounding uses captured terms, not a current supplier commitment.', {
        exact: false,
      }),
    ).toBeVisible()
    expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false)
    await page
      .getByRole('navigation', { name: 'Evidence for paragraph 1' })
      .getByRole('link', { name: 'Lead-time evidence' })
      .click()
    await expect(page).toHaveURL(/#evidence-lead_time_evidence$/)
    const client = await signedInClient(email, password)
    const original = await client
      .from('policy_explanations')
      .select('request_id,fingerprint,evidence,answer')
      .eq('id', saved)
      .single()
    expect(original.error).toBeNull()
    expect(JSON.stringify(original.data!.evidence)).not.toContain('DO-NOT-SEND')
    const retry = await client.rpc('supplier_explainer_request', {
      p_organization_id: org,
      p_scenario_id: scenario,
      p_request_id: original.data!.request_id,
      p_fingerprint: original.data!.fingerprint,
      p_question: 'Why this rounding?',
      p_locale: 'en',
      p_confirmed: true,
    })
    expect(retry.data).toBe(saved)
    const branchContext = await browser.newContext(),
      branchPage = await branchContext.newPage()
    try {
      await signInWithPassword(branchPage, branchEmail, password)
      await branchPage.goto('/forecasts/explanations')
      await expect(branchPage.getByText('No saved explanations are visible.')).toBeVisible()
      expect((await branchPage.goto(explain))?.status()).toBe(404)
      await python(
        "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[4],sys.argv[5]))",
        location,
      )
      await branchPage.goto('/forecasts/explanations')
      await expect(
        branchPage.getByRole('link', { name: 'Why this rounding?', exact: true }),
      ).toBeVisible()
      await branchPage.goto(explain)
      await expect(branchPage.getByRole('button', { name: 'Generate explanation' })).toHaveCount(0)
    } finally {
      await branchContext.close()
    }
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(savedUrl).origin }])
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 })
        await page.goto(savedUrl)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        await page.locator('#evidence-lead_time_evidence summary').click()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(`supplier-explainer-${locale}-${width}.png`),
          fullPage: true,
        })
        await page.goto(explain)
        await expect(page.getByRole('textbox')).toHaveCSS(
          'font-size',
          width < 768 ? '16px' : '14px',
        )
        await page.getByRole('textbox').focus()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('checkbox')).toBeFocused()
      }
    }
    await python(
      'import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute("update public.policy_explanations set created_at=clock_timestamp()-interval \'4 minutes\' where organization_id=%s",(sys.argv[2],))',
    )
    await page.getByRole('textbox').fill('لماذا توجد هذه الفجوة؟')
    await page.getByRole('checkbox').check()
    await page.getByRole('button').last().click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    await expect(
      page.getByText('يعتمد التقريب المحفوظ على شروط مسجلة وليس التزاماً حالياً من المورد.', {
        exact: false,
      }),
    ).toBeVisible()
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
    await python(
      'import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute("update public.policy_explanations set created_at=clock_timestamp()-interval \'4 minutes\' where organization_id=%s",(sys.argv[2],))',
    )
    await page.goto(explain)
    await page.getByRole('textbox').fill('force-policy-reference')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Generate explanation', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    await expect(page.getByRole('status')).toHaveText('Explanation unavailable')
    const rejected = await client
      .from('policy_explanations')
      .select('status,error_code,answer')
      .eq('id', page.url().split('/').pop()!)
      .single()
    expect(rejected.data).toEqual({
      status: 'failed',
      error_code: 'invalid_response',
      answer: null,
    })
    await client.rpc('policy_explainer_configure', { p_organization_id: org, p_enabled: false })
    await python(
      "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute('delete from public.planning_runs where id=%s',(sys.argv[5],))",
      run,
    )
    await page.goto(savedUrl)
    await expect(page.getByRole('status')).toHaveText('Explanation saved')
    expect(errors).toEqual([])
  } finally {
    await python(
      "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db:\n db.execute('delete from public.organizations where id=%s',(sys.argv[2],))\n db.execute('delete from auth.users where id in (%s,%s)',(sys.argv[3],sys.argv[4]))",
    )
  }
})
