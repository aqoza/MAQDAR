import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import {
  createConfirmedUser,
  organizationIdBySlug,
  signInWithPassword,
  signedInClient,
} from './auth'
import { createOrganization } from './organizations'

export async function seedRegionalHandoffs(page: Page) {
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

  const ids = [first, second]
  const result = await python(`import sys,json,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    batch=db.execute('select public.regional_handoff_batch_create(%s,%s::uuid[])',(sys.argv[2],['${first}','${second}'])).fetchone()[0]
    parent=db.execute('select sourcing_id from public.regional_transfer_proposals where id=%s',('${proposal}',)).fetchone()[0]
    print(json.dumps(dict(batch=str(batch),parent=str(parent))))`)
  const { batch, parent } = JSON.parse(result.stdout.trim()) as { batch: string; parent: string }
  const individualResponse = await page.request.get(`/api/regional-handoffs/${first}/json`)
  expect(individualResponse.status()).toBe(200)
  const individual = await individualResponse.json()
  const originalResponse = await page.request.get(`/api/regional-batches/${batch}/json`)
  expect(originalResponse.status()).toBe(200)
  const original = await originalResponse.json()
  const editorClient = await signedInClient(email, password)
  const approve = async () => {
    await python(`import sys,json,psycopg
from uuid import uuid4
with psycopg.connect(sys.argv[1]) as db:
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[3],org_id=sys.argv[2],role='authenticated')),))
    p=db.execute('select public.regional_transfer_submit(%s,%s,%s,%s)',(sys.argv[2],'${estimate}',uuid4(),'Later regional review')).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=sys.argv[4],org_id=sys.argv[2],role='authenticated')),))
    db.execute('select public.regional_transfer_decide(%s,%s,%s,%s,%s)',(sys.argv[2],p,uuid4(),'approved','Later independent selection'))`)
  }
  const cleanup = async () => {
    await python(`import sys,psycopg
with psycopg.connect(sys.argv[1]) as db:
    db.execute('delete from public.organizations where id=%s or slug=%s',(sys.argv[2],'regional-other-${key}'))
    db.execute('delete from auth.users where id=any(%s::uuid[]) or email=%s',([sys.argv[3],sys.argv[4],sys.argv[5]],'regional-other-${key}@example.com'))
    db.execute('delete from public.audit_log where organization_id=%s',(sys.argv[2],))`)
  }
  return {
    key,
    password,
    branchEmail,
    org,
    parent,
    ids,
    batch,
    original,
    individual,
    editorClient,
    approve,
    python,
    cleanup,
    region,
  }
}
