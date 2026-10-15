import contractJson from '@maqdar/shared/import-format.schema.json'

/**
 * Typed view of the import contract (`engine/src/maqdar_engine/importformat.py`, exported as
 * `@maqdar/shared/import-format.schema.json` by `uv run maqdar-synth format --json --write`).
 * The JSON is the single source for entities, load order, column kinds, natural keys and groups;
 * nothing here restates it. Pure module (no server or browser APIs), so the parse worker, client
 * components, route handlers and Vitest can all load it.
 */

/** Column kinds of import format v1 (checked against the JSON's `kinds`). */
export const COLUMN_KINDS = [
  'code',
  'item_code',
  'text',
  'integer',
  'decimal',
  'money',
  'currency',
  'country',
  'date',
  'boolean',
  'enum',
  'weekdays',
  'timezone',
] as const

export type ColumnKind = (typeof COLUMN_KINDS)[number]

/** Entities in load order (parents before children); `ENTITY_NAMES` is checked against the JSON. */
export const ENTITY_NAMES = [
  'work_calendars',
  'holiday_overrides',
  'locations',
  'network_links',
  'brands',
  'items',
  'item_supersessions',
  'item_interchanges',
  'suppliers',
  'supplier_items',
  'fx_rates',
  'demand_history',
  'stock_snapshots',
  'open_orders',
  'receipts',
] as const

export type EntityName = (typeof ENTITY_NAMES)[number]

export type ContractColumn = {
  name: string
  kind: ColumnKind
  /** A provided cell must not be empty. */
  required: boolean
  /** Required, no default and not a key: new rows need the column mapped. */
  required_for_new: boolean
  natural_key: boolean
  /** An optional trailing column a file may leave out of its header. */
  omittable: boolean
  description: string
  /** Anchored syntax pattern (Postgres ARE, Python and JavaScript without the `v` flag). */
  pattern: string | null
  max_length: number | null
  scale: number | null
  integer_digits: number | null
  min_value: number | null
  max_value: number | null
  greater_than: number | null
  enum: readonly string[] | null
  /** The value a new row gets when the column is not provided ('' for weekdays means none). */
  default: string | null
  /** `table.column` the value must exist in (`countries.code`, `items.item_code`, …). */
  references: string | null
  /** The entity whose natural key this column looks up. */
  lookup: EntityName | null
  target_column: string
}

export type ContractRule = {
  code: string
  columns: readonly string[]
  /** The column the error is reported on. */
  column: string
  description: string
}

export type ContractEntity = {
  name: EntityName
  table: string
  file: string
  load_order: number
  required_in_bundle: boolean
  monthly_parts: boolean
  /** The first two key columns form an unordered pair (a,b) = (b,a). */
  unordered_pair: boolean
  description: string
  natural_key: readonly string[]
  /** Columns provided together or not at all. */
  column_groups: readonly (readonly string[])[]
  row_rules: readonly ContractRule[]
  set_rules: readonly ContractRule[]
  /** Rows per staged chunk (also the cap the SQL shape check enforces). */
  stage_rows: number
  merge_rows: number
  columns: readonly ContractColumn[]
}

export type ErrorLevel = 'error' | 'warning'

export type ImportContract = {
  format_version: number
  dialect: readonly string[]
  kinds: Record<
    ColumnKind,
    { description: string; pattern: string | null; error_code: string | null }
  >
  error_codes: readonly { code: string; level: ErrorLevel }[]
  entities: readonly ContractEntity[]
}

export const CONTRACT = contractJson as unknown as ImportContract

/**
 * Limits of the wizard (approved plan, "Limits"). The database enforces the batch, file, chunk
 * and cell caps again; these let the browser refuse early.
 */
export const IMPORT_LIMITS = {
  filesPerBatch: 60,
  rowsPerBatch: 1_000_000,
  /** Bytes per CSV, TSV or TXT file (the Storage bucket's limit). */
  fileBytes: 50_000_000,
  /** XLSX workbooks are parsed whole in the browser, so they get tighter caps. */
  xlsxBytes: 20_000_000,
  xlsxRows: 100_000,
  /** UTF-8 bytes of one chunk body (the route handlers cap request bodies at 1 MB). */
  chunkBytes: 1_000_000,
  /** Header columns a file may have (`import_files.header`). */
  headerColumns: 64,
  /**
   * Characters per staged cell (the chunk shape check in `import_stage_chunk`). It is above every
   * column's `max_length` (at most 1,000), so the database reports `too_long` per cell; only
   * longer cells are cut and reported as `cell_truncated`.
   */
  cellChars: 4_000,
  previewRows: 20,
} as const

