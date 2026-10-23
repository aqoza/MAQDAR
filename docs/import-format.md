# Import format v1

The files ZeeSpare imports master data and transactions from. The synthetic data generator writes them as a bundle, the loader reads the bundle into the local stack, and the import wizard accepts the same entities from customers as CSV, TSV, TXT or XLSX files. The contract lives in code (`engine/src/zeespare_engine/importformat.py`); the column tables below are generated from it and a test fails when they drift. A machine-readable copy is in [`import-format.schema.json`](import-format.schema.json) (also exported to the web app as `@zeespare/shared/import-format.schema.json`), and the database's copy (`ingest.contract_entities` and `ingest.contract_columns`) is seeded from `uv run zeespare-synth format --sql`.

Version 1 is frozen: later versions only add optional entities and optional trailing columns. Never rename, remove or reorder a column.

## Scope and keys

- An import belongs to one organization. No file carries an organization id: the importing user's organization is applied on load.
- Rows are identified by natural keys (codes), never by database ids. The loader derives ids deterministically from the organization and the code, so reloading a bundle is idempotent; the wizard matches rows by natural key, so re-importing a file converges.
- `/` is allowed in part numbers (`item_code` and the columns that reference items) and in no other code.
- Files are loaded in the order of the tables below so every reference resolves: work calendars, holiday overrides, locations, network links, brands, items, item supersessions, item interchanges, suppliers, supplier items, fx rates, demand history, stock snapshots, open orders, receipts.
- Work calendars, holiday overrides, network links, item interchanges and fx rates are optional: a bundle may leave their files out. `work_calendar_code` is an optional trailing column of `locations.csv` and `suppliers.csv`; a file may leave it out of its header, and the location or supplier then follows its country's default calendar.
- `manifest.json` lists every file with its row count and sha256 and records the generator version, seed, window and organization. The loader verifies it before writing anything.
- `_truth/` (generator ground truth) is not part of the format and is never loaded.

## Dialect (bundles)

The bundle the generator writes and `zeespare-synth validate` checks uses this strict dialect. The wizard accepts more (see below) and normalizes every value to it before validation.

- UTF-8 without a byte-order mark; LF line endings.
- RFC 4180 quoting: fields containing commas, quotes or newlines are wrapped in double quotes, inner quotes doubled.
- One header row whose names and order equal the column tables below; optional trailing columns may be left out (the loader validates with `COPY … HEADER MATCH`).
- Dates are `YYYY-MM-DD`. Timestamps (none in v1) would be `YYYY-MM-DDTHH:MM:SSZ` in UTC.
- Numbers use a dot decimal separator and no thousands separators. Money and quantities carry at most 3 fractional digits and 12 integer digits; trailing fractional zeros do not count.
- Booleans are the literals `true` and `false`.
- An empty field means NULL; required columns must not be empty. An empty `weekend_days` means no weekend days.
- `demand_history` is split into monthly parts named `YYYY-MM.csv` under a `demand_history/` folder; a single `demand_history.csv` with the same header is also accepted. Only days with demand or lost sales appear; a missing day means zero.

## Uploading through the wizard

Editors (owner, admin, planner) import files from the Imports page (`/imports/new`). One import may hold several files, one per entity (demand history may be split into several parts); they are checked and applied in the load order above.

**Files and encodings.**

- CSV, TSV and TXT files of up to 50,000,000 bytes. The delimiter (comma, semicolon or tab) is detected. Line endings may be LF or CRLF.
- The encoding is read from a byte-order mark (UTF-8, UTF-16LE, UTF-16BE); without one the file is decoded as strict UTF-8, and if that fails as Windows-1256 (Arabic Excel exports). The guess can be overridden with Windows-1256, ISO-8859-6, UTF-16 or UTF-8.
- XLSX workbooks of up to 100,000 rows or 20 MB: pick the sheet; the 1900 and 1904 date systems are both read correctly. Larger demand files must be CSV.
- The first row is the header. Header names are matched to contract columns by name (ignoring case, spaces and underscores), then by their English or Arabic label, then by the mapping the organization used last time for the same entity and headers. Every mapping can be changed.

