"""Real-session supplier response retries and authority/withdrawal races."""
import time
from uuid import uuid4
import psycopg
import pytest
from test_event_purchase_handoffs_db import approved, purchase, propose, reviewer, SUBMIT as PROPOSE, DECIDE, event_cost, event_delivery, event_supplier, event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker, HANDOFF
from test_supplier_event_publications_db import publication, PUBLISH
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SUBMIT = "select public.supplier_event_response_submit(%s,%s,%s,%s,'received','','')"

@pytest.fixture(params=['handoff','batch'])
def response_source(publication, request):
    purchase, handoff, preview = publication
    source = purchase[0]
    with session(source) as db:
        if request.param == 'handoff':
            pub = db.execute(PUBLISH, (source[1], handoff, preview['fingerprint'])).fetchone()[0]
        else:
            batch = db.execute('select public.event_purchase_handoff_batch_create(%s,%s::uuid[])',(source[1],[handoff])).fetchone()[0]
            fp = db.execute('select public.supplier_event_batch_publication_preview(%s,%s)',(source[1],batch)).fetchone()[0]['fingerprint']
            pub = db.execute('select public.supplier_event_batch_publication_publish(%s,%s,true,%s)',(source[1],batch,fp)).fetchone()[0]
    actor, grant = uuid4(), uuid4()
    with psycopg.connect(source[0]) as db:
        supplier = db.execute('select supplier_id from public.supplier_event_publications where id=%s union all select supplier_id from public.supplier_event_batch_publications where id=%s', (pub,pub)).fetchone()[0]
        email = f'supplier-{actor}@example.com'
        db.execute('insert into auth.users(id,email,email_confirmed_at) values(%s,%s,now())', (actor,email))
        db.execute('insert into public.supplier_portal_grants(id,organization_id,supplier_id,email,user_id,created_by,accepted_at) values(%s,%s,%s,%s,%s,%s,now())', (grant,source[1],supplier,email,actor,source[2]))
    try:
        yield (source[0],source[1],actor,source[3]), grant, pub, supplier, source[2], request.param
    finally:
        with psycopg.connect(source[0]) as db:
            db.execute('delete from auth.users where id=%s', (actor,))

def test_identical_retries_create_one_event(response_source):
    source, grant, pub, _, _, kind = response_source
    args = (grant,kind,pub,uuid4())
    with session(source) as first, session(source) as second:
        assert _race(first,second,SUBMIT,args,args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.supplier_event_responses where publication_id=%s or batch_publication_id=%s',(pub,pub)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where table_name='supplier_event_responses' and organization_id=%s",(source[1],)).fetchone()[0] == 1

def test_distinct_events_have_serial_publication_revisions(response_source):
    source, grant, pub, _, _, kind = response_source
    with session(source) as first, session(source) as second:
        assert _race(first,second,SUBMIT,(grant,kind,pub,uuid4()),(grant,kind,pub,uuid4())).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select revision from public.supplier_event_responses where publication_id=%s or batch_publication_id=%s order by revision',(pub,pub)).fetchall() == [(1,),(2,)]

@pytest.mark.parametrize('retry',[False,True])
@pytest.mark.parametrize('change',['revoke','withdraw','inactive','unconfirmed','deleted'])
def test_current_authority_after_request_lock_wait(response_source,retry,change):
    source, grant, pub, supplier, owner, kind = response_source
    request = uuid4()
    if retry:
        with session(source) as db: db.execute(SUBMIT,(grant,kind,pub,request))
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        key = f'zeespare.event-supplier-response:{source[1]}:{source[2]}:{request}'
        admin.execute('select pg_advisory_xact_lock(hashtextextended(%s,0))',(key,))
        call = _Call(waiting,SUBMIT,(grant,kind,pub,request))
        call.start(); time.sleep(0.3); assert not call.finished
        if change=='revoke': admin.execute('update public.supplier_portal_grants set revoked_at=now(),revoked_by=%s where id=%s',(owner,grant))
        elif change=='withdraw': admin.execute('update public.' + ('supplier_event_publications' if kind=='handoff' else 'supplier_event_batch_publications') + ' set withdrawn_at=now(),withdrawn_by=%s where id=%s',(owner,pub))
        elif change=='inactive': admin.execute('update public.suppliers set is_active=false where id=%s',(supplier,))
        elif change=='unconfirmed': admin.execute('update auth.users set email_confirmed_at=null where id=%s',(source[2],))
        else: admin.execute('delete from public.' + ('supplier_event_publications' if kind=='handoff' else 'supplier_event_batch_publications') + ' where id=%s',(pub,))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ404'

@pytest.mark.parametrize('retry',[False,True])
def test_withdrawal_committed_during_publication_row_wait(response_source,retry):
    source, grant, pub, _, owner, kind = response_source
    request = uuid4()
    if retry:
        with session(source) as db: db.execute(SUBMIT,(grant,kind,pub,request))
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute('select id from public.' + ('supplier_event_publications' if kind=='handoff' else 'supplier_event_batch_publications') + ' where id=%s for update',(pub,))
        call = _Call(waiting,SUBMIT,(grant,kind,pub,request))
        call.start(); time.sleep(0.3); assert not call.finished
        admin.execute('update public.' + ('supplier_event_publications' if kind=='handoff' else 'supplier_event_batch_publications') + ' set withdrawn_at=now(),withdrawn_by=%s where id=%s',(owner,pub))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ404'
