# Import format v1

The CSV bundle MAQDAR imports master data and demand history from. The synthetic data generator writes it, the loader reads it, and the Step 5 import wizard will accept the same files from customers. The contract lives in code (`engine/src/maqdar_engine/importformat.py`); the column tables below are generated from it and a test fails when they drift. A machine-readable copy is in [`import-format.schema.json`](import-format.schema.json).

## Scope and keys

- A bundle belongs to one organization. No file carries an organization id: the importing user's organization is applied on load.
- Rows are identified by natural keys (codes), never by database ids. The loader derives ids deterministically from the organization and the code, so reloading a bundle is idempotent.
- Files are loaded in the order of the tables below so every reference resolves: locations, items, item supersessions, suppliers, supplier items, demand history.
- `manifest.json` lists every file with its row count and sha256 and records the generator version, seed, window and organization. The loader verifies it before writing anything.
- `_truth/` (generator ground truth) is not part of the format and is never loaded.

## Dialect

- UTF-8 without a byte-order mark; LF line endings.
- RFC 4180 quoting: fields containing commas, quotes or newlines are wrapped in double quotes, inner quotes doubled.
- One header row whose names and order equal the column tables below (the loader validates with `COPY … HEADER MATCH`).
- Dates are `YYYY-MM-DD`. Timestamps (none in v1) would be `YYYY-MM-DDTHH:MM:SSZ` in UTC.
- Numbers use a dot decimal separator and no thousands separators; money and quantities carry at most 3 fractional digits.
- Booleans are the literals `true` and `false`.
- An empty field means NULL; required columns must not be empty.
- `demand_history` is split into monthly parts named `YYYY-MM.csv` under a `demand_history/` folder; a single `demand_history.csv` with the same header is also accepted. Only days with demand or lost sales appear; a missing day means zero.

## Files

<!-- import-format:begin -->

### `locations.csv` → `public.locations`

Warehouses, regional hubs and branches of the network.

Natural key: `location_code`.

| Column                 | Type                                                     | Required | Description                                                                                          |
| ---------------------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `location_code`        | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Unique location code.                                                                                |
| `name_en`              | text                                                     | yes      | English name (required).                                                                             |
| `name_ar`              | text                                                     | no       | Arabic name.                                                                                         |
| `location_type`        | one of `central`, `hub`, `branch`                        | yes      | Role in the network.                                                                                 |
| `country_code`         | char(2) ISO 3166-1 alpha-2 code                          | yes      | Country of the location (drives weekends and holidays). References `countries.code`.                 |
| `city`                 | text                                                     | no       | City.                                                                                                |
| `latitude`             | numeric, at most 6 fractional digits                     | no       | Decimal degrees.                                                                                     |
| `longitude`            | numeric, at most 6 fractional digits                     | no       | Decimal degrees.                                                                                     |
| `timezone`             | text                                                     | yes      | IANA time zone, e.g. Asia/Riyadh.                                                                    |
| `parent_location_code` | text (natural key, 1-64 chars, letters, digits, . _ - /) | no       | Default replenishment source; empty for the central warehouse. References `locations.location_code`. |
| `is_active`            | true or false                                            | yes      | false for closed locations.                                                                          |

### `items.csv` → `public.items`

Service parts.

Natural key: `item_code`.

| Column            | Type                                                             | Required | Description                                          |
| ----------------- | ---------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `item_code`       | text (natural key, 1-64 chars, letters, digits, . _ - /)         | yes      | Unique part number.                                  |
| `name_en`         | text                                                             | yes      | English name (required).                             |
| `name_ar`         | text                                                             | no       | Arabic name.                                         |
| `brand`           | text                                                             | no       | Brand or make.                                       |
| `product_group`   | text                                                             | yes      | Planning group, e.g. battery, oil_filter.            |
| `unit_of_measure` | one of `EA`, `SET`, `L`, `KG`                                    | yes      | Stocking unit.                                       |
| `unit_cost`       | numeric(18,3) in the row's currency, at most 3 fractional digits | yes      | Standard cost per unit.                              |
| `currency`        | char(3) ISO 4217 code                                            | yes      | Currency of unit_cost. References `currencies.code`. |
| `status`          | one of `new`, `active`, `phase_out`, `discontinued`              | yes      | Lifecycle status.                                    |
| `introduced_on`   | date, YYYY-MM-DD                                                 | no       | First day the item was available.                    |
| `discontinued_on` | date, YYYY-MM-DD                                                 | no       | Last day the item was available.                     |

