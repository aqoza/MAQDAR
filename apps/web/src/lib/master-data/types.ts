/**
 * The entity definition contract
 * ==============================
 *
 * Every master-data screen (list, new, edit, delete) is driven by one `EntityDefinition` in
 * `entities/<entity>.ts`, registered in `registry.ts`. Route files stay thin wrappers around
 * `ListScreen` / `EditScreen` (src/components/master-data), and the single `'use server'` module
 * `actions.ts` saves and deletes any registered entity. A definition is plain data plus three
 * functions, with no server-only imports, so Vitest can load it.
 *
 * - Identity: `key` (registry key and hidden `entity` form field), `table`, `basePath` (list URL;
 *   `/new` and `/<uuid>` hang below it), `namespace` (its en.json namespace), `area` + `tab` (which
 *   area tab is current).
 * - Reading: `listSelect` / `editSelect` are PostgREST selects. Embeds name the composite foreign
 *   key explicitly (`brand:brands!items_brand_fkey(code,name_en)`), because tenant tables have more
 *   than one path between them. Every query adds `.eq('organization_id', active org)` itself.
 * - List: `list` (list-params.ts) allow-lists sort columns (each leading an index that ends in the
 *   tiebreaker), filters and search; `columns` declare the cells (kinds below; `sortBy` when the
 *   header sorts by another column, e.g. name → name_en); `filterOptions` names the option source
 *   of `uuid` / `pattern` filters. Search matches `search_text`, or for tables that reference
 *   items without one, `itemSearchColumns` (rows pointing at matching items). `enrichRows`
 *   (optional) adds what no embed can express to a page's rows (a location's parent).
 *   `importEntity` (optional) names the table's import-format entity, which gives editors an
 *   "Import" link to `/imports/new?entity=<entity>` on the list.
 * - Form: `fields` declare inputs in display order; `schema` (zod, server-only use) parses the
 *   submitted strings; `toRow` turns the parsed input into the row to insert or update. Part-code
 *   fields (kind `itemCode`) resolve with `resolveItemCodeFields(ctx, {...})` from item-codes.ts,
 *   which returns `unknownItem` field errors. `toForm` (optional) maps a stored row back to input
 *   values (e.g. an embedded item's code); `defaults` (optional) seeds `/new`.
 * - Errors: `constraintFields` maps constraint names to the field that shows a 23505 / 23503 /
 *   23514 / 23P01 error, and `constraintMessages` (optional) replaces the default message of such
 *   a field error; `hintMessages` picks the message for MQ422 errors whose hint names a field.
 *
 * Messages in the entity namespace (labels are resolved on the server and passed to client
 * components as props, so entity namespaces never ship to the browser):
 *   title, description, newTitle, searchPlaceholder?, deleteWarning?,
 *   columns.<column key>, fields.<field name>, hints.<field name>?, filters.<param>,
 *   options.<field or filter column>.<value> (enum and boolean labels).
 */
import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import type { Messages } from '../../i18n/messages'
import type { EntityName as ImportEntityName } from '../imports/contract'
import type { ListSpec } from './list-params'

export type TableName = keyof Database['public']['Tables'] & string

/** A namespace of en.json (entity namespaces are checked against the message file). */
export type EntityNamespace = keyof Messages & string

export type AreaKey = 'items' | 'locations' | 'suppliers'

/** Reference data rendered as server-side select options (see query.ts `loadOptions`). */
export type OptionSourceKey =
  | 'currencies'
  | 'countries'
  | 'brands'
  | 'locations'
  | 'suppliers'
  | 'work_calendars'
  /** Holiday override scopes: `country:<code>` for each country, then `calendar:<id>`. */
  | 'holiday_scopes'

export type OptionsSpec =
  /** Fixed values; labels from `<namespace>.options.<field>.<value>`. */
  | { source: 'enum'; values: readonly string[] }
  /** Rows loaded per request (organization-scoped tables are filtered by the active org). */
  | { source: OptionSourceKey }

export type FieldKind =
  | 'code' // natural key: LTR, monospace
  | 'text'
  | 'textarea'
  | 'nameAr' // RTL, lang="ar"
  | 'select' // NativeSelect over `options`
  | 'switch' // boolean; submits 'on' when checked
  | 'date' // YYYY-MM-DD
  | 'integer'
  | 'decimal'
  | 'weekdays' // ISO weekday checkboxes (1 = Monday); submits repeated values
  | 'itemCode' // part code with a datalist from /api/lookup/items

