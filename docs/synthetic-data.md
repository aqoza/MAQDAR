# Synthetic data

`maqdar-synth` generates a realistic service-parts network for the Gulf and loads it into the local Supabase stack. It exists so every later step (forecasting, replenishment, dashboards) can be built and benchmarked without customer data. The output is an import-format bundle (see [import-format.md](import-format.md)); the generator's hidden parameters are written to `_truth/` so Phase 2 can score its classifier against them.

## Running it

```bash
pnpm db:start                                   # local stack with the Step 2 migrations
pnpm synth:small                                # generate + validate + load 1,000 items
pnpm synth:large                                # 50,000 items, ~13 M demand rows (about 12 minutes)
cd engine && uv run maqdar-synth generate --preset medium --out data/medium
cd engine && uv run maqdar-synth load data/medium --replace --member-email you@company.com
```

`load` refuses any host that is not loopback, requires Postgres 17 with the Step 2 migrations and a role that bypasses RLS (the local `postgres`), validates the bundle first, and writes everything in one transaction: codes are checked against the bundle's own parents before each `COPY`, the master-data tables are analyzed (partition statistics are left to autovacuum), and a set-based anti-join over distinct item-location pairs re-checks demand references (the table has no foreign keys) before the commit. `--replace` deletes the synthetic organization before reloading; `pnpm db:reset` is faster for the large preset. `--member-email` makes an existing signed-in user the owner of the synthetic organization so it shows up once the Step 3 switcher exists.

| Preset   | Items  | Locations | Demand rows | Generate | Load   | Use                             |
| -------- | ------ | --------- | ----------- | -------- | ------ | ------------------------------- |
| `tiny`   | 24     | 8         | ~14 k       | 2 s      | 3 s    | unit tests, CI load             |
| `medium` | 300    | 40        | ~200 k      | 3 s      | 10 s   | statistical tests               |
| `small`  | 1,000  | 40        | ~640 k      | 5 s      | ~25 s  | daily development               |
| `large`  | 50,000 | 40        | ~13 M       | ~2 min   | ~9 min | performance work, Step 6 target |

Timings are from a Windows laptop running Docker Desktop. The large bundle is 417 MB of CSV and about 2.5 GB in Postgres (heap and indexes of the monthly partitions); the load time is dominated by the `COPY` into `demand_history`'s two indexes.

Options: `--seed`, `--months N` (keeps the window end, trims the start), `--density` (scales occurrence; `large` defaults to 0.5, `1.0` doubles the rows), `--items`, `--force`.

## The network

40 locations from the package data (`engine/src/maqdar_engine/synth/data/locations.csv`): one central warehouse in Riyadh, regional hubs in Dubai, Doha, Kuwait City and Muscat, and 35 branches (KSA 14, UAE 8, Qatar 4, Kuwait 4, Oman 5) with real city coordinates. Branches replenish from their country hub (KSA branches from the central warehouse). Each location has a size factor and a region tag (`western` KSA sites see the Hajj effect, `eastern` ones more dust).

The central warehouse stocks every item; hubs stock `hub_share` and branches `branch_share` of the catalogue, weighted towards fast movers. Demand exists only for stocked item-location pairs.

## Items and suppliers

21 product groups (`product_groups.csv`) with pack sizes, MOQ multipliers, a lognormal cost distribution in SAR and the seasonal coefficients below; 12 fictional brands. Each item gets a Syntetos-Boylan archetype (20 % smooth, 10 % erratic, 40 % intermittent, 30 % lumpy), a velocity (lognormal), a lifecycle (85 % active, 7 % introduced inside the window with a 90-day ramp, 5 % declining, 3 % discontinued inside the window) and, for about 6 % of items, a place in a supersession chain of two to four parts.

Suppliers sit in four regions (local KSA/UAE, regional UAE distributors, Asia, Europe/US) with typical (p50) and slow (p90) lead times. Every item has exactly one preferred supplier; 30 % have a second source. Prices are quoted in the supplier's currency (SAR, AED, USD, EUR, JPY) and rounded to that currency's minor units; MOQ is always a multiple of the pack size.

## Demand model

For every stocked pair and day, demand is an occurrence × size process on open days:

