"""Immutable, cutoff-based demand preparation. It never changes observations or forecasts."""
from datetime import date, timedelta
from decimal import Decimal, localcontext

VERSION = 'preparation-v1'


class Conflict(ValueError):
    pass


def text(value: Decimal) -> str:
    return format(value, 'f')


def components(ids, edges):
    parent = {i:i for i in ids}
    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for a,b in edges:
        parent[root(a)] = root(b)
    groups = {}
    for i in ids:
        groups.setdefault(root(i), []).append(i)
    return list(groups.values())


def conversions(items, supersessions, interchanges):
    equivalents = components(items, [(e['item'],e['alternate']) for e in interchanges])
    roots, representatives = {}, {}
    for group in equivalents:
        if len({items[i]['unit'] for i in group}) != 1:
            raise Conflict('unit_mismatch')
        canonical = min(group, key=lambda i:(items[i]['item_code'],i))
        representatives[canonical] = canonical
        roots.update({i:canonical for i in group})
    edges = {i:[] for i in representatives}
    for edge in supersessions:
        a,b = roots[edge['predecessor']],roots[edge['successor']]
        factor = Decimal(edge['factor'])
        if not factor.is_finite() or factor <= 0:
            raise Conflict('invalid_factor')
        if a == b:
            if factor != 1:
                raise Conflict('conflicting_conversion')
        else:
            edges[a].append((b,factor))
    resolved = {}
    def resolve(node, path):
        if node in path:
            raise Conflict('relationship_cycle')
        if node in resolved:
            return resolved[node]
        destinations = set()
        for target,rate in edges[node]:
            terminal,factor = resolve(target,path|{node})
            destinations.add((terminal,rate*factor))
        if len(destinations)>1:
            raise Conflict('conflicting_conversion')
        resolved[node] = next(iter(destinations)) if destinations else (node,Decimal(1))
        return resolved[node]
    return {i:resolve(roots[i],set()) for i in items}


def calendar_day(cal: dict, day: date) -> dict:
    key = str(day)
    verified = bool(cal.get('coverage_from') and cal['coverage_from'] <= key <= cal['coverage_to'])
    holiday = any(h['date']==key and h['sector']=='all' for h in cal['holidays']) if verified else None
    windows = cal['windows']
    ramadan = any(w['ramadan_start']<=key<=w['ramadan_end'] for w in windows) if verified else None
    flags = {event:any(w[event]==key for w in windows) if verified else None
             for event in ('eid_al_fitr','arafat_day','eid_al_adha')}
    weekend = day.isoweekday() in cal['weekend_days']
    working,reason = None,'unknown_coverage'
    matches = [o for o in cal['overrides'] if o['starts_on']<=key<=o['ends_on']
               and (o['calendar_id'] is None or o['calendar_id']==cal.get('calendar_id'))]
    matches.sort(key=lambda o:o['calendar_id'] is not None,reverse=True)
    if not cal['active']:
        reason = 'inactive_calendar'
    elif matches:
        working = matches[0]['kind']=='working_day'
        reason = 'calendar_override' if matches[0]['calendar_id'] else 'country_override'
    elif cal['observe_public_holidays'] and verified and holiday:
        working,reason = False,'public_holiday'
    elif weekend:
        working,reason = False,'weekend'
    elif not cal['observe_public_holidays']:
        working,reason = True,'weekly_pattern'
    elif verified:
        working,reason = True,'weekly_pattern'
    return dict(working=working,calendar_reason=reason,weekend=weekend,holiday=holiday,
                calendar_verified=verified,ramadan=ramadan,**flags)