const ENTITY_BY_NAME = new Map<string, ContractEntity>(
  CONTRACT.entities.map((entity) => [entity.name, entity]),
)

export function isEntityName(value: unknown): value is EntityName {
  return typeof value === 'string' && ENTITY_BY_NAME.has(value)
}

export function getEntity(name: EntityName): ContractEntity {
  const entity = ENTITY_BY_NAME.get(name)
  if (!entity) throw new Error(`Unknown import entity: ${name}`)
  return entity
}

/** Entities sorted by load order (parents first), as files are staged and merged. */
export function entitiesInLoadOrder(): ContractEntity[] {
  return [...CONTRACT.entities].sort((a, b) => a.load_order - b.load_order)
}

/** Sorts anything carrying an entity name into load order (stable for equal entities). */
export function compareLoadOrder(a: EntityName, b: EntityName): number {
  return getEntity(a).load_order - getEntity(b).load_order
}

export function getColumn(entity: EntityName, column: string): ContractColumn | undefined {
  return getEntity(entity).columns.find((candidate) => candidate.name === column)
}

/** Position of a column in contract order (0-based; staged cells are 1-based in SQL). */
export function columnIndex(entity: EntityName, column: string): number {
  return getEntity(entity).columns.findIndex((candidate) => candidate.name === column)
}

export function naturalKeyColumns(entity: EntityName): readonly string[] {
  return getEntity(entity).natural_key
}

export function columnGroups(entity: EntityName): readonly (readonly string[])[] {
  return getEntity(entity).column_groups
}

export type ImportErrorCode = string

const ERROR_LEVELS = new Map(CONTRACT.error_codes.map((entry) => [entry.code, entry.level]))

/** Stable machine codes of import errors and warnings (the CHECK list on `import_errors.code`). */
export function importErrorCodes(): string[] {
  return CONTRACT.error_codes.map((entry) => entry.code)
}

export function isImportErrorCode(value: unknown): value is ImportErrorCode {
  return typeof value === 'string' && ERROR_LEVELS.has(value)
}

export function errorLevel(code: string): ErrorLevel | undefined {
  return ERROR_LEVELS.get(code)
}

/* ------------------------------------------------------------------------------------------ */
/* File names                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type SourceFormat = 'csv' | 'xlsx'

/** CSV, TSV and TXT are read as delimited text; XLSX as a workbook. Anything else is refused. */
export function sourceFormatFor(fileName: string): SourceFormat | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1]?.toLowerCase()
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return 'csv'
  if (extension === 'xlsx') return 'xlsx'
  return null
}

// Other names people give these files. Matched after the entity names, on the normalized base name.
const FILE_NAME_ALIASES: Record<string, EntityName> = {
  calendars: 'work_calendars',
  calendar: 'work_calendars',
  work_calendar: 'work_calendars',
  holidays: 'holiday_overrides',
  holiday: 'holiday_overrides',
  holiday_override: 'holiday_overrides',
  location: 'locations',
  branches: 'locations',
  warehouses: 'locations',
  network: 'network_links',
  network_link: 'network_links',
  links: 'network_links',
  lanes: 'network_links',
  brand: 'brands',
  item: 'items',
  parts: 'items',
  supersessions: 'item_supersessions',
  supersession: 'item_supersessions',
  item_supersession: 'item_supersessions',
  interchanges: 'item_interchanges',
  interchange: 'item_interchanges',
  item_interchange: 'item_interchanges',
  alternates: 'item_interchanges',
  supplier: 'suppliers',
  vendors: 'suppliers',
  vendor: 'suppliers',
  supplier_item: 'supplier_items',
  supplier_parts: 'supplier_items',
  vendor_items: 'supplier_items',
  fx: 'fx_rates',
  fx_rate: 'fx_rates',
  exchange_rates: 'fx_rates',
  demand: 'demand_history',
  sales_history: 'demand_history',
}

const MONTH_PART = /^\d{4}[-_]\d{2}$/

function fileNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Guesses the entity of a file from its name or relative path (`items.csv`,
 * `demand_history/2026-01.csv`, `Supplier Items (2).xlsx`). Returns null when nothing fits; the
 * user picks the entity then.
 */
