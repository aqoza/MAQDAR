import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type APIResponse } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './helpers/auth'
import { createOrganization, openSettings } from './helpers/organizations'
import { generateApiKey } from '../src/lib/api/keys'
import { API_SCOPES } from '../src/lib/api/auth'

test('return read API preserves authorizations, scopes access and retains copied batches', async ({
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
  let otherOrg: string | null = null
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
      const label = lang === 'ar' ? 'قراءة تسليمات مرتجعات الوكلاء' : 'Read dealer-return handoffs'
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
          path: testInfo.outputPath(`return-api-settings-${lang}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await visual('en')
    const permission = page.getByLabel('Read dealer-return handoffs', { exact: true })
    await expect(permission).not.toBeChecked()
    await permission.focus()
    await page.keyboard.press('Space')
    await expect(permission).toBeChecked()
    await page.keyboard.press('Space')
    await page.getByLabel('Key name', { exact: true }).fill('Return reader')
    await permission.check()
    await page.getByRole('button', { name: 'Create key', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const headers = { Authorization: `Bearer ${token}` },
      api = '/api/v1/dealer-return-handoffs',
      batches = '/api/v1/dealer-return-handoff-batches'
    expect((await page.request.get(api)).status()).toBe(401)
    expect((await request.get('/api/v1/items', { headers })).status()).toBe(403)
    for (const path of [
      'purchase-handoffs',
      'transfer-handoffs',
      'event-purchase-handoffs',
      'excess-disposition-handoffs',
      'network-handoffs',
      'regional-handoffs',
    ])
      expect((await request.get('/api/v1/' + path, { headers })).status()).toBe(403)
    const traversed: string[] = []
    let cursor: string | null = null,
      asOf: string | null = null
    do {
      const response: APIResponse = await request.get(api, {
        headers,
        params: { limit: 1, ...(cursor ? { cursor } : {}) },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].payload).toBeUndefined()
      expect(body.data[0].current.sources_available).toBe(true)
      if (asOf) expect(body.as_of).toBe(asOf)
      asOf = body.as_of
      cursor = body.next_cursor
      traversed.push(body.data[0].id)
      expect(traversed.length).toBeLessThanOrEqual(2)
    } while (cursor)
    expect(traversed.sort()).toEqual([...ids].sort())
    for (const [path, saved] of [
      [`${api}/${ids[0]}`, individual],
      [`${batches}/${batch}`, original],
    ] as const) {
      const response = await request.get(path, { headers })
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toContain('no-store')
      expect(response.headers()['set-cookie']).toBeUndefined()
      expect((await response.json()).data.payload).toEqual(saved)
      const head = await request.head(path, { headers })
      expect(head.status()).toBe(200)
      expect(await head.text()).toBe('')
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
        expect((await request.fetch(path, { method, headers })).status()).toBe(405)
      for (const method of ['GET', 'POST'])
        expect(
          (await request.fetch(path + '/acknowledgements', { method, headers })).status(),
        ).toBe(404)
    }
    for (const query of [
      '?limit=101',
      '?limit=1&limit=2',
      '?cursor=broken',
      '?created_since=2026-10-24',
      '?selected=true',
    ])
      expect((await request.get(api + query, { headers })).status()).toBe(400)
    expect((await request.get(`${api}/${randomUUID()}`, { headers })).status()).toBe(404)
    const ownerClient = await signedInClient(email, password),
      otherClient = await signedInClient(otherEmail, password)
    const created = await otherClient.rpc('create_organization', {
      p_name: 'Other return tenant',
      p_slug: 'return-other-' + seed,
      p_base_currency: 'SAR',
      p_home_country: 'SA',
      p_arabic_enabled: false,
    })
    expect(created.error).toBeNull()
    otherOrg = created.data
    for (const [client, organization, scopes, status] of [
      [otherClient, otherOrg, ['dealer_return_handoffs:read'], 404],
      [ownerClient, org, API_SCOPES.filter((s) => s !== 'dealer_return_handoffs:read'), 403],
    ] as const) {
      const key = await generateApiKey()
      const issued = await client.rpc('create_api_key', {
        p_organization_id: organization!,
        p_name: 'Scope check',
        p_scopes: [...scopes],
        p_expires_in_days: 30,
        p_key_hash: key.hash,
        p_display_prefix: key.displayPrefix,
        p_last4: key.last4,
      })
      expect(issued.error).toBeNull()
      const scopedHeaders = { Authorization: `Bearer ${key.token}` }
      for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`])
        expect((await request.get(path, { headers: scopedHeaders })).status()).toBe(status)
      if (status === 404)
        for (const path of [api, batches])
          expect((await (await request.get(path, { headers: scopedHeaders })).json()).data).toEqual(
            [],
          )
    }
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.items where organization_id=%s',(sys.argv[2],))
 db.execute('delete from public.dealer_return_requests where organization_id=%s',(sys.argv[2],))`)
    expect((await request.get(`${api}/${ids[0]}`, { headers })).status()).toBe(404)
    const retained = await (await request.get(`${batches}/${batch}`, { headers })).json()
    expect(retained.data.payload).toEqual(original)
    expect(retained.data.current.sources_available).toBe(false)
    expect(
      (await (await request.get(batches, { headers })).json()).data[0].current.sources_available,
    ).toBe(false)
    expect(
      await (await page.request.get(`/api/dealer-return-batches/${batch}/json`)).json(),
    ).toEqual(original)
    const row = page.getByRole('row').filter({ hasText: 'Return reader' })
    await row.getByRole('button', { name: 'Revoke Return reader', exact: true }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Revoke key', exact: true })
      .click()
    await expect(row).toContainText('Revoked')
    expect((await request.get(`${batches}/${batch}`, { headers })).status()).toBe(401)
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
    await page.reload()
    await visual('ar')
    expect(errors).toEqual([])
  } finally {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
 db.execute('delete from public.organizations where id=%s or id=%s',(sys.argv[2],${otherOrg ? JSON.stringify(otherOrg) : 'None'}))
 db.execute('delete from auth.users where id=any(%s::uuid[])',(sys.argv[3:7],))
 db.execute('delete from public.audit_log where organization_id=%s or organization_id=%s',(sys.argv[2],${otherOrg ? JSON.stringify(otherOrg) : 'None'}))`)
  }
})