### `item_supersessions.csv` → `public.item_supersessions`

Part replacements: demand for the predecessor moves to the successor from effective_on.

Natural key: `predecessor_item_code`, `successor_item_code`.

| Column                  | Type                                                     | Required | Description                                                             |
| ----------------------- | -------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `predecessor_item_code` | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Replaced item. References `items.item_code`.                            |
| `successor_item_code`   | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Replacing item. References `items.item_code`.                           |
| `effective_on`          | date, YYYY-MM-DD                                         | yes      | First day the successor replaces the predecessor.                       |
| `quantity_factor`       | numeric(18,3), at most 3 fractional digits               | yes      | Units of successor per unit of predecessor (1 unless the pack changes). |
| `note`                  | text                                                     | no       | Free text.                                                              |

### `suppliers.csv` → `public.suppliers`

Suppliers and their typical lead times.

Natural key: `supplier_code`.

| Column               | Type                                                     | Required | Description                                           |
| -------------------- | -------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `supplier_code`      | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Unique supplier code.                                 |
| `name_en`            | text                                                     | yes      | English name (required).                              |
| `name_ar`            | text                                                     | no       | Arabic name.                                          |
| `country_code`       | char(2) ISO 3166-1 alpha-2 code                          | yes      | Country the supplier ships from (any ISO code).       |
| `currency`           | char(3) ISO 4217 code                                    | yes      | Default price currency. References `currencies.code`. |
| `lead_time_days_p50` | integer                                                  | yes      | Typical lead time in calendar days.                   |
| `lead_time_days_p90` | integer                                                  | yes      | Slow lead time (90th percentile) in calendar days.    |
| `is_active`          | true or false                                            | yes      | false for inactive suppliers.                         |

### `supplier_items.csv` → `public.supplier_items`

What each supplier sells: lead time, minimum order quantity, pack size and price.

Natural key: `supplier_code`, `item_code`.

| Column                 | Type                                                             | Required | Description                                           |
| ---------------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `supplier_code`        | text (natural key, 1-64 chars, letters, digits, . _ - /)         | yes      | Supplier. References `suppliers.supplier_code`.       |
| `item_code`            | text (natural key, 1-64 chars, letters, digits, . _ - /)         | yes      | Item. References `items.item_code`.                   |
| `supplier_part_number` | text                                                             | no       | Supplier's own part number.                           |
| `lead_time_days`       | integer                                                          | yes      | Planning lead time in calendar days.                  |
| `lead_time_days_p90`   | integer                                                          | no       | Slow lead time in calendar days.                      |
| `min_order_quantity`   | numeric(18,3), at most 3 fractional digits                       | yes      | Minimum order quantity (0 = none).                    |
| `pack_size`            | numeric(18,3), at most 3 fractional digits                       | yes      | Order multiple.                                       |
| `unit_price`           | numeric(18,3) in the row's currency, at most 3 fractional digits | yes      | Purchase price per unit.                              |
| `currency`             | char(3) ISO 4217 code                                            | yes      | Currency of unit_price. References `currencies.code`. |
| `is_preferred`         | true or false                                                    | yes      | Preferred source for the item (exactly one per item). |
| `valid_from`           | date, YYYY-MM-DD                                                 | no       | Price valid from.                                     |

### `demand_history/YYYY-MM.csv` → `public.demand_history`

Daily demand per item and location. Only days with demand or lost sales appear; a missing day means zero.

Natural key: `item_code`, `location_code`, `demand_date`.

| Column                | Type                                                     | Required | Description                                                            |
| --------------------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `item_code`           | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Item. References `items.item_code`.                                    |
| `location_code`       | text (natural key, 1-64 chars, letters, digits, . _ - /) | yes      | Location where the demand arose. References `locations.location_code`. |
| `demand_date`         | date, YYYY-MM-DD                                         | yes      | Business day at the location.                                          |
| `quantity`            | numeric(18,3), at most 3 fractional digits               | yes      | Quantity sold or issued.                                               |
| `lost_sales_quantity` | numeric(18,3), at most 3 fractional digits               | yes      | Quantity requested but not served (stock-out).                         |

<!-- import-format:end -->

## How later steps use it

- Step 4 adds brands, interchanges, network links, fx rates and work calendars as further files with the same conventions.
- Step 5's import wizard uploads these files to Storage, maps customer columns onto this contract, validates with the same rules as `maqdar-synth validate`, stages the rows and applies them to the tables above under the user's organization.
- Step 6 adds stock snapshots, open orders and receipts.