export function guessEntityFromFileName(path: string): EntityName | null {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const base = fileNameKey(parts.at(-1) ?? '')
  const folders = parts.slice(0, -1).map(fileNameKey)
  if (base === '') return null
  if (isEntityName(base)) return base
  if (Object.hasOwn(FILE_NAME_ALIASES, base)) return FILE_NAME_ALIASES[base] ?? null
  // Monthly demand parts: `2026-01.csv` (in a demand_history/ folder or alone), `demand_2026-01`.
  if (MONTH_PART.test(base)) return 'demand_history'
  if (folders.some((folder) => folder === 'demand_history' || folder === 'demand')) {
    return 'demand_history'
  }
  // A known name followed by a suffix (`items_export`, `demand_history_2026-01`): longest wins.
  const candidates = [
    ...ENTITY_NAMES.map((name) => [name, name] as const),
    ...Object.entries(FILE_NAME_ALIASES),
  ].filter(([key]) => base.startsWith(`${key}_`))
  candidates.sort((a, b) => b[0].length - a[0].length)
  return candidates[0]?.[1] ?? null
}

/* ------------------------------------------------------------------------------------------ */
/* Column labels                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * Message paths (in en.json / ar.json) whose text labels a contract column, used to match file
 * headers such as "Part code" or "رقم القطعة". Paths may point into another entity's namespace
 * when the entity has no label of its own. Every column is also looked up under
 * `ImportColumns.<entity>.<column>`, so labels can be added there without code changes.
 */