**Values.** The decimal separator (dot or comma) and the date order (`YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY`) are chosen per file, never guessed. Before validation the wizard converts Arabic-Indic and extended Arabic-Indic digits to ASCII and `٫` to the decimal point, removes thousands separators only where they form a valid grouping, converts XLSX date serials, accepts `true/false`, `yes/no`, `1/0` and `نعم/لا` as booleans, and strips bidirectional marks and non-breaking spaces. Codes are kept exactly as written (case included).

**Not provided versus empty.**

- The natural-key columns must be mapped. For `holiday_overrides.csv` that means both `country_code` and `work_calendar_code` (each row fills exactly one) and `starts_on`.
- A column you do not map is **not provided**: existing rows keep their value, and new rows get the "Default for new rows" from the tables below. A required column without a default (marked —) must be mapped when the file creates new rows.
- An **empty cell** in a mapped column clears an optional column and is an error in a required one.
- Columns listed under "Provided together" are mapped together or not at all (for example `unit_cost` with `currency`).
- A rule that compares two columns uses the stored value of the one a file does not map, or its default for a new row. A file that maps only `discontinued_on` is checked against the item's stored `introduced_on`, and `lead_time_days_p90` against the stored `lead_time_days`. The rule is checked again when the import commits, in case the stored value changed in the meantime.

**What an import changes.**

- Imports insert and update rows by natural key; they never delete master data. To retire a row, import it with `is_active` (or `status`) set accordingly.
- Re-importing an unchanged row changes nothing (its `updated_at` stays as it was).
- A supersession row replaces the predecessor's current successor. A preferred supplier item clears the item's other preferred supplier. A reversed interchange or fx pair replaces the stored orientation when the file maps the value that depends on it (`direction` for interchanges, `rate` for fx rates); otherwise the stored orientation and value are kept.
- A demand row with both `quantity` and `lost_sales_quantity` at 0 deletes that day's stored demand; when nothing is stored for that day it is skipped with a warning.
- Demand dates must fall in a month the database keeps demand for (2020-01 onward) and be at most tomorrow.

**Checks and commit.** Every cell, reference and rule is checked while the files upload; the review lists errors and warnings by column with examples, and **Download error report** gives the stored error details as CSV (at most 10,000 per file; the counts on the review are always complete, and the report ends with a line per file that lists how many more were not stored). An import with errors cannot be committed: fix the file and import it again. Imports of up to 5,000 rows commit all or nothing; larger imports commit in short resumable steps, so their rows appear while they commit. If the server loses the checked rows before the commit finishes (a database crash or failover), the import ends as expired and nothing more is saved; import the files again (rows already saved by earlier steps are reported as unchanged). The machine codes of errors and warnings are listed under `error_codes` in [`import-format.schema.json`](import-format.schema.json).

**Limits.** At most 60 files and 1,000,000 rows per import, 3 open imports and 50 new imports per 24 hours per organization (deleting an import does not give its place back). At most 10,000 error and warning details are stored per file.

## Files

How to read the tables: **Required** means a provided cell must not be empty. **Default for new rows** is what a new row gets when the wizard import does not map the column: "key" marks natural-key columns (always mapped), "empty" means no value, and — means the column must be mapped when the file creates new rows.

<!-- import-format:begin -->

### `work_calendars.csv` → `public.work_calendars`

Working-day calendars: weekend days and whether a country's public holidays apply. Locations and suppliers without a calendar use their country's default.

Natural key: `work_calendar_code`. Load order 1. Optional: a bundle may leave this file out.

Rules:

- `country_required`: `observe_public_holidays` (true unless provided) needs a `country_code`.

| Column                    | Type                                                                         | Required | Default for new rows | Description                                                                    |
| ------------------------- | ---------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------ |
| `work_calendar_code`      | code (1-64 characters: letters, digits, `.` `_` `-`)                         | yes      | key                  | Unique calendar code.                                                          |
| `name_en`                 | text, at most 200 characters                                                 | yes      | —                    | English name.                                                                  |
| `name_ar`                 | text, at most 200 characters                                                 | no       | empty                | Arabic name.                                                                   |
| `country_code`            | ISO 3166-1 alpha-2 country code                                              | no       | empty                | Country whose public holidays apply (sector all). References `countries.code`. |
| `weekend_days`            | ISO weekdays 1-7 (1 = Monday) joined by `;`, e.g. `5;6`; distinct, at most 6 | no       | empty                | Weekend days; empty for none.                                                  |
| `observe_public_holidays` | `true` or `false`                                                            | yes      | `true`               | The country's public holidays are non-working days (needs country_code).       |
| `is_active`               | `true` or `false`                                                            | yes      | `true`               | false for calendars no longer used.                                            |

