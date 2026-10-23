"""Local supplier batch fixture using independently approved planning chains."""
from supplier_portal_fixture import seed_supplier_portal

LINE_SQL = r"""
create function pg_temp.line(n integer,u text default 'EA',lead integer default 3,duplicate boolean default false) returns uuid language plpgsql as $$
declare item uuid:=case when duplicate then pg_temp.id(100) else pg_temp.id(10000+n) end;
  run uuid:=pg_temp.id(20000+n); policy uuid:=pg_temp.id(30000+n);
  draft uuid; scenario uuid; delivery uuid; estimate uuid; proposal uuid; report jsonb; evidence jsonb;
begin
  if not duplicate then
    insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
      values(item,pg_temp.id(1),'ITEM-'||n,'Item','Test',u,1,'SAR');
    insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
      values(pg_temp.id(1),item,pg_temp.id(20),'2026-10-10',12,2,1,'SAR',u);
    insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
      values(pg_temp.id(1),pg_temp.id(110),item,lead,10,6,1.005,'SAR',u,'2026-10-10');
  end if;
  insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
    values(run,pg_temp.id(1),pg_temp.id(20),gen_random_uuid(),'2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}');
  select p.evidence into evidence from public.inventory_policies p where id=pg_temp.id(50);
  evidence:=jsonb_set(evidence,'{options,lead_time}',to_jsonb(lead));
  evidence:=jsonb_set(evidence,'{forecast,source,unit_provenance}',jsonb_build_object('method','source-units-v1','status','consistent','unit',u,'rows',1,'unknown_rows',0,'units',jsonb_build_array(u)));
  insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
    values(policy,pg_temp.id(1),run,pg_temp.id(20),gen_random_uuid(),item,case when duplicate then 'ITEM' else 'ITEM-'||n end,u,'available','{"protection":{"target":"20.000"}}',evidence);
  perform pg_temp.login(10,1);
  report:=public.replenishment_preview(pg_temp.id(1),policy,'calculated',null,'4',true);
  draft:=public.replenishment_save(pg_temp.id(1),policy,gen_random_uuid(),'calculated',null,'4',true,report->>'fingerprint');
  report:=public.supplier_scenario_preview(pg_temp.id(1),draft,'SUP',true);
  scenario:=public.supplier_scenario_save(pg_temp.id(1),draft,'SUP',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.delivery_scenario_preview(pg_temp.id(1),scenario,'2026-10-10',true);
  delivery:=public.delivery_scenario_save(pg_temp.id(1),scenario,'2026-10-10',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.purchase_cost_preview(pg_temp.id(1),delivery,true);
  estimate:=public.purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),report->>'fingerprint');
  proposal:=public.purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Reason');
  perform pg_temp.login(14,1);
  perform public.purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(10,1);
  return public.purchase_handoff_create(pg_temp.id(1),proposal);
end; $$;
"""

def seed_supplier_batch_portal(db, owner, prefix):
    org, other, handoff, supplier = seed_supplier_portal(db, owner, prefix)
    db.execute(LINE_SQL)
    second = db.execute("select pg_temp.line(1,'KG',5)").fetchone()[0]
    third = db.execute("select pg_temp.line(2)").fetchone()[0]
    db.execute('set local role authenticated')
    batch = db.execute('select public.purchase_handoff_batch_create(%s,%s::uuid[])',(org,[handoff,second])).fetchone()[0]
    overlap = db.execute('select public.purchase_handoff_batch_create(%s,%s::uuid[])',(org,[second,third])).fetchone()[0]
    db.execute('reset role')
    return dict(org=str(org), other=str(other), handoff=str(handoff), supplier=str(supplier), batch=str(batch), overlap=str(overlap))