def prepare_group(ids, snapshot, calendar):
    items = {item['item_id']:item for item in snapshot['items'] if item['item_id'] in ids}
    ids = sorted(ids,key=lambda i:(items[i]['item_code'],i))
    supersessions = [e for e in snapshot['supersessions'] if e['predecessor'] in ids
                     and e['successor'] in ids and e['effective_on']<=snapshot['to_date']]
    interchanges = [e for e in snapshot['interchanges'] if e['direction']=='two_way'
                    and e['item'] in ids and e['alternate'] in ids]
    row = dict(group_id=min(ids),source_ids=ids,status='blocked',issue=None,sold=None,lost=None,
               contributors=[],daily=[],target_code=None,unit=None)
    try:
        if any(item.get('unit_conflict', False) for item in items.values()):
            raise Conflict('unit_mismatch')
        mapping = conversions(items,supersessions,interchanges)
        terminals = {target for target,factor in mapping.values()}
        if len(terminals)!=1:
            raise Conflict('conflicting_conversion')
    except Conflict as error:
        return dict(row,issue=str(error),contributors=[dict(item_id=i,item_code=items[i]['item_code'],
                    factor=None,sold=None,lost=None,converted_sold=None,converted_lost=None) for i in ids])
    terminal = next(iter(terminals))
    daily = [dict(day, sold=Decimal(0),lost=Decimal(0),active_sources=0) for day in calendar]
    for i in ids:
        item,factor = items[i],mapping[i][1]
        start = max(snapshot['from_date'],item.get('introduced_on') or snapshot['from_date'])
        end = min(snapshot['to_date'],item.get('discontinued_on') or snapshot['to_date'])
        demand = {}
        for day,sold,lost in item['demand']:
            quantities = (Decimal(sold),Decimal(lost))
            if day in demand or not snapshot['from_date']<=day<=snapshot['to_date'] or any(not q.is_finite() or q<0 for q in quantities):
                raise ValueError('Invalid preparation source')
            demand[day] = quantities
        sold,lost = Decimal(0),Decimal(0)
        for day in daily:
            if start<=day['date']<=end:
                a,b = demand.get(day['date'],(Decimal(0),Decimal(0)))
                day['sold'] += a*factor
                day['lost'] += b*factor
                day['active_sources'] += 1
                sold += a
                lost += b
        row['contributors'].append(dict(item_id=i,item_code=item['item_code'],factor=text(factor),
            sold=text(sold),lost=text(lost),converted_sold=text(sold*factor),converted_lost=text(lost*factor)))
    total_sold = sum(d['sold'] for d in daily)
    total_lost = sum(d['lost'] for d in daily)
    for day in daily:
        day['sold'] = text(day['sold']) if day['active_sources'] else None
        day['lost'] = text(day['lost']) if day['active_sources'] else None
    return dict(row,group_id=terminal,status='ready',target_code=items[terminal]['item_code'],
                unit=items[terminal]['unit'],sold=text(total_sold),lost=text(total_lost),daily=daily)


def prepare(snapshot: dict) -> list[dict]:
    if snapshot.get('method')!=VERSION or not 1<=len(snapshot['items'])<=100:
        raise ValueError('Invalid preparation request')
    start,end = date.fromisoformat(snapshot['from_date']),date.fromisoformat(snapshot['to_date'])
    if not 0<=(end-start).days<=1095:
        raise ValueError('Invalid preparation window')
    ids = [i['item_id'] for i in snapshot['items']]
    if len(set(ids))!=len(ids):
        raise ValueError('Duplicate source identity')
    edges = [(e['predecessor'],e['successor']) for e in snapshot['supersessions'] if e['effective_on']<=str(end)]
    edges += [(e['item'],e['alternate']) for e in snapshot['interchanges'] if e['direction']=='two_way']
    if any(a not in ids or b not in ids for a,b in edges):
        raise ValueError('Uncaptured relationship endpoint')
    calendar = [dict(date=str(start+timedelta(days=n)),**calendar_day(snapshot['calendar'],start+timedelta(days=n)))
                for n in range((end-start).days+1)]
    with localcontext() as context:
        # At most 100 factors of numeric(18,3), followed by source quantity and summation.
        context.prec = 2048
        return sorted([prepare_group(group,snapshot,calendar) for group in components(ids,edges)],key=lambda r:r['group_id'])
