"""Local event batch publications through independently approved planning chains."""
from supplier_event_fixture import seed_supplier_event

LINE_SQL = r"""
create function pg_temp.line(n integer,u text default 'EA',duplicate boolean default false,quote_price numeric default 1.234,quote_currency text default 'SAR') returns uuid language plpgsql as $$
declare item uuid:=case when duplicate then pg_temp.id(60) else pg_temp.id(10000+n) end;
  forecast uuid:=pg_temp.id(40000+n); policy uuid:=pg_temp.id(30000+n);
  event uuid; scenario uuid; draft uuid; supplier uuid; delivery uuid; estimate uuid; proposal uuid; report jsonb;
  fe jsonb; pe jsonb; code text:=case when duplicate then 'ITEM' else 'ITEM-'||n end;
begin
  perform pg_temp.login(10,1);
  if n=0 then estimate:=(select estimate_id from review_fixture);
  else
    if not duplicate then
      insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
        values(item,pg_temp.id(1),code,'Item','Test',u,1,'SAR');
      insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
        values(pg_temp.id(1),item,pg_temp.id(20),'2026-10-10',2.001,1.001,1,'SAR',u);
      insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
        values(pg_temp.id(1),pg_temp.id(200),item,1,2,1.5,quote_price,quote_currency,u,'2026-10-10');
    end if;
    insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
      select pg_temp.id(50000+n),organization_id,location_id,gen_random_uuid(),from_date,to_date,kind,status,options,finished_at,result
      from public.planning_runs where id=pg_temp.id(30);
    select replace(evidence::text,'"EA"',to_jsonb(u)::text)::jsonb into fe from public.forecast_results where id=pg_temp.id(50);
    insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
      select forecast,organization_id,pg_temp.id(50000+n),location_id,item,code,item_name,status,model,summary,fe
      from public.forecast_results where id=pg_temp.id(50);
    insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
      select pg_temp.id(20000+n),organization_id,location_id,gen_random_uuid(),from_date,to_date,kind,status,jsonb_set(options,'{forecast_id}',to_jsonb(forecast)),finished_at,result
      from public.planning_runs where id=pg_temp.id(100);
    select replace(replace(replace(replace(evidence::text,pg_temp.id(50)::text,forecast::text),pg_temp.id(30)::text,pg_temp.id(50000+n)::text),pg_temp.id(60)::text,item::text),'"EA"',to_jsonb(u)::text)::jsonb into pe
      from public.inventory_policies where id=pg_temp.id(120);
    insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
      select policy,organization_id,pg_temp.id(20000+n),location_id,forecast,item,code,u,status,summary,pe
      from public.inventory_policies where id=pg_temp.id(120);
    report:=public.planned_event_preview(pg_temp.id(1),forecast,'campaign','Launch '||n,'Additional demand',u,'[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true);
    event:=public.planned_event_save(pg_temp.id(1),forecast,'campaign','Launch '||n,'Additional demand',u,'[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_policy_preview(pg_temp.id(1),event,policy,'Fixed event');
    scenario:=public.event_policy_save(pg_temp.id(1),event,policy,'Fixed event',gen_random_uuid(),report->>'fingerprint');
    report:=public.event_replenishment_preview(pg_temp.id(1),scenario,'0.002',true,true);
    draft:=public.event_replenishment_save(pg_temp.id(1),scenario,'0.002',true,true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_supplier_preview(pg_temp.id(1),draft,'SUP',true);
    supplier:=public.event_supplier_save(pg_temp.id(1),draft,'SUP',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_delivery_preview(pg_temp.id(1),supplier,'2026-10-10',true);
    delivery:=public.event_delivery_save(pg_temp.id(1),supplier,'2026-10-10',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_purchase_cost_preview(pg_temp.id(1),delivery,true);
    estimate:=public.event_purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),report->>'fingerprint');
  end if;
  proposal:=public.event_purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Reason');
  perform pg_temp.login(15,1);
  perform public.event_purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(10,1);
  return public.event_purchase_handoff_create(pg_temp.id(1),proposal);
end; $$;
"""

def seed_supplier_event_batch(db, owner, prefix):
    org, other, handoff, supplier = seed_supplier_event(db, owner, prefix)
    db.execute(LINE_SQL)
    second = db.execute("select pg_temp.line(1,'KG')").fetchone()[0]
    third = db.execute("select pg_temp.line(2)").fetchone()[0]
    db.execute('set local role authenticated')
    batch = db.execute('select public.event_purchase_handoff_batch_create(%s,%s::uuid[])',(org,[handoff,second])).fetchone()[0]
    overlap = db.execute('select public.event_purchase_handoff_batch_create(%s,%s::uuid[])',(org,[second,third])).fetchone()[0]
    db.execute('reset role')
    return dict(org=str(org),other=str(other),handoff=str(handoff),second=str(second),supplier=str(supplier),batch=str(batch),overlap=str(overlap))
