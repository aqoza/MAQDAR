import { generateApiKey } from '../src/lib/api/keys'
import { expectPageTitle } from './helpers/typography'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './helpers/auth'
import { createOrganization, openSettings } from './helpers/organizations'

test.use({ actionTimeout: 30_000 })

async function expectPermissionTextFits(page: Page) {
  const clipped = await page.locator('input[name="scopes"]').evaluateAll((inputs) =>
    inputs.flatMap((input) => {
      const row = input.parentElement!
      const bounds = row.getBoundingClientRect()
      return Array.from(row.querySelectorAll('label, bdi, p')).flatMap((text) => {
        const rect = text.getBoundingClientRect()
        return rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1 ||
          text.scrollWidth > text.clientWidth + 1
          ? [input.id]
          : []
      })
    }),
  )
  expect(clipped, 'Permission labels, identifiers and help must fit their own grid cell').toEqual(
    [],
  )
}

test('network read API scopes complete evidence and retained batches at five widths and RTL', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(360_000)
  const key = randomUUID()
  const email = `network-${key}@example.com`
  const password = `Network-${key}`
  const user = await createConfirmedUser(email, password)
  const branchEmail = `network-branch-${key}@example.com`
  const branchUser = await createConfirmedUser(branchEmail, password)
  const approverEmail = `network-approver-${key}@example.com`
  const approver = await createConfirmedUser(approverEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `network-${key}`
  await createOrganization(page, { name: `Network ${key}`, slug })
  const org = await organizationIdBySlug(slug)
  const dsn =
    process.env.MAQDAR_TEST_DSN ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname))
    throw new Error('Local fixture only')
  const python = (code: string) =>
    promisify(execFile)('uv', ['run', 'python', '-c', code, dsn, org, user, branchUser], {
      cwd: resolve(process.cwd(), '../../engine'),
      timeout: 100_000,
    })
  const seeded = await python(`
import sys,json,psycopg
from uuid import uuid4
from psycopg.types.json import Jsonb
dsn,org,user,branch_user=sys.argv[1:]
source,first,second,item=[uuid4() for _ in range(4)]
policies=[]
with psycopg.connect(dsn) as db:
    db.execute("update public.organizations set arabic_enabled=true where id=%s",(org,))
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')",(org,branch_user))
    for loc,code,kind,qty in [(source,'WAREHOUSE','central','35.125'),(first,'BRANCH-A','branch','12'),(second,'BRANCH-B','branch','14')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,%s,%s,'SA','Asia/Riyadh')",(loc,org,code,code,kind))
    for loc in [source,first]:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(org,branch_user,loc))
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'NETWORK-ITEM','Network item','Test','EA',1,'SAR')",(item,org))
    evidence={'options':{'lead_time':10,'review_interval':4},'forecast':{'to_date':'2026-10-10','method':'baseline-v1','source':{'unit_provenance':{'method':'source-units-v1','status':'consistent','unit':'EA','rows':1,'unknown_rows':0,'units':['EA']}}}}
    for loc,qty,allocated in [(source,'35.125','2.250'),(first,'12','2'),(second,'100','2')]:
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,%s,1,'SAR','EA')",(org,item,loc,qty,allocated))
        run,policy=uuid4(),uuid4()
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())",(run,org,loc,uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'NETWORK-ITEM','EA','available',%s,%s)",(policy,org,run,loc,uuid4(),item,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
        policies.append(policy)
    for loc in [first,second]:
        db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')",(org,source,loc))
with psycopg.connect(dsn) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    for policy in policies[1:]:
        report=db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(org,policy)).fetchone()[0]
        db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(org,policy,uuid4(),report['fingerprint']))
print(json.dumps(dict(source=str(source),second=str(second))))
`)
  const fixture = JSON.parse(seeded.stdout.trim()) as { source: string; second: string }

  const scheduleSeed = await python(`
import sys,json,psycopg
from uuid import uuid4
dsn,org,user,branch_user=sys.argv[1:]
with psycopg.connect(dsn) as db:
    calendar=db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'NETWORK-DATES','Network dates','SA',array[6,7],true) returning id",(org,)).fetchone()[0]
    db.execute("update public.locations set work_calendar_id=%s where organization_id=%s",(calendar,org))
    source_policy=db.execute("select id from public.inventory_policies where organization_id=%s and location_id=%s",(org,'${fixture.source}')).fetchone()[0]
    drafts=[r[0] for r in db.execute("select id from public.replenishment_drafts where organization_id=%s",(org,)).fetchall()]
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    args=(org,drafts,source_policy)
    report=db.execute("select public.network_allocation_preview(%s,%s,%s,'calculated',null,'4.125',true,true)",args).fetchone()[0]
    parent=db.execute("select public.network_allocation_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)",(*args,uuid4(),report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(parent=str(parent))))
`)
  const { parent } = JSON.parse(scheduleSeed.stdout.trim()) as { parent: string }

  const freightSeed = await python(`
import sys,json,psycopg
from uuid import uuid4
dsn,org,user,branch_user=sys.argv[1:]
with psycopg.connect(dsn) as db:
    db.execute("update public.work_calendars set observe_public_holidays=false where organization_id=%s",(org,))
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=user,org_id=org,role='authenticated')),))
    preview=db.execute("select public.network_date_preview(%s,%s,'2026-10-10',true)",(org,'${parent}')).fetchone()[0]
    scenario=db.execute("select public.network_date_save(%s,%s,'2026-10-10',true,%s,%s)",(org,'${parent}',uuid4(),preview['fingerprint'])).fetchone()[0]
with psycopg.connect(dsn) as db:
    db.execute("update public.network_links n set freight_basis='per_unit',freight_cost=1.235,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-12' from public.locations l where n.to_location_id=l.id and n.organization_id=%s and l.code='BRANCH-A'",(org,))
    db.execute("update public.network_links n set freight_basis='per_shipment',freight_cost=8.765,currency='KWD',freight_valid_from='2026-10-12' from public.locations l where n.to_location_id=l.id and n.organization_id=%s and l.code='BRANCH-B'",(org,))
print(json.dumps(dict(scenario=str(scenario))))
`)
  const { scenario } = JSON.parse(freightSeed.stdout.trim()) as { scenario: string }

  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')",(sys.argv[2],'${approver}'))`)
  const saveEstimate = async (dateScenario = scenario) => {
    const result = await python(`import sys,psycopg
from uuid import uuid4
import json
with psycopg.connect(sys.argv[1]) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    report=db.execute("select public.network_freight_preview(%s,%s,true)",(sys.argv[2],'${dateScenario}')).fetchone()[0]
    saved=db.execute("select public.network_freight_save(%s,%s,true,%s,%s)",(sys.argv[2],'${dateScenario}',uuid4(),report['fingerprint'])).fetchone()[0]
print(saved)`)
    return result.stdout.trim()
  }

  const estimate = await saveEstimate()
  const approve = async () => {
    const result = await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    proposal=db.execute("select public.network_transfer_submit(%s,%s,%s,'Network handoff evidence')",(sys.argv[2],'${estimate}',uuid4())).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub='${approver}',org_id=sys.argv[2],role='authenticated')),))
    db.execute("select public.network_transfer_decide(%s,%s,%s,'approved','Every branch reviewed')",(sys.argv[2],proposal,uuid4()))
