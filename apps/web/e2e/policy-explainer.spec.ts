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
test('policy explainer opts in, previews evidence, saves validated answers and scopes history in both locales', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const seed = randomUUID(),
    password = 'Explain-' + seed,
    email = 'explain-' + seed + '@example.com',
    branchEmail = 'explain-branch-' + seed + '@example.com'
  const owner = await createConfirmedUser(email, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = 'explain-' + seed
  await createOrganization(page, { name: 'Policy explanations', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
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
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
 org,actor,branch=sys.argv[2:5]
 location,run,policy,forecast_run,item=[uuid4() for _ in range(5)]
 db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'AI','Policy branch','branch','SA','Asia/Riyadh')",(location,org))
 db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(org,branch))
 db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(branch,org))
 db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())",(run,org,location,uuid4()))
 period=dict(days=3,forecast='3.001',quantile='4.125',target='4.125',safety_stock='1.124')
 output=dict(status='available',lead_time=period,protection=dict(period,days=7,target='8.125'),residual_count=84,positive_days=90,samples=5000,seed='fixture',calibration=[])
 evidence=dict(method='policy-v1',options=dict(lead_time=3,review_interval=4,service_level='0.95'),forecast=dict(id=str(uuid4()),run_id=str(forecast_run),item_id=str(item),method='expanded-v1',to_date='2026-10-01',horizon=28,output=dict(model='naive',forecast=[]),source=dict(private_email='DO-NOT-SEND@example.com',transactions=['DO-NOT-SEND'])),output=output)
 db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'AI-PART','EA','available',%s,%s)",(policy,org,run,location,uuid4(),item,Jsonb(output),Jsonb(evidence)))
 print(json.dumps(dict(policy=str(policy),location=str(location))))`)
    const { policy, location } = JSON.parse(seeded.stdout) as { policy: string; location: string }
    const explain = `/forecasts/workbench/${policy}/explain`
    await page.goto(explain)
    await expect(page.getByRole('status')).toContainText('owner or admin')
    await expect(page.getByText('DO-NOT-SEND', { exact: false })).toHaveCount(0)
    await page.goto('/settings?section=policy-explainer')
    await page
      .getByRole('checkbox', {
        name: 'Enable Claude policy, forecast, replenishment, supplier and delivery scenario explanations for this organization.',
      })
      .check()
    await page.getByRole('button', { name: 'Save setting', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('AI explanations enabled.')
    await page.goto(explain)
    await page.getByLabel('Your question', { exact: true }).fill('Why this maximum?')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Generate explanation', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    const savedUrl = page.url(),
      saved = savedUrl.split('/').pop()!
    await expect(
      page.getByText('The recorded lead time is three calendar days.', { exact: false }),
    ).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Explanation saved')
    await expect(page.locator('article section p')).toHaveAttribute('dir', 'auto')
    expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false)
    await expect(page.locator('article script')).toHaveCount(0)
    await page
      .getByRole('navigation', { name: 'Evidence for paragraph 1' })
      .getByRole('link')
      .click()
    await expect(page).toHaveURL(/#evidence-policy_inputs$/)
    const client = await signedInClient(email, password)
    const original = await client
      .from('policy_explanations')
      .select('id,evidence,answer,question,request_id,fingerprint')
      .eq('id', saved)
      .single()
    expect(original.error).toBeNull()
    expect(JSON.stringify(original.data?.evidence)).not.toContain('DO-NOT-SEND')
    const retry = await client.rpc('policy_explainer_request', {
      p_organization_id: org,
      p_policy_id: policy,
      p_request_id: original.data!.request_id,
      p_question: 'Why this maximum?',
      p_locale: 'en',
      p_fingerprint: original.data!.fingerprint,
      p_confirmed: true,
    })
    expect(retry.data).toBe(saved)
    const branchContext = await browser.newContext(),
      branchPage = await branchContext.newPage()
    try {
      await signInWithPassword(branchPage, branchEmail, password)
      await branchPage.goto('/forecasts/explanations')
      await expect(branchPage.getByText('No saved explanations are visible.')).toBeVisible()
      await python(
        "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute('insert into public.membership_locations values(%s,%s,%s)',(sys.argv[2],sys.argv[4],sys.argv[5]))",
        location,
      )
      await branchPage.reload()
      await expect(
        branchPage.getByRole('link', { name: 'Why this maximum?', exact: true }),
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
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(`policy-explainer-${locale}-${width}.png`),
          fullPage: true,
        })
        await page.goto(explain)
        await expect(page.getByRole('textbox')).toHaveCSS(
          'font-size',
          width < 768 ? '16px' : '14px',
        )
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.goto('/settings?section=policy-explainer')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
      }
    }
    // Advance only local fixture attempt times to exercise another request without a minute-long sleep.
    const releaseMinute = () =>
      python(
        'import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute("update public.policy_explanations set created_at=now()-interval \'4 minutes\' where organization_id=%s",(sys.argv[2],))',
      )
    await releaseMinute()
    await page.goto(explain)
    await page.getByRole('textbox').fill('Explain the recorded lead time in Arabic.')
    await page.getByRole('checkbox').check()
    await page
      .locator('form')
      .filter({ has: page.getByRole('textbox') })
      .getByRole('button')
      .click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    await expect(page.locator('article')).toContainText('المهلة المحفوظة ثلاثة أيام تقويمية.')
    await releaseMinute()
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
    await page.goto(explain)
    await page.getByRole('textbox').fill('force-invalid-reference')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Generate explanation', exact: true }).click()
    await expect(page).toHaveURL(/\/forecasts\/explanations\/[0-9a-f-]+$/)
    await expect(page.getByRole('status')).toHaveText('Explanation unavailable')
    await expect(page.locator('article nav')).toHaveCount(0)
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(savedUrl).origin }])
    await page.goto('/settings?section=policy-explainer')
    await page
      .getByRole('checkbox', {
        name: 'Enable Claude policy, forecast, replenishment, supplier and delivery scenario explanations for this organization.',
      })
      .uncheck()
    await page.getByRole('button', { name: 'Save setting', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('AI explanations disabled.')
    await page.goto(savedUrl)
    await expect(page.getByRole('status')).toHaveText('Explanation saved')
    await python(
      "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db: db.execute('delete from public.inventory_policies where id=%s',(sys.argv[5],))",
      policy,
    )
    await page.reload()
    await expect(page.getByRole('status')).toHaveText('Explanation saved')
    const final = await client
      .from('policy_explanations')
      .select('answer,evidence')
      .eq('id', saved)
      .single()
    expect(final.data).toEqual({ answer: original.data?.answer, evidence: original.data?.evidence })
    expect(errors).toEqual([])
  } finally {
    await python(
      "import sys,psycopg\nwith psycopg.connect(sys.argv[1]) as db:\n db.execute('delete from public.organizations where id=%s',(sys.argv[2],))\n db.execute('delete from auth.users where id=any(%s::uuid[])',([sys.argv[3],sys.argv[4]],))",
    )
  }
})