export const COLUMN_LABEL_PATHS: {
  readonly [E in EntityName]: Readonly<Record<string, readonly string[]>>
} = {
  work_calendars: {
    work_calendar_code: ['WorkCalendars.fields.code'],
    name_en: ['WorkCalendars.fields.name_en'],
    name_ar: ['WorkCalendars.fields.name_ar'],
    country_code: ['WorkCalendars.fields.country_code'],
    weekend_days: ['WorkCalendars.fields.weekend_days', 'WorkCalendars.columns.weekend_days'],
    observe_public_holidays: [
      'WorkCalendars.fields.observe_public_holidays',
      'WorkCalendars.columns.observe_public_holidays',
    ],
    is_active: ['WorkCalendars.fields.is_active'],
  },
  holiday_overrides: {
    country_code: ['Locations.fields.country_code'],
    work_calendar_code: ['Locations.fields.work_calendar_id'],
    starts_on: ['HolidayOverrides.fields.starts_on'],
    ends_on: ['HolidayOverrides.fields.ends_on'],
    kind: ['HolidayOverrides.fields.kind'],
    name_en: ['HolidayOverrides.fields.name_en'],
    name_ar: ['HolidayOverrides.fields.name_ar'],
    note: ['HolidayOverrides.fields.note'],
  },
  locations: {
    location_code: ['Locations.fields.code'],
    name_en: ['Locations.fields.name_en'],
    name_ar: ['Locations.fields.name_ar'],
    location_type: ['Locations.fields.location_type'],
    country_code: ['Locations.fields.country_code'],
    city: ['Locations.fields.city'],
    latitude: ['Locations.fields.latitude'],
    longitude: ['Locations.fields.longitude'],
    timezone: ['Locations.fields.timezone'],
    parent_location_code: ['Locations.fields.parent_location_id', 'Locations.columns.parent'],
    is_active: ['Locations.fields.is_active'],
    work_calendar_code: ['Locations.fields.work_calendar_id', 'Locations.columns.calendar'],
  },
  network_links: {
    from_location_code: ['NetworkLinks.fields.from_location_id', 'NetworkLinks.columns.from'],
    to_location_code: ['NetworkLinks.fields.to_location_id', 'NetworkLinks.columns.to'],
    lead_time_days_p50: [
      'NetworkLinks.fields.lead_time_days_p50',
      'NetworkLinks.columns.lead_time_days_p50',
    ],
    lead_time_days_p90: [
      'NetworkLinks.fields.lead_time_days_p90',
      'NetworkLinks.columns.lead_time_days_p90',
    ],
    freight_basis: ['NetworkLinks.fields.freight_basis'],
    freight_cost: ['NetworkLinks.fields.freight_cost'],
    currency: ['NetworkLinks.fields.currency'],
    is_active: ['NetworkLinks.fields.is_active'],
  },
  brands: {
    brand_code: ['Brands.fields.code'],
    name_en: ['Brands.fields.name_en'],
    name_ar: ['Brands.fields.name_ar'],
    brand_type: ['Brands.fields.brand_type'],
    country_of_origin: ['Brands.fields.country_of_origin', 'Brands.columns.country_of_origin'],
    is_active: ['Brands.fields.is_active'],
  },
  items: {
    item_code: ['Items.fields.code'],
    name_en: ['Items.fields.name_en'],
    name_ar: ['Items.fields.name_ar'],
    brand_code: ['Items.fields.brand_id'],
    product_group: ['Items.fields.product_group'],
    unit_of_measure: ['Items.fields.unit_of_measure'],
    unit_cost: ['Items.fields.unit_cost'],
    currency: ['Items.fields.currency'],
    status: ['Items.fields.status'],
    introduced_on: ['Items.fields.introduced_on'],
    discontinued_on: ['Items.fields.discontinued_on'],
  },
  item_supersessions: {
    predecessor_item_code: [
      'Supersessions.fields.predecessor_item_code',
      'Supersessions.columns.predecessor',
    ],
    successor_item_code: [
      'Supersessions.fields.successor_item_code',
      'Supersessions.columns.successor',
    ],
    effective_on: ['Supersessions.fields.effective_on'],
    quantity_factor: ['Supersessions.fields.quantity_factor'],
    note: ['Supersessions.fields.note'],
  },
  item_interchanges: {
    item_code: ['Interchanges.fields.item_code', 'Interchanges.columns.item'],
    alternate_item_code: [
      'Interchanges.fields.alternate_item_code',
      'Interchanges.columns.alternate',
    ],
    direction: ['Interchanges.fields.direction'],
    priority: ['Interchanges.fields.priority'],
    note: ['Interchanges.fields.note'],
  },
  suppliers: {
    supplier_code: ['Suppliers.fields.code'],
    name_en: ['Suppliers.fields.name_en'],
    name_ar: ['Suppliers.fields.name_ar'],
    country_code: ['Suppliers.fields.country_code'],
    currency: ['Suppliers.fields.currency'],
    lead_time_days_p50: [
      'Suppliers.fields.lead_time_days_p50',
      'Suppliers.columns.lead_time_days_p50',
    ],
    lead_time_days_p90: [
      'Suppliers.fields.lead_time_days_p90',
      'Suppliers.columns.lead_time_days_p90',
    ],
    is_active: ['Suppliers.fields.is_active'],
    work_calendar_code: ['Suppliers.fields.work_calendar_id', 'Suppliers.columns.calendar'],
  },
  supplier_items: {
    supplier_code: ['SupplierItems.fields.supplier_id', 'SupplierItems.columns.supplier'],
    item_code: ['SupplierItems.fields.item_code'],
    supplier_part_number: [
      'SupplierItems.fields.supplier_part_number',
      'SupplierItems.columns.supplier_part_number',
    ],
    lead_time_days: ['SupplierItems.fields.lead_time_days'],
    lead_time_days_p90: ['SupplierItems.fields.lead_time_days_p90'],
    min_order_quantity: [
      'SupplierItems.fields.min_order_quantity',
      'SupplierItems.columns.min_order_quantity',
    ],
    pack_size: ['SupplierItems.fields.pack_size'],
    unit_price: ['SupplierItems.fields.unit_price'],
    currency: ['SupplierItems.fields.currency'],
    is_preferred: ['SupplierItems.fields.is_preferred', 'SupplierItems.columns.is_preferred'],
    valid_from: ['SupplierItems.fields.valid_from'],
  },
  fx_rates: {
    from_currency: ['FxRates.fields.from_currency'],
    to_currency: ['FxRates.fields.to_currency'],
    valid_from: ['FxRates.fields.valid_from'],
    rate: ['FxRates.fields.rate'],
    note: ['FxRates.fields.note'],
  },
  demand_history: {
    item_code: ['Items.fields.code'],
    unit_of_measure: ['Items.fields.unit_of_measure'],
  },
  stock_snapshots: { unit_of_measure: ['Items.fields.unit_of_measure'] },
  open_orders: {},
  receipts: {},
}

function messageAt(messages: unknown, path: string): string | undefined {
  let node: unknown = messages
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'string' && node.trim() !== '' ? node : undefined
}

/** Every message path that may label a column (the explicit ones, then `ImportColumns`). */
export function columnLabelPaths(entity: EntityName, column: string): string[] {
  return [...(COLUMN_LABEL_PATHS[entity][column] ?? []), `ImportColumns.${entity}.${column}`]
}

/**
 * Labels per contract column of an entity, read from one or more message files (pass the English
 * and Arabic messages to match headers in either language). Duplicates are dropped; columns
 * without a label get an empty list.
 */
export function columnLabels(
  entity: EntityName,
  ...messageFiles: unknown[]
): Record<string, string[]> {
  const labels: Record<string, string[]> = {}
  for (const column of getEntity(entity).columns) {
    const found = new Set<string>()
    for (const messages of messageFiles) {
      for (const path of columnLabelPaths(entity, column.name)) {
        const text = messageAt(messages, path)
        if (text !== undefined) found.add(text)
      }
    }
    labels[column.name] = [...found]
  }
  return labels
}