### `holiday_overrides.csv` → `public.holiday_overrides`

Calendar exceptions for one country (every location and supplier there without its own calendar) or one work calendar: closure adds non-working days, working_day cancels a public holiday or weekend day.

Natural key: `country_code` or `work_calendar_code` (exactly one per row; both columns are present) + `starts_on`. Load order 2. Optional: a bundle may leave this file out.

Provided together: `starts_on` + `ends_on`.

Rules:

- `scope_exactly_one`: Exactly one of `country_code` and `work_calendar_code` is set.
- `end_before_start`: `ends_on` is on or after `starts_on`.
- `holiday_too_long`: An override covers at most 366 days.
- `holiday_overlap`: Overrides of one scope do not overlap (within the file and with stored overrides it does not replace).

| Column               | Type                                                 | Required | Default for new rows | Description                                                                                     |
| -------------------- | ---------------------------------------------------- | -------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `country_code`       | ISO 3166-1 alpha-2 country code                      | no       | key                  | Country scope; empty when work_calendar_code is set. References `countries.code`.               |
| `work_calendar_code` | code (1-64 characters: letters, digits, `.` `_` `-`) | no       | key                  | Calendar scope; empty when country_code is set. References `work_calendars.work_calendar_code`. |
| `starts_on`          | date, `YYYY-MM-DD`                                   | yes      | key                  | First day.                                                                                      |
| `ends_on`            | date, `YYYY-MM-DD`                                   | yes      | —                    | Last day (on or after starts_on, at most 366 days in all).                                      |
| `kind`               | one of `closure`, `working_day`                      | yes      | —                    | closure: non-working days; working_day: working days despite a holiday or weekend.              |
| `name_en`            | text, at most 200 characters                         | yes      | —                    | English name.                                                                                   |
| `name_ar`            | text, at most 200 characters                         | no       | empty                | Arabic name.                                                                                    |
| `note`               | text, at most 1000 characters                        | no       | empty                | Free text.                                                                                      |

### `locations.csv` → `public.locations`

Warehouses, regional hubs and branches of the network.

Natural key: `location_code`. Load order 3.

Rules:

- `must_differ`: A location is not its own parent.
- `location_cycle`: Parents never form a cycle.

| Column                 | Type                                                        | Required | Default for new rows | Description                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `location_code`        | code (1-64 characters: letters, digits, `.` `_` `-`)        | yes      | key                  | Unique location code.                                                                                                                                                           |
| `name_en`              | text, at most 200 characters                                | yes      | —                    | English name.                                                                                                                                                                   |
| `name_ar`              | text, at most 200 characters                                | no       | empty                | Arabic name.                                                                                                                                                                    |
| `location_type`        | one of `central`, `hub`, `branch`                           | yes      | —                    | Role in the network.                                                                                                                                                            |
| `country_code`         | ISO 3166-1 alpha-2 country code                             | yes      | —                    | Country of the location (drives weekends and holidays). References `countries.code`.                                                                                            |
| `city`                 | text, at most 100 characters                                | no       | empty                | City.                                                                                                                                                                           |
| `latitude`             | decimal, ≤ 3 integer and ≤ 6 fractional digits, -90 to 90   | no       | empty                | Decimal degrees.                                                                                                                                                                |
| `longitude`            | decimal, ≤ 3 integer and ≤ 6 fractional digits, -180 to 180 | no       | empty                | Decimal degrees.                                                                                                                                                                |
| `timezone`             | IANA time zone name, at most 64 characters                  | yes      | —                    | Time zone of the location.                                                                                                                                                      |
| `parent_location_code` | code (1-64 characters: letters, digits, `.` `_` `-`)        | no       | empty                | Default replenishment source; empty for the central warehouse. References `locations.location_code`.                                                                            |
| `is_active`            | `true` or `false`                                           | yes      | `true`               | false for closed locations.                                                                                                                                                     |
| `work_calendar_code`   | code (1-64 characters: letters, digits, `.` `_` `-`)        | no       | empty                | Work calendar; empty for the country default (weekends and public holidays). References `work_calendars.work_calendar_code`. Optional trailing column: a file may leave it out. |

