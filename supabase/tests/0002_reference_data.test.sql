-- Reference data: weekend conventions, currency decimals and the verified calendar anchors.
begin;

select plan(16);

select is(
  (select weekend_days from public.countries where code = 'SA'),
  array[5, 6]::smallint[],
  'Saudi weekend is Friday-Saturday'
);
select is(
  (select weekend_days from public.countries where code = 'AE'),
  array[6, 7]::smallint[],
  'UAE weekend is Saturday-Sunday'
);
select results_eq(
  $$select code::text from public.countries where weekend_days = array[5, 6]::smallint[] order by code$$,
  $$values ('BH'), ('EG'), ('JO'), ('KW'), ('OM'), ('QA'), ('SA')$$,
  'all other countries use Friday-Saturday'
);

select is((select minor_units from public.currencies where code = 'KWD'), 3::smallint, 'KWD has 3 decimals');
select is((select minor_units from public.currencies where code = 'OMR'), 3::smallint, 'OMR has 3 decimals');
select is((select minor_units from public.currencies where code = 'JPY'), 0::smallint, 'JPY has 0 decimals');

-- Verified calendar anchors (see docs/synthetic-data.md for sources).
select ok(
  exists (select 1 from public.public_holidays where country_code = 'OM' and holiday_date = '2026-01-15'),
  'Oman Accession Day 2026 was observed on 15 January'
);
select ok(
  not exists (select 1 from public.public_holidays where country_code = 'OM' and holiday_date = '2026-01-11'),
  '11 January 2026 was an ordinary working Sunday in Oman'
);
select ok(
  exists (select 1 from public.public_holidays where country_code = 'KW' and holiday_date = '2025-01-30'),
  'Kuwait observed Isra and Miraj on 30 January 2025'
);
select ok(
  not exists (select 1 from public.public_holidays where country_code = 'KW' and holiday_date = '2025-01-27'),
  '27 January 2025 was a working day in Kuwait'
);
select results_eq(
  $$select holiday_date::text from public.public_holidays where country_code = 'SA' and holiday_date between '2024-04-01' and '2024-04-30' order by holiday_date$$,
  $$values ('2024-04-08'), ('2024-04-09'), ('2024-04-10'), ('2024-04-11')$$,
  'Saudi Eid al-Fitr 2024 holiday was 8-11 April'
);
select results_eq(
  $$select holiday_date::text from public.public_holidays where country_code = 'AE' and holiday_date between '2025-11-25' and '2025-12-10' order by holiday_date$$,
  $$values ('2025-12-01'), ('2025-12-02')$$,
  'UAE National Day 2025 holiday was 1-2 December'
);
select is(
  (select eid_al_fitr from public.ramadan_windows where country_code = 'OM' and hijri_year = 1446),
  '2025-03-31'::date,
  'Oman celebrated Eid al-Fitr 1446 one day after its neighbours'
);
select is(
  (select ramadan_start from public.ramadan_windows where country_code = 'SA' and hijri_year = 1446),
  '2025-03-01'::date,
  'Ramadan 1446 started on 1 March 2025 in Saudi Arabia'
);

-- Access: signed-in users read, nobody writes through the API.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
select isnt_empty('select 1 from public.countries', 'authenticated users can read countries');
select throws_ok(
  $$insert into public.currencies (code, name_en, minor_units) values ('XXX', 'Test', 2)$$,
  '42501',
  null,
  'authenticated users cannot write reference data'
);
reset role;

select * from finish();

rollback;