export type FieldDef = {
  name: string
  kind: FieldKind
  required?: boolean
  options?: OptionsSpec
  maxLength?: number
  /** Spans both columns of the form grid. */
  wide?: boolean
  /** Shows `<namespace>.hints.<name>` under the input. */
  hint?: boolean
  /** Select of the entity's own table: leaves the edited row out of the options (a parent). */
  excludeSelf?: boolean
}

export type CellKind =
  | 'code' // <bdi dir="ltr">, monospace
  | 'name' // name_en + name_ar (Arabic in lang="ar" dir="rtl"), locale picks the first
  | 'text'
  | 'badge' // enum value labelled from options.<field>.<value>
  | 'boolean'
  | 'money' // with `currencyField`
  | 'quantity' // up to 3 decimals
  | 'integer'
  | 'rate' // up to 10 decimals
  | 'date' // date-only column, never shifted by the time zone
  | 'weekdays' // ISO weekday numbers as short day names
  | 'ref' // an embedded row: shows its code (title = its name_en)

export type ColumnDef = {
  /** Header label `<namespace>.columns.<key>`. */
  key: string
  kind: CellKind
  /** Row property (default `key`). For `ref`, the embed alias (e.g. `brand`). */
  field?: string
  /** The header sorts the list by `sortBy` (default `key`), which must be in `list.sorts`. */
  sortable?: boolean
  sortBy?: string
  /** Money: the row property holding the ISO currency. */
  currencyField?: string
  /** Links the cell to the edit page (the first code column, else the name). */
  link?: boolean
}

export type EntityRow = Record<string, unknown>

export type FormValue = string | boolean | string[]

export type EntityContext = {
  supabase: SupabaseClient<Database>
  organizationId: string
  /** The row being updated (null or absent when creating). */
  id?: string | null
  /** Its `updated_at` exactly as the form read it (updates only). */
  updatedAt?: string | null
}

export type DefaultsContext = {
  /** The active organization (base_currency, home_country, …). */
  organization: { base_currency: string; home_country: string }
}

/** Keys of MasterData.errors usable as field messages from `toRow`. */
export type MasterDataErrorKey = keyof Messages['MasterData']['errors']

export type ToRowResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, MasterDataErrorKey> }

export type EntityDefinition<TInput = unknown> = {
  key: string
  table: TableName
  namespace: EntityNamespace
  area: AreaKey
  tab: string
  basePath: string
  /** The import-format entity of this table: the list shows editors an "Import" link. */
  importEntity?: ImportEntityName
  listSelect: string
  editSelect: string
  list: ListSpec
  columns: readonly ColumnDef[]
  /**
   * For tables without `search_text` that reference items: the item-id columns a search matches.
   * The search finds up to ITEM_SEARCH_LIMIT items by code or name (item-codes.ts) and the list
   * keeps rows whose columns hold one of them. Needs `list.search: true`.
   */
  itemSearchColumns?: readonly string[]
  /** Option sources for `uuid` (or `pattern`) filters, by filter param. */
  filterOptions?: Record<string, OptionSourceKey>
  /**
   * Adds to a list page what an embed cannot express, with at most one extra query: e.g. the
   * parent of a self-referencing composite foreign key, which PostgREST does not embed
   * many-to-one. Runs after the page is fetched; returns the rows to render.
   */
  enrichRows?(rows: EntityRow[], ctx: EntityContext): EntityRow[] | Promise<EntityRow[]>
  fields: readonly FieldDef[]
  schema: z.ZodType<TInput>
  /** The parsed input as the row to write (without organization_id). */
  toRow(input: TInput, ctx: EntityContext): ToRowResult | Promise<ToRowResult>
  /** The stored row as form values (default: each field's column, numbers as plain text). */
  toForm?(row: EntityRow): Record<string, FormValue>
  /** Initial values on `/new`. */
  defaults?(ctx: DefaultsContext): Record<string, FormValue>
  /** Heading of the edit page (usually the code). */
  titleOf(row: EntityRow): string
  constraintFields?: Record<string, string>
  /** Constraint name → message of its field error (default by SQLSTATE, e.g. `duplicate`). */
  constraintMessages?: Record<string, MasterDataErrorKey>
  /** MQ422 hint (a field name) → message; default `MasterData.errors.invalid`. */
  hintMessages?: Record<string, MasterDataErrorKey>
}

/** Identity helper that keeps the input type of `schema` and `toRow` in step. */
export function defineEntity<TInput>(
  definition: EntityDefinition<TInput>,
): EntityDefinition<TInput> {
  return definition
}