### `network_links.csv` → `public.network_links`

Transfer lanes between locations: lead times in calendar days and the freight cost per unit or per shipment. One lane per ordered pair.

Natural key: `from_location_code` + `to_location_code`. Load order 4. Optional: a bundle may leave this file out.

Provided together: `lead_time_days_p50` + `lead_time_days_p90`; `freight_basis` + `freight_cost` + `currency`.

Rules:

- `must_differ`: The two locations differ.
- `p90_below_p50`: `lead_time_days_p90` is at least `lead_time_days_p50`.
- `freight_mismatch`: `freight_basis` none has no cost and no currency; any other basis needs both.

| Column               | Type                                                             | Required | Default for new rows | Description                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from_location_code` | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | Sending location. References `locations.location_code`.                                                                                                                                                 |
| `to_location_code`   | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | Receiving location. References `locations.location_code`.                                                                                                                                               |
| `lead_time_days_p50` | integer, 0 to 3650                                               | yes      | —                    | Typical transfer lead time in calendar days.                                                                                                                                                            |
| `lead_time_days_p90` | integer, 0 to 3650                                               | yes      | —                    | Slow (90th percentile) lead time in calendar days.                                                                                                                                                      |
| `freight_basis`      | one of `none`, `per_unit`, `per_shipment`                        | yes      | `none`               | How freight is charged.                                                                                                                                                                                 |
| `freight_cost`       | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | no       | empty                | Freight cost; empty when freight_basis is none.                                                                                                                                                         |
| `currency`           | ISO 4217 currency code                                           | no       | empty                | Currency of freight_cost; empty when freight_basis is none. References `currencies.code`.                                                                                                               |
| `is_active`          | `true` or `false`                                                | yes      | `true`               | false for lanes no longer used.                                                                                                                                                                         |
| `freight_unit`       | one of `EA`, `SET`, `L`, `KG`                                    | no       | empty                | Source-supplied unit for per-unit freight; empty means unknown. Supplying freight terms without this field clears prior unit evidence. Optional trailing column: a file may leave it out.               |
| `freight_valid_from` | date, `YYYY-MM-DD`                                               | no       | empty                | Source-supplied date from which the freight terms apply; empty means unknown. Supplying freight terms without this field clears prior date evidence. Optional trailing column: a file may leave it out. |

### `brands.csv` → `public.brands`

Makes and aftermarket brands that items belong to.

Natural key: `brand_code`. Load order 5.

| Column              | Type                                                 | Required | Default for new rows | Description                       |
| ------------------- | ---------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `brand_code`        | code (1-64 characters: letters, digits, `.` `_` `-`) | yes      | key                  | Unique brand code.                |
| `name_en`           | text, at most 200 characters                         | yes      | —                    | English name.                     |
| `name_ar`           | text, at most 200 characters                         | no       | empty                | Arabic name.                      |
| `brand_type`        | one of `oem`, `aftermarket`                          | no       | empty                | Genuine (OEM) or aftermarket.     |
| `country_of_origin` | ISO 3166-1 alpha-2 country code                      | no       | empty                | Country of origin (any ISO code). |
| `is_active`         | `true` or `false`                                    | yes      | `true`               | false for brands no longer sold.  |

### `items.csv` → `public.items`

Service parts.

Natural key: `item_code`. Load order 6.

Provided together: `unit_cost` + `currency`.

Rules:

- `end_before_start`: `discontinued_on` is on or after `introduced_on`; a file may map either one, and the other keeps its stored value.

| Column            | Type                                                             | Required | Default for new rows | Description                                          |
| ----------------- | ---------------------------------------------------------------- | -------- | -------------------- | ---------------------------------------------------- |
| `item_code`       | part number (1-64 characters: letters, digits, `.` `_` `-` `/`)  | yes      | key                  | Unique part number.                                  |
| `name_en`         | text, at most 200 characters                                     | yes      | —                    | English name.                                        |
| `name_ar`         | text, at most 200 characters                                     | no       | empty                | Arabic name.                                         |
| `brand_code`      | code (1-64 characters: letters, digits, `.` `_` `-`)             | no       | empty                | Brand or make. References `brands.brand_code`.       |
| `product_group`   | text, at most 64 characters                                      | yes      | —                    | Planning group, e.g. battery, oil_filter.            |
| `unit_of_measure` | one of `EA`, `SET`, `L`, `KG`                                    | yes      | —                    | Stocking unit.                                       |
| `unit_cost`       | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | yes      | —                    | Standard cost per unit.                              |
| `currency`        | ISO 4217 currency code                                           | yes      | —                    | Currency of unit_cost. References `currencies.code`. |
| `status`          | one of `new`, `active`, `phase_out`, `discontinued`              | yes      | `active`             | Lifecycle status.                                    |
| `introduced_on`   | date, `YYYY-MM-DD`                                               | no       | empty                | First day the item was available.                    |
| `discontinued_on` | date, `YYYY-MM-DD`                                               | no       | empty                | Last day the item was available.                     |

### `item_supersessions.csv` → `public.item_supersessions`

Part replacements: demand for the predecessor moves to the successor from effective_on. One successor per predecessor.

Natural key: `predecessor_item_code`. Load order 7.

Rules:

- `must_differ`: An item does not supersede itself.
- `supersession_cycle`: Supersession chains never form a cycle.

| Column                  | Type                                                            | Required | Default for new rows | Description                                                             |
| ----------------------- | --------------------------------------------------------------- | -------- | -------------------- | ----------------------------------------------------------------------- |
| `predecessor_item_code` | part number (1-64 characters: letters, digits, `.` `_` `-` `/`) | yes      | key                  | Replaced item. References `items.item_code`.                            |
| `successor_item_code`   | part number (1-64 characters: letters, digits, `.` `_` `-` `/`) | yes      | —                    | Replacing item. References `items.item_code`.                           |
| `effective_on`          | date, `YYYY-MM-DD`                                              | yes      | —                    | First day the successor replaces the predecessor.                       |
| `quantity_factor`       | decimal, ≤ 12 integer and ≤ 3 fractional digits, > 0            | yes      | `1`                  | Units of successor per unit of predecessor (1 unless the pack changes). |
| `note`                  | text, at most 1000 characters                                   | no       | empty                | Free text.                                                              |

### `item_interchanges.csv` → `public.item_interchanges`

Interchangeable parts. one_way: the alternate may be issued when the item is requested, never the reverse; two_way: both directions. One row per unordered pair; a reversed pair replaces the stored orientation when the file maps direction (otherwise the stored orientation and direction are kept).

Natural key: the unordered pair `item_code` and `alternate_item_code`. Load order 8. Optional: a bundle may leave this file out.

Rules:

- `must_differ`: The two items differ.

| Column                | Type                                                            | Required | Default for new rows | Description                                                    |
| --------------------- | --------------------------------------------------------------- | -------- | -------------------- | -------------------------------------------------------------- |
| `item_code`           | part number (1-64 characters: letters, digits, `.` `_` `-` `/`) | yes      | key                  | Requested item. References `items.item_code`.                  |
| `alternate_item_code` | part number (1-64 characters: letters, digits, `.` `_` `-` `/`) | yes      | key                  | Item that may be issued instead. References `items.item_code`. |
| `direction`           | one of `one_way`, `two_way`                                     | yes      | `two_way`            | Direction of the interchange.                                  |
| `priority`            | integer, 1 to 99                                                | yes      | `1`                  | Order in which alternates are tried (1 first).                 |
| `note`                | text, at most 1000 characters                                   | no       | empty                | Free text.                                                     |

### `suppliers.csv` → `public.suppliers`

Suppliers and their typical lead times.

Natural key: `supplier_code`. Load order 9.

Provided together: `lead_time_days_p50` + `lead_time_days_p90`.

Rules:

- `p90_below_p50`: `lead_time_days_p90` is at least `lead_time_days_p50`.

| Column               | Type                                                 | Required | Default for new rows | Description                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supplier_code`      | code (1-64 characters: letters, digits, `.` `_` `-`) | yes      | key                  | Unique supplier code.                                                                                                                                                           |
| `name_en`            | text, at most 200 characters                         | yes      | —                    | English name.                                                                                                                                                                   |
| `name_ar`            | text, at most 200 characters                         | no       | empty                | Arabic name.                                                                                                                                                                    |
| `country_code`       | ISO 3166-1 alpha-2 country code                      | yes      | —                    | Country the supplier ships from (any ISO code).                                                                                                                                 |
| `currency`           | ISO 4217 currency code                               | yes      | —                    | Default price currency. References `currencies.code`.                                                                                                                           |
| `lead_time_days_p50` | integer, at most 9 digits, ≥ 0                       | yes      | —                    | Typical lead time in calendar days.                                                                                                                                             |
| `lead_time_days_p90` | integer, at most 9 digits, ≥ 0                       | yes      | —                    | Slow lead time (90th percentile) in calendar days.                                                                                                                              |
| `is_active`          | `true` or `false`                                    | yes      | `true`               | false for inactive suppliers.                                                                                                                                                   |
| `work_calendar_code` | code (1-64 characters: letters, digits, `.` `_` `-`) | no       | empty                | Work calendar; empty for the country default (weekends and public holidays). References `work_calendars.work_calendar_code`. Optional trailing column: a file may leave it out. |