- Occurrence: Bernoulli with `p = p_base × tier × size_factor × density × multiplier(day)`, capped at 0.98 (excess intensity moves into the size). `p_base` per archetype keeps the average demand interval at least 0.1 away from the 1.32 cutoff; tier is 1.0 at the central warehouse, 0.5 at hubs and 0.25 at branches.
- Size: `1 + NegativeBinomial` (tsintermittent `simID` mapping) for CV² below 0.5, rounded lognormal above it. Sizes scale ×4 at the central warehouse and ×2 at hubs.
- Multipliers (all multiplicative, clamped to 4, zero on closed days):
  - Weekends from `countries.csv` (Friday-Saturday except the UAE's Saturday-Sunday) and all-sector holidays from `public_holidays.csv` close a location; government-only closures are ×0.8 quiet days.
  - Ramadan ×0.75 for workshop lines, ×0.85 for counter lines, ×0.9 tyres, ×1.0 batteries, using each country's own window (Oman started a day later in 2024 and 2026 and celebrated Eid al-Fitr 2025 a day later); the last ten days lift batteries, tyres, A/C and brakes by the group's `pre_eid_lift`; five days after Eid al-Fitr ×1.15.
  - Summer heat: a per-country monthly index (July-August peak; Oman May-June) interpolated by day; multiplier `1 + 0.8 × heat_coefficient × index`, so batteries and A/C compressors reach ×1.8, coolant ×1.56, filters ×1.24; December-February dip of `0.15 × heat_coefficient`.
  - Dust March-June (May peak) on air and cabin filters: up to ×1.35 in Kuwait, Qatar and eastern KSA, half of that elsewhere in KSA and the UAE, a fifth in Oman.
  - Hajj: western KSA sites ×(1 + 1.5 × hajj_fleet) over 1-13 Dhul Hijjah for fleet-related groups; other KSA sites ×0.85 over 8-13 Dhul Hijjah.
  - Summer exodus 1 July-25 August: ×0.85 in the UAE, Qatar and Kuwait, ×0.92 in KSA and Oman, for non-heat groups.
  - Working-week shape: first open day after the weekend ×1.15, last one ×0.9.
- Lifecycle: logistic ramp over 90 days for new items, hard stop at `discontinued_on`, exponential decline for phase-out items outside chains.
- Supersession: one family series per chain, split between predecessor and successor by a logistic cross-fade centred 30 days after `effective_on` (scale 8 days) with hard bounds: the successor sells nothing before `effective_on` and takes everything from 60 days after it; the predecessor is discontinued 120 days after the switch. `quantity_factor` 2 or 0.5 on about 10 % of links models pack changes.
- Lost sales: 5 % of branch pairs and 2 % of hub pairs get one to three stock-out episodes of 5-20 days during which demand is recorded as `lost_sales_quantity` instead of `quantity`.

The magnitudes are modelling assumptions grounded in press reports (battery service requests rise 25-35 % in Gulf summers; home A/C demand rose 150 % in a June heat spell; tyre and battery checks before Eid road trips) and should be recalibrated from the first customer dataset.

## Calendar sources

`public_holidays.csv` holds observed dates (not statutory rules) for 2023-10-01 to 2026-09-30 with a `source` column per row. Aggregator sites were wrong on a dozen dates in this window; the table follows the official announcements, for example: Oman's Accession Day 2026 was observed on 15 January (not the 11th), Kuwait observed Isra and Miraj 2025 on 30 January, Saudi Arabia's Eid al-Fitr 2024 holiday ran 8-11 April, the UAE's National Day 2025 holiday was 1-2 December, and Kuwait extended Eid al-Fitr 2026 to Monday 23 March for ministries. `ramadan_windows.csv` records each country's own Ramadan, Eid al-Fitr, Arafat and Eid al-Adha dates. The generator refuses windows outside the verified coverage recorded in `countries.csv`.

The same files seed the `countries`, `currencies`, `ramadan_windows` and `public_holidays` tables through the reference-data migration (`maqdar-synth emit-reference-sql`); a test fails when the migration and the CSVs drift apart.

## Determinism

Every family draws from `numpy.random.default_rng([family_index, seed])`, so output does not depend on batch size or on other families, and the same preset and seed reproduce byte-identical CSVs on the same platform. numpy does not guarantee identical streams across versions, so `numpy==2.5.3` is pinned and the manifest records the versions used.

## Ground truth

`_truth/items.csv` (archetype, base probability, size parameters, velocity, seasonal coefficients, lifecycle, chain) and `_truth/pairs.csv` (effective probability and size per stocked pair, stock-out episodes) are not part of the import format and are never loaded. They let later steps score demand classification and forecast accuracy against the process that produced the data.