print(proposal)`)
    return result.stdout.trim()
  }

  const proposal = await approve()
  const editorClient = await signedInClient(email, password)
  const exported = await editorClient.rpc('network_handoff_create', {
    p_organization_id: org,
    p_proposal_id: proposal,
  })
  expect(exported.error).toBeNull()
  const handoff = exported.data as string
  const extra = await python(`import sys,json
from uuid import UUID
sys.path.insert(0,'tests')
from test_network_batches_db import make_item_handoff
import psycopg
source=(sys.argv[1],UUID(sys.argv[2]),UUID(sys.argv[3]),None)
with psycopg.connect(sys.argv[1]) as db:
    template=db.execute("select payload from public.network_transfer_handoffs where id=%s",('${handoff}',)).fetchone()[0]
transfer=(source,None,None,[UUID('${approver}')])
second=make_item_handoff(transfer,template,'NETWORK-SECOND')
third=make_item_handoff(transfer,template,'NETWORK-THIRD')
print(json.dumps(dict(second=str(second),third=str(third))))`)
  const { second, third } = JSON.parse(extra.stdout) as { second: string; third: string }
  const ids = [handoff, second, third]
  const savedBatch = await editorClient.rpc('network_handoff_batch_create', {
    p_organization_id: org,
    p_handoff_ids: ids.slice(0, 2),
  })
  expect(savedBatch.error).toBeNull()
  const batch = savedBatch.data as string
  const original = await (await page.request.get(`/api/network-batches/${batch}/json`)).json()
  const individual = await (await page.request.get(`/api/network-handoffs/${handoff}/json`)).json()
  expect(
    individual.estimate.lines.find(
      (line: { status: string }) => line.status === 'no_transfer_needed',
    ).quantity,
  ).toBe('0.000')
  const branchClient = await signedInClient(branchEmail, password)
  expect((await branchClient.from('network_transfer_handoffs').select('id')).data).toEqual([])
  expect((await branchClient.from('network_handoff_batches').select('id')).data).toEqual([])
  await openSettings(page, 'api-keys')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByLabel('Read network handoffs', { exact: true })).toBeVisible()
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByLabel('Read network handoffs', { exact: true })).toBeVisible()
    await expectPermissionTextFits(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await expectPageTitle(page.getByRole('heading', { level: 1 }))
    await page.screenshot({
      path: testInfo.outputPath(`network-api-settings-${width}.png`),
      fullPage: true,
    })
  }
  await expect(page.getByLabel('Read network handoffs', { exact: true })).not.toBeChecked()
  await page.getByLabel('Read network handoffs', { exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByLabel('Read network handoffs', { exact: true })).toBeChecked()
  await page.keyboard.press('Space')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByLabel('Key name', { exact: true }).fill('Handoff reader')
  await page.getByLabel('Read network handoffs', { exact: true }).check()
  await expect(
    page.getByText(
      'Read saved network handoffs and batches across the whole organization, including every branch and retained evidence after source deletion. Does not reserve stock or execute transfers.',
      { exact: true },
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create key', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const token = await dialog.getByLabel('API key', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const headers = { Authorization: `Bearer ${token}` }
  const api = '/api/v1/network-handoffs'
  const batches = '/api/v1/network-handoff-batches'
  expect((await page.request.get(api)).status()).toBe(401) // Browser cookies are not credentials.
  expect((await request.get('/api/v1/items', { headers })).status()).toBe(403)
  for (const path of [
    '/api/v1/purchase-handoffs',
    '/api/v1/transfer-handoffs',
    '/api/v1/event-purchase-handoffs',
  ]) {
    expect((await request.get(path, { headers })).status()).toBe(403)
  }
  for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`]) {
    expect((await request.get(`${path}/acknowledgements`, { headers })).status()).toBe(404)
    expect((await request.post(`${path}/acknowledgements`, { headers, data: {} })).status()).toBe(
      404,
    )
  }
  const orgResponse = await request.get('/api/v1/organization', { headers })
  expect((await orgResponse.json()).key.scopes).toEqual(['network_handoffs:read'])

  const traversed: string[] = []
  let cursor: string | null = null
  let asOf: string | null = null
  do {
    const response: APIResponse = await request.get(api, {
      headers,
      params: { limit: 1, ...(cursor ? { cursor } : {}) },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body: {
      data: { id: string; payload?: unknown; current: { selection: string } }[]
      as_of: string
      next_cursor: string | null
    } = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].payload).toBeUndefined()
    expect(body.data[0].current.selection).toBe('current')
    if (asOf) expect(body.as_of).toBe(asOf)
    asOf = body.as_of
    cursor = body.next_cursor
    traversed.push(body.data[0].id)
    expect(traversed.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(traversed.sort()).toEqual([...ids].sort())
  const fetched = await request.get(`${api}/${ids[0]}`, { headers })
  expect(fetched.status()).toBe(200)
  expect(fetched.headers()['cache-control']).toContain('no-store')
  expect(fetched.headers()['set-cookie']).toBeUndefined()
  expect((await fetched.json()).data.payload).toEqual(individual)
  const batchResponse = await request.get(`${batches}/${batch}`, { headers })
  const batchData = (await batchResponse.json()).data
  expect(batchData.payload).toEqual(original)
  expect(batchData.summary).toMatchObject({
    source_code: 'WAREHOUSE',
    dispatch_date: '2026-10-12',
    handoff_count: 2,
    branch_row_count: 4,
    item_code: null,
    totals: original.summary.totals,
  })
  expect(batchData.summary.handoff_ids).toEqual([ids[0], ids[1]].sort())
  expect(batchData.current.selection).toBe('current')
  const head = await request.head(`${batches}/${batch}`, { headers })
  expect(head.status()).toBe(200)
  expect(await head.text()).toBe('')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await request.fetch(`${api}/${ids[0]}`, { method, headers })).status()).toBe(405)
  }
  expect((await request.get(`${api}?selected=true`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}?cursor=broken`, { headers })).status()).toBe(400)
  expect((await request.get(`${api}/${randomUUID()}`, { headers })).status()).toBe(404)

  // A valid key of another organization cannot enumerate or fetch these records.
  const otherEmail = `network-other-${key}@example.com`
  await createConfirmedUser(otherEmail, password)
  const other = await signedInClient(otherEmail, password)
  const { data: otherOrg, error: orgError } = await other.rpc('create_organization', {
    p_name: 'Other API tenant',
    p_slug: `network-other-${key}`,
    p_base_currency: 'SAR',
    p_home_country: 'SA',
    p_arabic_enabled: false,
  })
  expect(orgError).toBeNull()
  const otherKey = await generateApiKey()
  const { error: keyError } = await other.rpc('create_api_key', {
    p_organization_id: otherOrg,
    p_name: 'Other reader',
    p_scopes: ['network_handoffs:read'],
    p_expires_in_days: 30,
    p_key_hash: otherKey.hash,
    p_display_prefix: otherKey.displayPrefix,
    p_last4: otherKey.last4,
  })
  expect(keyError).toBeNull()
  const otherHeaders = { Authorization: `Bearer ${otherKey.token}` }
  for (const path of [api, batches])
    expect((await (await request.get(path, { headers: otherHeaders })).json()).data).toEqual([])
  for (const path of [`${api}/${ids[0]}`, `${batches}/${batch}`])
    expect((await request.get(path, { headers: otherHeaders })).status()).toBe(404)

  // A key carrying every older permission still gets no network access.
  const legacy = await generateApiKey()
  const legacyScopes = [
    'master_data:read',
    'master_data:write',
    'transactions:read',
    'transactions:write',
    'purchase_handoffs:read',
    'purchase_handoffs:acknowledge',
    'transfer_handoffs:read',
    'transfer_handoffs:acknowledge',
    'event_purchase_handoffs:read',
    'event_purchase_handoffs:acknowledge',
    'excess_disposition_handoffs:read',
    'excess_disposition_handoffs:acknowledge',
  ]
  const legacyResult = await editorClient.rpc('create_api_key', {
    p_organization_id: org,
    p_name: 'Existing permissions',
    p_scopes: legacyScopes,
    p_expires_in_days: 30,
    p_key_hash: legacy.hash,
    p_display_prefix: legacy.displayPrefix,
    p_last4: legacy.last4,
  })
  expect(legacyResult.error).toBeNull()
  for (const path of [api, `${api}/${ids[0]}`, batches, `${batches}/${batch}`])
    expect(
      (await request.get(path, { headers: { Authorization: `Bearer ${legacy.token}` } })).status(),
    ).toBe(403)
  await approve()
  for (const [path, saved] of [
    [`${api}/${ids[0]}`, individual],
    [`${batches}/${batch}`, original],
  ] as const) {
    const body = await (await request.get(path, { headers })).json()
    expect(body.data.current.selection).toBe('historical')
    expect(body.data.payload).toEqual(saved)
  }
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.network_allocation_scenarios where organization_id=%s and id=%s',(sys.argv[2],'${parent}'))`)
  expect((await request.get(`${api}/${ids[0]}`, { headers })).status()).toBe(404)
  const retained = await (await request.get(`${batches}/${batch}`, { headers })).json()
  expect(retained.data.current.selection).toBe('unavailable')
  expect(retained.data.payload).toEqual(original)
  expect(retained.data.summary.totals).toEqual(original.summary.totals)
  const listed = await (await request.get(batches, { headers })).json()
  expect(listed.data[0].id).toBe(batch)
  expect(listed.data[0].current.selection).toBe('unavailable')
  expect(await (await page.request.get(`/api/network-batches/${batch}/json`)).json()).toEqual(
    original,
  )
  const row = page.getByRole('row').filter({ hasText: 'Handoff reader' })
  await row.getByRole('button', { name: 'Revoke Handoff reader', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(row).toContainText('Revoked')
  expect((await request.get(`${batches}/${batch}`, { headers })).status()).toBe(401)
  await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('update public.organizations set arabic_enabled=true where id=%s',(sys.argv[2],))`)
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'ar', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const width of [375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByLabel('قراءة تسليمات الشبكة', { exact: true })).toBeVisible()
    await expectPermissionTextFits(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`network-api-settings-rtl-${width}.png`),
      fullPage: true,
    })
  }
  expect(errors).toEqual([])
})
