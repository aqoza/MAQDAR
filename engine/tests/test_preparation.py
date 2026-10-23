from copy import deepcopy

import pytest

from zeespare_engine.preparation import prepare


def task():
    return dict(method='preparation-v1',from_date='2026-01-01',to_date='2026-01-03',
        items=[dict(item_id='a',item_code='OLD',item_name='Old',unit='EA',introduced_on=None,discontinued_on=None,
                    demand=[['2026-01-01','2.123','1.001']]),
               dict(item_id='b',item_code='NEW',item_name='New',unit='EA',introduced_on='2026-01-02',discontinued_on=None,
                    demand=[['2026-01-02','3','0']])],
        supersessions=[dict(predecessor='a',successor='b',effective_on='2026-01-03',factor='2')],
        interchanges=[],calendar=dict(country='SA',weekend_days=[5,6],observe_public_holidays=True,active=True,
            coverage_from='2023-10-01',coverage_to='2026-09-30',calendar_id=None,holidays=[],windows=[],overrides=[]))


def test_cutoff_mapping_converts_all_predecessor_history_and_preserves_lost_sales():
    row=prepare(task())[0]
    assert row['group_id']=='b' and row['status']=='ready'
    assert row['sold']=='7.246' and row['lost']=='2.002'
    assert row['daily'][0]['sold']=='4.246'
    assert row['daily'][1]['sold']=='3'
    assert row['daily'][2]['sold']=='0'
    assert next(c for c in row['contributors'] if c['item_id']=='a')['factor']=='2'
    assert row['daily'][1]['working'] is False  # Friday; observed sales are retained.


def test_explicit_source_units_conflicting_with_catalog_block_group():
    data = task()
    data['items'][0]['unit_conflict'] = True
    result = prepare(data)[0]
    assert result['status'] == 'blocked'
    assert result['issue'] == 'unit_mismatch'
    assert result['sold'] is None and result['daily'] == []


def test_two_way_pooling_deduplicates_and_one_way_stays_separate():
    data=task();data['supersessions']=[]
    data['interchanges']=[dict(item='a',alternate='b',direction='two_way')]
    row=prepare(data)[0]
    assert row['sold']=='5.123' and len(row['contributors'])==2
    data['interchanges'][0]['direction']='one_way'
    assert len(prepare(data))==2


def test_future_replacement_is_not_applied():
    data=task();data['supersessions'][0]['effective_on']='2026-01-04'
    assert len(prepare(data))==2


@pytest.mark.parametrize('problem', ['units','conversion','cycle'])
def test_conflicting_relationships_block_aggregation(problem):
    data=task()
    if problem in ('units','conversion'):
        data['interchanges']=[dict(item='a',alternate='b',direction='two_way')]
        if problem=='units':
            data['items'][1]['unit']='BOX'
    else:
        data['supersessions'].append(dict(predecessor='b',successor='a',effective_on='2026-01-01',factor='1'))
    row=prepare(data)[0]
    assert row['status']=='blocked' and row['daily']==[] and row['sold'] is None


def test_calendar_precedence_and_unverified_dates():
    data=task();cal=data['calendar']
    cal.update(calendar_id='c',coverage_to='2025-12-31')
    cal['overrides']=[dict(calendar_id=None,starts_on='2026-01-01',ends_on='2026-01-03',kind='closure',name='Country'),
                      dict(calendar_id='c',starts_on='2026-01-01',ends_on='2026-01-01',kind='working_day',name='Special')]
    days=prepare(data)[0]['daily']
    assert days[0]['working'] is True and days[0]['calendar_reason']=='calendar_override'
    assert days[1]['working'] is False and days[1]['calendar_reason']=='country_override'
    assert all(d['holiday'] is None and d['ramadan'] is None for d in days)
    cal['overrides']=[]
    assert prepare(data)[0]['daily'][0]['working'] is None
    cal['observe_public_holidays']=False
    assert prepare(data)[0]['daily'][0]['working'] is True


def test_lifecycle_clipping_does_not_invent_zero_outside_all_source_windows():
    data=task()
    for item in data['items']:
        item.update(introduced_on='2026-01-02',discontinued_on='2026-01-02')
    rows=prepare(data)[0]['daily']
    assert rows[0]['sold'] is None and rows[0]['active_sources']==0
    assert rows[1]['sold']=='3' and rows[2]['sold'] is None


def test_saved_source_order_does_not_change_result():
    data=task();other=deepcopy(data);other['items'].reverse()
    assert prepare(data)==prepare(other)


def test_inactive_calendar_is_unknown():
    data=task();data['calendar']['active']=False
    assert all(d['working'] is None for d in prepare(data)[0]['daily'])


def test_converging_conversion_paths_must_agree():
    data=task()
    data['items'].append(dict(data['items'][1],item_id='c',item_code='ALTERNATE',introduced_on=None,demand=[]))
    data['items'].append(dict(data['items'][1],item_id='d',item_code='TERMINAL',introduced_on=None,demand=[]))
    data['interchanges']=[dict(item='a',alternate='c',direction='two_way')]
    data['supersessions'] += [dict(predecessor='b',successor='d',effective_on='2026-01-01',factor='0.5'),dict(predecessor='c',successor='d',effective_on='2026-01-01',factor='1')]
    row=prepare(data)[0]
    assert row['status']=='ready' and row['group_id']=='d'
    assert row['sold']=='3.6230'
    data['supersessions'][-1]['factor']='3'
    assert prepare(data)[0]['issue']=='conflicting_conversion'


def test_equal_unit_identity_replacement_within_equivalence_is_allowed():
    data=task();data['supersessions'][0]['factor']='1'
    data['interchanges']=[dict(item='a',alternate='b',direction='two_way')]
    assert prepare(data)[0]['status']=='ready'


def test_calendar_observed_events_and_all_sector_holidays():
    data=task();cal=data['calendar']
    cal['holidays']=[dict(date='2026-01-01',sector='all')]
    cal['windows']=[dict(ramadan_start='2026-01-01',ramadan_end='2026-01-01',eid_al_fitr='2026-01-02',arafat_day='2026-01-03',eid_al_adha='2026-01-04')]
    days=prepare(data)[0]['daily']
    assert days[0]['working'] is False and days[0]['calendar_reason']=='public_holiday'
    assert days[0]['ramadan'] is True and days[1]['eid_al_fitr'] is True and days[2]['arafat_day'] is True
    cal['holidays'].append(dict(date='2026-01-02',sector='all'))
    assert prepare(data)[0]['daily'][1]['calendar_reason']=='public_holiday'
    cal['holidays'][0]['sector']='government'
    assert prepare(data)[0]['daily'][0]['working'] is True


@pytest.mark.parametrize('change',['method','empty','duplicate_id','date_range','endpoint','quantity','duplicate_day'])
def test_malformed_capture_is_rejected(change):
    data=task()
    if change=='method': data['method']='unknown'
    if change=='empty': data['items']=[]
    if change=='duplicate_id': data['items'].append(data['items'][0])
    if change=='date_range': data['from_date']='2020-01-01'
    if change=='endpoint': data['supersessions'][0]['successor']='absent'
    if change=='quantity': data['items'][0]['demand'][0][1]='NaN'
    if change=='duplicate_day': data['items'][0]['demand']*=2
    with pytest.raises(ValueError): prepare(data)


def test_invalid_conversion_is_a_visible_conflict():
    data=task();data['supersessions'][0]['factor']='0'
    assert prepare(data)[0]['issue']=='invalid_factor'
