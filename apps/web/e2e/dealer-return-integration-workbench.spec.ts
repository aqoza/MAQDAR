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
import { generateApiKey } from '../src/lib/api/keys'

test('return workbench keeps exact reports, both-location access and copied batches', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(20_000)
  const seed = randomUUID(),
    password = 'ReturnAPI-' + seed,
    email = 'return-api-' + seed + '@example.com',
    reviewerEmail = 'return-review-' + seed + '@example.com',
    branchEmail = 'return-branch-' + seed + '@example.com',
    otherEmail = 'return-other-' + seed + '@example.com'
  const owner = await createConfirmedUser(email, password),
    reviewer = await createConfirmedUser(reviewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password),
    foreign = await createConfirmedUser(otherEmail, password)
  await signInWithPassword(page, email, password)
  const slug = 'return-api-' + seed
  await createOrganization(page, { name: 'Return read API', slug, arabicEnabled: true })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.ZEESPARE_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixtures only')
  const python = (code: string) =>
    promisify(execFile)(
      'uv',
      ['run', 'python', '-c', code, dsn, org, owner, reviewer, branch, foreign],
      {
        cwd: resolve(process.cwd(), '../../engine'),
        timeout: 60_000,
      },
    )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const seeded = await python(`import sys,psycopg,json
from uuid import uuid4
from psycopg.types.json import Jsonb
with psycopg.connect(sys.argv[1]) as db:
 org=sys.argv[2]
 db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'RET-B','Branch','branch','SA','Asia/Riyadh'),(%s,'RET-H','Hub','hub','SA','Asia/Riyadh')",(org,org))
 for code in ['RET-1','RET-2']: db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'Return part','Test','EA',1,'SAR')",(org,code))
 for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
  db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(org,user,role))
  db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,org))
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RET-B'",(sys.argv[5],org))
 ids=[]
 for code,qty,condition in [('RET-1','999999999999999.999','unknown'),('RET-2','0.001','damaged')]:
  db.execute('set local role authenticated')
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
  data=dict(item_code=code,source_code='RET-B',location_code='RET-H',quantity=qty,unit='EA',requested_date='2026-10-24',condition=condition,reason='Declared return',sale_reference='INV-API',confirmed=True)
  parent=db.execute('select public.dealer_return_save(%s,%s,%s)',(org,Jsonb(data),uuid4())).fetchone()[0]
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],role='authenticated')),))
  db.execute("select public.dealer_return_review(%s,%s,'approved','Eligibility assessed',true)",(org,parent))
  db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],role='authenticated')),))
  ids.append(str(db.execute('select public.dealer_return_handoff_create(%s,%s)',(org,parent)).fetchone()[0]))
 batch=db.execute('select public.dealer_return_batch_create(%s,%s::uuid[])',(org,ids)).fetchone()[0]
 print(json.dumps(dict(ids=ids,batch=str(batch))))`)
    const { ids, batch } = JSON.parse(seeded.stdout) as { ids: string[]; batch: string }
    const base = '/replenishment/returns/integrations'
    const ownerClient = await signedInClient(email, password)
    const overlapResult = await ownerClient.rpc('dealer_return_batch_create', {
      p_organization_id: org,
      p_handoff_ids: [ids[0]],
    })
    expect(overlapResult.error).toBeNull()
    const overlap = overlapResult.data as string
    const original = await (
      await page.request.get(`/api/dealer-return-batches/${batch}/json`)
    ).json()
    const originalCsv = await (
      await page.request.get(`/api/dealer-return-batches/${batch}/csv`)
    ).text()
    const key = await generateApiKey()
    expect(
      (
        await ownerClient.rpc('create_api_key', {
          p_organization_id: org,
          p_name: 'Workbench reporter',
          p_scopes: ['dealer_return_handoffs:acknowledge'],
          p_expires_in_days: 30,
          p_key_hash: key.hash,
          p_display_prefix: key.displayPrefix,
          p_last4: key.last4,
        })
      ).error,
    ).toBeNull()
    const report = async (
      system: string,
      reference: string,
      status = 'received',
      reason: string | null = null,
      record = ids[0],
    ) => {
      const resource = [batch, overlap].includes(record)
        ? 'dealer-return-handoff-batches'
        : 'dealer-return-handoffs'
      const response = await request.post(`/api/v1/${resource}/${record}/acknowledgements`, {
        headers: { Authorization: `Bearer ${key.token}` },
        data: {
          client_event_id: randomUUID(),
          external_system: system,
          external_reference: reference,
          status,
          reason,
        },
      })
      expect(response.status(), await response.text()).toBe(201)
    }
    await report('ERP', 'old-ref', 'rejected', 'Old rejection')
    await report('ERP', 'latest-ref')
    await report('erp', 'case-ref', 'rejected', 'Case-sensitive rejection')
    await report(
      ' ERP ',
      'space-ref',
      'rejected',
      'Mapping <script>alert(1)</script> ' + 'X'.repeat(180),
    )
    await report('ERP', 'batch-ref', 'rejected', 'Batch mapping', batch)
    await page.goto('/replenishment/returns')
    await page.getByRole('link', { name: 'Return integrations', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Dealer-return integration workbench',
    )
    const rows = page.getByRole('table').locator('tbody tr')
    await expect(rows).toHaveCount(6)
    await expect(page.getByRole('table').locator('tbody')).not.toContainText('old-ref')
    await expect(page.getByRole('table').locator('tbody')).toContainText(
      '<script>alert(1)</script>',
    )
    const apply = async (expected: Record<string, string>) => {
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === base &&
          Object.entries(expected).every(([k, v]) => url.searchParams.get(k) === v),
      )
    }
    await page.locator('input[name="system"]').fill('ERP')
    await page.locator('select[name="status"]').selectOption('rejected')
    await apply({ system: 'ERP', status: 'rejected' })
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Batch mapping')
    await rows.getByRole('link', { name: 'Open evidence and history' }).click()
    await expect(page).toHaveURL(new RegExp(`/batches/${batch}#acknowledgements`))
    await expect(page.locator('#acknowledgements')).toContainText('Batch mapping')
    await page.goto(base)
    await page.locator('input[name="system"]').fill('Absent')
    await page.locator('select[name="status"]').selectOption('no_report')
    await apply({ system: 'Absent', status: 'no_report' })
    await expect(rows).toHaveCount(4)
    await expect(page.getByRole('table').locator('tbody')).toContainText('No report')
    await page.goto(base)
    await page.locator('input[name="q"]').fill('old-ref')
    await apply({ q: 'old-ref' })
    await expect(rows).toHaveCount(0)
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(rows).toHaveCount(6)
    await page.locator('input[name="source"]').fill('RET-B')
    await page.locator('input[name="location"]').fill('RET-H')
    await page.locator('select[name="sources"]').selectOption('available')
    await apply({ source: 'RET-B', location: 'RET-H', sources: 'available' })
    await expect(rows).toHaveCount(6)
    const branchContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const branchPage = await branchContext.newPage()
      await signInWithPassword(branchPage, branchEmail, password)
      await branchPage.goto(base)
      await expect(branchPage.getByRole('table')).toBeVisible()
      await expect(branchPage.getByRole('table').locator('tbody tr')).toHaveCount(0)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RET-H'",(sys.argv[5],sys.argv[2]))`)
      await branchPage.reload()
      await expect(branchPage.getByRole('table')).toBeVisible()
      await expect(branchPage.getByRole('table').locator('tbody tr')).toHaveCount(6)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select id from public.locations where organization_id=%s and code='RET-B')",(sys.argv[2],sys.argv[5],sys.argv[2]))`)
      await branchPage.reload()
      await expect(branchPage.getByRole('table')).toBeVisible()
      await expect(branchPage.getByRole('table').locator('tbody tr')).toHaveCount(0)
    } finally {
      await branchContext.close()
    }
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto(base)
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        const table = page.getByRole('region').filter({ has: page.locator('table') })
        await table.evaluate((node) => {
          node.scrollLeft = 0
        })
        await table.focus()
        await expect(table).toBeFocused()
        await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight')
        if (await table.evaluate((node) => node.scrollWidth > node.clientWidth)) {
          await expect
            .poll(() => table.evaluate((node) => Math.abs(node.scrollLeft)))
            .toBeGreaterThan(0)
        }
        const details = page.getByRole('table').locator('tbody details').first().locator('summary')
        await details.focus()
        await page.keyboard.press('Enter')
        await expect(details.locator('..')).toHaveAttribute('open', '')
        // Capture the full layout from its normal scroll origin after testing keyboard access.
        await table.evaluate((node) => {
          node.scrollLeft = 0
        })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({
          path: testInfo.outputPath(`return-integrations-${locale}-${width}.png`),
          fullPage: true,
        })
        await page.keyboard.press('Enter')
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    for (let i = 0; i < 30; i++) await report(`System ${i}`, `page-${i}`)
    await page.goto(base + '?system=&source=RET-B&size=25')
    await expect(rows).toHaveCount(25)
    await page.getByRole('link', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(rows).toHaveCount(11)
    expect(new URL(page.url()).searchParams.get('source')).toBe('RET-B')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.dealer_return_requests where organization_id=%s',(sys.argv[2],))`)
    await page.goto(base + '?sources=unavailable')
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('table').locator('tbody')).toContainText('Batch mapping')
    await expect(page.getByRole('table').locator('tbody')).toContainText('No report')
    await page.goto(base + '?sources=unavailable&status=no_report&system=Absent')
    await expect(rows).toHaveCount(2)
    expect(
      await (await page.request.get(`/api/dealer-return-batches/${batch}/json`)).json(),
    ).toEqual(original)
    expect(await (await page.request.get(`/api/dealer-return-batches/${batch}/csv`)).text()).toBe(
      originalCsv,
    )
    expect((await page.request.get(`/replenishment/returns/handoffs/${ids[0]}`)).status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=%s',(sys.argv[2],))
 db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:7],))
 db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
})
