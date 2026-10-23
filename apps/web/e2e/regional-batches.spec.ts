import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createConfirmedUser, organizationIdBySlug, signInWithPassword } from './helpers/auth'
import { createOrganization } from './helpers/organizations'

test('regional batches retain complete handoffs, overlaps, copied files and all-location access', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  page.setDefaultTimeout(15_000)
  const key = randomUUID(),
    password = `Sourcing-${key}`,
    email = `regional-batches-${key}@example.com`
  const owner = await createConfirmedUser(email, password)
  const viewerEmail = `regional-batches-viewer-${key}@example.com`,
    branchEmail = `regional-batches-branch-${key}@example.com`
  const viewer = await createConfirmedUser(viewerEmail, password),
    branch = await createConfirmedUser(branchEmail, password)
  await signInWithPassword(page, email, password)
  const slug = `regional-batches-${key}`
  await createOrganization(page, { name: 'Regional freight', slug, arabicEnabled: true })
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
  const sourcingRoot = '/replenishment/regional-stock/sourcing'
  const root = `${sourcingRoot}/batches`
  async function visual(kind: string, lang: string, screen = page) {
    await expect(screen.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await screen.setViewportSize({ width, height: 1000 })
      expect(
        await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(screen.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px')
      const value = screen.locator('.text-evidence-value').first()
      if (await value.count()) await expect(value).toHaveCSS('font-size', '14px')
      await screen.screenshot({
        path: testInfo.outputPath(`regional-batches-${kind}-${lang}-${width}.png`),
        fullPage: true,
      })
    }
  }
  async function locale(value: string) {
    await page.context().addCookies([{ name: 'locale', value, url: new URL(page.url()).origin }])
    await page.reload()
  }
  try {
    const seeded = await python(`import sys,json,psycopg
from uuid import uuid4
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'tests')
from regional_freight_fixture import seed_regional_freight
with psycopg.connect(sys.argv[1]) as db:
    parent,report=seed_regional_freight(db,sys.argv[2],sys.argv[3],policy_lead=10,source_a_quantity='22')
    db.execute('set local role authenticated')
    estimate=db.execute('select public.regional_freight_save(%s,%s,true,%s,%s)',(sys.argv[2],parent,uuid4(),report['fingerprint'])).fetchone()[0]
    proposal=db.execute('select public.regional_transfer_submit(%s,%s,%s,%s)',(sys.argv[2],estimate,uuid4(),'Approved regional exports')).fetchone()[0]
    db.execute('reset role')
    for user,role in [(sys.argv[4],'approver'),(sys.argv[5],'branch_user')]:
        db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',(sys.argv[2],user,role))
        db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)',(user,sys.argv[2]))
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code<>'SOURCE-A'",(sys.argv[5],sys.argv[2]))
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.regional_transfer_decide(%s,%s,%s,%s,%s)',(sys.argv[2],proposal,uuid4(),'approved','Independent regional approval'))
    print(json.dumps(dict(proposal=str(proposal),estimate=str(estimate),region=report['source']['source']['region']['id'])))`)
    const { proposal, estimate, region } = JSON.parse(seeded.stdout.trim()) as {
      proposal: string
      estimate: string
      region: string
    }
    const handoffs = await python(`import sys,json,psycopg
from uuid import UUID
sys.path.insert(0,'tests')
from test_regional_batches_db import make_item_handoff
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    first=db.execute('select public.regional_handoff_create(%s,%s)',(sys.argv[2],'${proposal}')).fetchone()[0]
    template=db.execute('select payload from public.regional_transfer_handoffs where id=%s',(first,)).fetchone()[0]
transfer=((sys.argv[1],UUID(sys.argv[2]),UUID(sys.argv[3]),None),UUID('${estimate}'),None,[UUID(sys.argv[4])])
second=make_item_handoff(transfer,template,code='SECOND-PART')
print(json.dumps(dict(first=str(first),second=str(second))))`)
    const { first, second } = JSON.parse(handoffs.stdout.trim()) as {
      first: string
      second: string
    }
    await page.goto(`${root}/new`)
    await visual('select', 'en')
    await locale('ar')
    await visual('select', 'ar')
    await locale('en')
    const check = page.getByRole('checkbox', { name: 'Select REG-P', exact: true })
    await check.focus()
    await page.keyboard.press('Space')
    await page.getByRole('checkbox', { name: 'Select SECOND-PART', exact: true }).check()
    await page.getByRole('button', { name: 'Add checked lines', exact: true }).click()
    await page.getByRole('link', { name: 'Preview batch', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Preview batch', exact: true })).toBeVisible()
    await visual('preview', 'en')
    await locale('ar')
    await visual('preview', 'ar')
    await locale('en')
    await page.getByRole('button', { name: 'Save batch', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`))
    const detail = page.url(),
      batch = detail.split('/').at(-1)!
    await expect(
      page.getByRole('region', { name: 'Current context', exact: true }).getByRole('status'),
    ).toHaveText('All approvals selected')
    const jsonUrl = `/api/regional-batches/${batch}/json`,
      csvUrl = `/api/regional-batches/${batch}/csv`
    const original = await page.request.get(jsonUrl),
      csv = await page.request.get(csvUrl)
    expect(original.status()).toBe(200)
    expect(csv.status()).toBe(200)
    expect(original.headers()['cache-control']).toBe('private, no-store')
    const jsonBytes = await original.body(),
      csvBytes = await csv.body(),
      payload = JSON.parse(jsonBytes.toString())
    expect(payload.schema_version).toBe('regional-handoff-batch-v1')
    expect(payload.lines).toHaveLength(2)
    expect(payload.item_identities).toHaveLength(2)
    expect(payload.summary.source_row_count).toBe(4)
    expect(payload.summary.totals).toEqual([{ currency: 'KWD', minor_units: 3, subtotal: '4.690' }])
    expect(
      payload.lines.every((h: { estimate: { lines: { status: string }[] } }) =>
        h.estimate.lines.some((l) => l.status === 'no_transfer_needed'),
      ),
    ).toBe(true)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download CSV', exact: true }).focus()
    await page.keyboard.press('Enter')
    expect((await downloadPromise).suggestedFilename()).toBe(`regional-handoff-batch-${batch}.csv`)
    await visual('detail', 'en')
    await locale('ar')
    await visual('detail', 'ar')
    await locale('en')
    // Exact-set retry and visible subset overlap.
    await page.goto(`${root}/preview?handoff=${second}&handoff=${first}`)
    await expect(
      page.getByRole('link', { name: 'Open existing batch', exact: true }),
    ).toHaveAttribute('href', `${root}/${batch}`)
    await page.goto(`${root}/preview?handoff=${first}`)
    await page.getByRole('button', { name: 'Save batch', exact: true }).click()
    await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`))
    await expect(
      page.getByRole('region', { name: 'Other batches containing these lines', exact: true }),
    ).toContainText('1 other batch')
    await page.goto(root)
    await page
      .getByRole('textbox', { name: 'Search item, region or location', exact: true })
      .fill('Northern')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await page.setViewportSize({ width: 375, height: 1000 })
    const table = page.getByRole('region', { name: 'Regional handoff batches', exact: true })
    await table.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await table.evaluate((el) => {
      el.scrollLeft = 0
    })
    await visual('history', 'en')
    await locale('ar')
    await visual('history', 'ar')
    await locale('en')
    await page
      .getByRole('textbox', { name: 'Search item, region or location', exact: true })
      .fill('not-present')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0)
    await page.getByRole('link', { name: 'Reset', exact: true }).click()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    // A later approval changes live selection; archive cannot alter original files.
    await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    new=db.execute('select public.regional_transfer_submit(%s,%s,%s,%s)',(sys.argv[2],'${estimate}',uuid4(),'Later regional proposal')).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.regional_transfer_decide(%s,%s,%s,%s,%s)',(sys.argv[2],new,uuid4(),'approved','Later approval'))
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.stock_region_archive(%s,%s)',(sys.argv[2],'${region}'))`)
    expect((await page.goto(detail))?.status()).toBe(200)
    await expect(
      page.getByRole('region', { name: 'Current context', exact: true }).getByRole('status'),
    ).toHaveText('Contains historical approvals')
    expect(await (await page.request.get(jsonUrl)).body()).toEqual(jsonBytes)
    expect(await (await page.request.get(csvUrl)).body()).toEqual(csvBytes)
    await visual('historical', 'en')
    await locale('ar')
    await visual('historical', 'ar')
    await locale('en')
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.regional_transfer_handoffs where id=%s',('${first}',))`)
    expect((await page.goto(detail))?.status()).toBe(200)
    await expect(
      page.getByRole('region', { name: 'Current context', exact: true }).getByRole('status'),
    ).toHaveText('Source context unavailable')
    expect(await (await page.request.get(jsonUrl)).body()).toEqual(jsonBytes)
    expect(await (await page.request.get(csvUrl)).body()).toEqual(csvBytes)
    await visual('unavailable', 'en')
    await locale('ar')
    await visual('unavailable', 'ar')
    await locale('en')
    await page.goto(`${root}?selection=unavailable&q=Northern`)
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    expect((await page.goto(`${root}/${randomUUID()}`))?.status()).toBe(404)
    expect((await page.goto(`${root}/bad`))?.status()).toBe(404)
    const scopedContext = await browser.newContext({ baseURL: new URL(detail).origin })
    try {
      const scoped = await scopedContext.newPage()
      await signInWithPassword(scoped, branchEmail, password)
      expect((await scoped.goto(detail))?.status()).toBe(404)
      for (const url of [jsonUrl, csvUrl])
        expect((await scoped.request.get(url)).status()).toBe(404)
      await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='SOURCE-A'",(sys.argv[5],sys.argv[2]))`)
      expect((await scoped.goto(detail))?.status()).toBe(200)
      expect(await (await scoped.request.get(jsonUrl)).body()).toEqual(jsonBytes)
      await scoped.goto(root)
      await expect(
        scoped.getByRole('link', { name: 'Choose batch lines', exact: true }),
      ).toHaveCount(0)
    } finally {
      await scopedContext.close()
    }
    const anonymous = await browser.newContext()
    try {
      expect((await anonymous.request.get(new URL(jsonUrl, detail).href)).status()).toBe(401)
    } finally {
      await anonymous.close()
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