### `supplier_items.csv` → `public.supplier_items`

What each supplier sells: lead time, minimum order quantity, pack size and price.

Natural key: `supplier_code` + `item_code`. Load order 10.

Provided together: `unit_price` + `currency`.

Rules:

- `p90_below_p50`: `lead_time_days_p90` is empty or at least `lead_time_days`; a file may map either one, and the other keeps its stored value.
- `preferred_conflict`: At most one preferred supplier per item in the file; importing a preferred row clears the item's other preferred row.

| Column                 | Type                                                             | Required | Default for new rows | Description                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supplier_code`        | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | Supplier. References `suppliers.supplier_code`.                                                                                                                      |
| `item_code`            | part number (1-64 characters: letters, digits, `.` `_` `-` `/`)  | yes      | key                  | Item. References `items.item_code`.                                                                                                                                  |
| `supplier_part_number` | text, at most 100 characters                                     | no       | empty                | Supplier's own part number.                                                                                                                                          |
| `lead_time_days`       | integer, at most 9 digits, ≥ 0                                   | yes      | —                    | Planning lead time in calendar days.                                                                                                                                 |
| `lead_time_days_p90`   | integer, at most 9 digits, ≥ 0                                   | no       | empty                | Slow lead time in calendar days.                                                                                                                                     |
| `min_order_quantity`   | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0             | yes      | `0`                  | Minimum order quantity (0 = none).                                                                                                                                   |
| `pack_size`            | decimal, ≤ 12 integer and ≤ 3 fractional digits, > 0             | yes      | `1`                  | Order multiple.                                                                                                                                                      |
| `unit_price`           | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | yes      | —                    | Purchase price per unit.                                                                                                                                             |
| `currency`             | ISO 4217 currency code                                           | yes      | —                    | Currency of unit_price. References `currencies.code`.                                                                                                                |
| `is_preferred`         | `true` or `false`                                                | yes      | `false`              | Preferred source for the item (at most one per item).                                                                                                                |
| `valid_from`           | date, `YYYY-MM-DD`                                               | no       | empty                | Price valid from.                                                                                                                                                    |
| `unit_of_measure`      | one of `EA`, `SET`, `L`, `KG`                                    | no       | empty                | Source-supplied unit for MOQ, pack multiple and unit price; empty means unknown. Optional trailing column: a file may leave it out.                                  |
| `shipping_weight_kg`   | decimal, ≤ 9 integer and ≤ 6 fractional digits, > 0              | no       | empty                | Shipping weight in kg per supplied purchase unit, including apportioned packaging; empty means unknown. Optional trailing column: a file may leave it out.           |
| `shipping_volume_m3`   | decimal, ≤ 9 integer and ≤ 6 fractional digits, > 0              | no       | empty                | Shipping volume in cubic metres per supplied purchase unit, including apportioned packaging; empty means unknown. Optional trailing column: a file may leave it out. |
| `shipping_valid_from`  | date, `YYYY-MM-DD`                                               | no       | empty                | Separate effective-from date for shipping measurements; empty means unknown. Optional trailing column: a file may leave it out.                                      |

### `fx_rates.csv` → `public.fx_rates`

Exchange rates: 1 from_currency = rate to_currency from valid_from until the next row of the pair. One row per unordered pair and date; a reversed pair replaces the stored orientation when the file maps rate (otherwise the stored orientation and rate are kept).

Natural key: the unordered pair `from_currency` and `to_currency` + `valid_from`. Load order 11. Optional: a bundle may leave this file out.

Rules:

- `must_differ`: The two currencies differ.

| Column          | Type                                                  | Required | Default for new rows | Description                                            |
| --------------- | ----------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------ |
| `from_currency` | ISO 4217 currency code                                | yes      | key                  | Currency converted from. References `currencies.code`. |
| `to_currency`   | ISO 4217 currency code                                | yes      | key                  | Currency converted to. References `currencies.code`.   |
| `valid_from`    | date, `YYYY-MM-DD`                                    | yes      | key                  | First day the rate applies.                            |
| `rate`          | decimal, ≤ 10 integer and ≤ 10 fractional digits, > 0 | yes      | —                    | Units of to_currency per unit of from_currency.        |
| `note`          | text, at most 1000 characters                         | no       | empty                | Free text.                                             |

### `demand_history/YYYY-MM.csv` → `public.demand_history`

Daily demand per item and location. Only days with demand or lost sales appear; a missing day means zero.

Natural key: `item_code` + `location_code` + `demand_date`. Load order 12.

Rules:

- `date_outside_history_window`: `demand_date` falls in a month the database keeps demand for and is at most tomorrow.

| Column                | Type                                                            | Required | Default for new rows | Description                                                                                                        |
| --------------------- | --------------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `item_code`           | part number (1-64 characters: letters, digits, `.` `_` `-` `/`) | yes      | key                  | Item. References `items.item_code`.                                                                                |
| `location_code`       | code (1-64 characters: letters, digits, `.` `_` `-`)            | yes      | key                  | Location where the demand arose. References `locations.location_code`.                                             |
| `demand_date`         | date, `YYYY-MM-DD`                                              | yes      | key                  | Business day at the location.                                                                                      |
| `quantity`            | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0            | yes      | `0`                  | Quantity sold or issued.                                                                                           |
| `lost_sales_quantity` | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0            | yes      | `0`                  | Quantity requested but not served (stock-out).                                                                     |
| `unit_of_measure`     | one of `EA`, `SET`, `L`, `KG`                                   | no       | empty                | Source unit for sold and lost quantities; absent means unknown. Optional trailing column: a file may leave it out. |

### `stock_snapshots.csv` → `public.stock_snapshots`

Daily stock observations. Missing observations are unknown, not zero. The dashboard uses the latest observation on or before its reporting day for each item and location. Available stock is quantity minus allocated_quantity; allocations may exceed stock.

Natural key: `item_code` + `location_code` + `snapshot_date`. Load order 13. Optional: a bundle may leave this file out.

Provided together: `unit_cost` + `currency`.

| Column               | Type                                                             | Required | Default for new rows | Description                                                                                                                         |
| -------------------- | ---------------------------------------------------------------- | -------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `item_code`          | part number (1-64 characters: letters, digits, `.` `_` `-` `/`)  | yes      | key                  | Item. References `items.item_code`.                                                                                                 |
| `location_code`      | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | Stock location. References `locations.location_code`.                                                                               |
| `snapshot_date`      | date, `YYYY-MM-DD`                                               | yes      | key                  | Business date of the observation.                                                                                                   |
| `quantity`           | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0             | yes      | —                    | Physical units on hand.                                                                                                             |
| `allocated_quantity` | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0             | yes      | `0`                  | Units already allocated.                                                                                                            |
| `unit_cost`          | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | yes      | —                    | Inventory cost per physical unit.                                                                                                   |
| `currency`           | ISO 4217 currency code                                           | yes      | —                    | Cost currency. References `currencies.code`.                                                                                        |
| `unit_of_measure`    | one of `EA`, `SET`, `L`, `KG`                                    | no       | empty                | Source unit for physical/allocated quantity and unit cost; absent means unknown. Optional trailing column: a file may leave it out. |

### `open_orders.csv` → `public.open_orders`

Outstanding inbound order lines. Quantity is the remaining open quantity, not the original ordered quantity. Set it to zero or status to closed/canceled to retire a line; receipts do not automatically change orders or stock.

Natural key: `order_code` + `line_code`. Load order 14. Optional: a bundle may leave this file out.

Provided together: `unit_cost` + `currency`.

| Column            | Type                                                             | Required | Default for new rows | Description                                                                                                                |
| ----------------- | ---------------------------------------------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `order_code`      | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | External order reference.                                                                                                  |
| `line_code`       | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | External line reference, unique within the order.                                                                          |
| `item_code`       | part number (1-64 characters: letters, digits, `.` `_` `-` `/`)  | yes      | —                    | Item. References `items.item_code`.                                                                                        |
| `location_code`   | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | —                    | Stock location. References `locations.location_code`.                                                                      |
| `supplier_code`   | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | —                    | Supplier. References `suppliers.supplier_code`.                                                                            |
| `expected_date`   | date, `YYYY-MM-DD`                                               | yes      | —                    | Expected arrival business date.                                                                                            |
| `quantity`        | decimal, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0             | yes      | —                    | Remaining quantity.                                                                                                        |
| `unit_cost`       | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | yes      | —                    | Cost per unit.                                                                                                             |
| `currency`        | ISO 4217 currency code                                           | yes      | —                    | Cost currency. References `currencies.code`.                                                                               |
| `status`          | one of `open`, `closed`, `canceled`                              | yes      | `open`               | Current line status.                                                                                                       |
| `unit_of_measure` | one of `EA`, `SET`, `L`, `KG`                                    | no       | empty                | Source unit for remaining quantity and unit cost; absent means unknown. Optional trailing column: a file may leave it out. |

### `receipts.csv` → `public.receipts`

Inbound receipt lines, keyed by external receipt and line references. Corrections replace a line. Importing a receipt never increments a stock snapshot or decrements an open order; each feed remains authoritative.

Natural key: `receipt_code` + `line_code`. Load order 15. Optional: a bundle may leave this file out.

Provided together: `unit_cost` + `currency`.

| Column          | Type                                                             | Required | Default for new rows | Description                                           |
| --------------- | ---------------------------------------------------------------- | -------- | -------------------- | ----------------------------------------------------- |
| `receipt_code`  | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | External receipt reference.                           |
| `line_code`     | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | key                  | External line reference, unique within the receipt.   |
| `item_code`     | part number (1-64 characters: letters, digits, `.` `_` `-` `/`)  | yes      | —                    | Item. References `items.item_code`.                   |
| `location_code` | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | —                    | Stock location. References `locations.location_code`. |
| `supplier_code` | code (1-64 characters: letters, digits, `.` `_` `-`)             | yes      | —                    | Supplier. References `suppliers.supplier_code`.       |
| `receipt_date`  | date, `YYYY-MM-DD`                                               | yes      | —                    | Received business date.                               |
| `quantity`      | decimal, ≤ 12 integer and ≤ 3 fractional digits, > 0             | yes      | —                    | Units received.                                       |
| `unit_cost`     | money in `currency`, ≤ 12 integer and ≤ 3 fractional digits, ≥ 0 | yes      | —                    | Cost per received unit.                               |
| `currency`      | ISO 4217 currency code                                           | yes      | —                    | Cost currency. References `currencies.code`.          |

<!-- import-format:end -->

## How later steps use it

- Step 4 added `brands.csv` and replaced the free-text `brand` column of `items.csv` with `brand_code`, a reference to `brands.csv` (generator 1.1.0; the format version stays 1 because no customer bundles exist yet).
- Step 5 added the optional work calendars, holiday overrides, network links, item interchanges and fx rates, the optional trailing `work_calendar_code` of locations and suppliers, and made the supersession key the predecessor alone (one successor per predecessor). The generator's output is unchanged (still 1.1.0). The import wizard uploads files to Storage, maps customer columns onto this contract, validates every cell and rule in the database from `ingest.contract_*`, stages the rows and applies them to the tables above under the user's organization.
- Stock snapshots, open orders and receipts are optional entities. [Transaction semantics and retention](transactions-dashboard.md) explain how they feed the dashboard.
