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
import { createOrganization, openSettings } from './helpers/organizations'
import { selectSettingsSection } from './helpers/settings'

test('return reports preserve independent histories, current authority and copied evidence', async ({
  page,
  request,
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
  const otherOrg: string | null = null
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
    const original = await (
      await page.request.get(`/api/dealer-return-batches/${batch}/json`)
    ).json()
    const individual = await (
      await page.request.get(`/api/dealer-return-handoffs/${ids[0]}/json`)
    ).json()
    const branchClient = await signedInClient(branchEmail, password)
    for (const table of ['dealer_return_handoffs', 'dealer_return_batches'] as const)
      expect((await branchClient.from(table).select('id')).data).toEqual([])
    await openSettings(page, 'api-keys')
    const visual = async (lang: string) => {
      const label =
        lang === 'ar'
          ? 'الإبلاغ عن استلام حزمة مرتجعات الوكيل أو رفضها'
          : 'Report dealer-return package receipt or rejection'
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
      for (const width of [375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(page.getByLabel(label, { exact: true })).toBeVisible()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
        const clipped = await page.locator('input[name="scopes"]').evaluateAll((inputs) =>
          inputs.flatMap((input) => {
            const row = input.parentElement!,
              bounds = row.getBoundingClientRect()
            return Array.from(row.querySelectorAll('label,bdi,p')).flatMap((node) => {
              const box = node.getBoundingClientRect()
              return box.left < bounds.left - 1 ||
                box.right > bounds.right + 1 ||
                node.scrollWidth > node.clientWidth + 1
                ? [input.id]
                : []
            })
          }),
        )
        expect(clipped).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(`return-reporter-settings-${lang}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await visual('en')
    const permission = page.getByLabel('Report dealer-return package receipt or rejection', {
      exact: true,
    })
    await expect(permission).not.toBeChecked()
    await permission.focus()
    await page.keyboard.press('Space')
    await expect(permission).toBeChecked()
    await page.getByLabel('Read dealer-return handoffs', { exact: true }).check()
    await page.getByLabel('Key name', { exact: true }).fill('Return reporter')
    await page.getByRole('button', { name: 'Create key', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const headers = { Authorization: `Bearer ${token}` }
    const single = `/api/v1/dealer-return-handoffs/${ids[0]}/acknowledgements`
    const batches = `/api/v1/dealer-return-handoff-batches/${batch}/acknowledgements`
    const body = {
      client_event_id: randomUUID(),
      external_system: 'Returns ERP',
      external_reference: '0000123',
      status: 'received',
    }
    expect((await page.request.post(single, { data: body })).status()).toBe(401)
    const created = await request.post(single, { headers, data: body })
    expect(created.status(), await created.text()).toBe(201)
    expect(created.headers()['cache-control']).toContain('no-store')
    expect(created.headers()['set-cookie']).toBeUndefined()
    const first = await created.json()
    expect(
      (await (await request.get(created.headers().location, { headers })).json()).data,
    ).toEqual(first.data)
    expect((await request.head(created.headers().location, { headers })).status()).toBe(200)
    const retried = await request.post(single, { headers, data: { ...body, reason: null } })
    expect(retried.status()).toBe(200)
    expect(await retried.json()).toEqual({ data: first.data, replayed: true })
    expect((await request.post(batches, { headers, data: body })).status()).toBe(409)
    expect(
      (
        await request.post(batches, {
          headers,
          data: { ...body, client_event_id: randomUUID(), status: 'rejected' },
        })
      ).status(),
    ).toBe(422)
    const rejection = {
      ...body,
      client_event_id: randomUUID(),
      status: 'rejected',
      reason: 'Return reference needs clarification — ' + 'Reference-'.repeat(30),
    }
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(201)
    for (let i = 0; i < 20; i++)
      expect(
        (
          await request.post(batches, {
            headers,
            data: { ...body, client_event_id: randomUUID(), external_reference: `batch-${i}` },
          })
        ).status(),
      ).toBe(201)
    expect((await (await request.get(single, { headers })).json()).data).toHaveLength(1)
    expect(
      (
        await (
          await request.get(`/api/v1/dealer-return-handoffs/${ids[1]}/acknowledgements`, {
            headers,
          })
        ).json()
      ).data,
    ).toEqual([])
    const history = await (await request.get(batches + '?limit=1', { headers })).json()
    expect(history.next_cursor).toBeTruthy()
    expect(
      (
        await request.get(single + '?cursor=' + encodeURIComponent(history.next_cursor), {
          headers,
        })
      ).status(),
    ).toBe(400)
    expect(
      (await branchClient.from('dealer_return_handoff_acknowledgements').select('id')).data,
    ).toEqual([])
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='RET-H'",(sys.argv[5],sys.argv[2]))`)
    expect(
      (await branchClient.from('dealer_return_handoff_acknowledgements').select('id')).data,
    ).toHaveLength(22)
    expect(
      await (await page.request.get(`/api/dealer-return-batches/${batch}/json`)).json(),
    ).toEqual(original)
    expect(
      await (await page.request.get(`/api/dealer-return-handoffs/${ids[0]}/json`)).json(),
    ).toEqual(individual)
    for (const locale of ['en', 'ar']) {
      await page
        .context()
        .addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto('/settings')
      await selectSettingsSection(page, 'api-keys')
      await visual(locale)
      for (const [kind, id] of [
        ['handoffs', ids[0]],
        ['batches', batch],
      ]) {
        await page.goto(`/replenishment/returns/${kind}/${id}`)
        await expect(page.locator('#acknowledgements')).toContainText('Returns ERP')
        for (const width of [375, 768, 1024, 1440, 1920]) {
          await page.setViewportSize({ width, height: 1000 })
          await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true)
          await page.locator('#acknowledgements details').first().locator('summary').focus()
          await page.keyboard.press('Enter')
          await page.screenshot({
            path: testInfo.outputPath(`return-reports-${kind}-${locale}-${width}.png`),
            fullPage: true,
          })
        }
      }
    }
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(`/replenishment/returns/batches/${batch}`)
    await page
      .locator('#acknowledgements')
      .getByRole('link', { name: 'Older reports', exact: true })
      .click()
    await expect(page).toHaveURL(/ack_page=2/)
    await expect(page.locator('#acknowledgements')).toContainText(rejection.reason)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.dealer_return_requests where organization_id=%s',(sys.argv[2],))`)
    expect((await request.get(single, { headers })).status()).toBe(404)
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(200)
    await page.reload()
    await expect(page.locator('#acknowledgements')).toContainText(rejection.reason)
    expect(
      await (await page.request.get(`/api/dealer-return-batches/${batch}/json`)).json(),
    ).toEqual(original)
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('update public.api_keys set revoked_at=clock_timestamp() where organization_id=%s',(sys.argv[2],))`)
    expect((await request.post(batches, { headers, data: rejection })).status()).toBe(401)
    expect((await request.get(batches, { headers })).status()).toBe(401)
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=%s or id=%s',(sys.argv[2],${otherOrg ? JSON.stringify(otherOrg) : 'None'}))
 db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:7],))
 db.execute('delete from public.audit_log where organization_id=%s or organization_id=%s',(sys.argv[2],${otherOrg ? JSON.stringify(otherOrg) : 'None'}))`)
  }
})
