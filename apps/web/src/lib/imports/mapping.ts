import { IMPORT_LIMITS, getEntity, type ContractEntity, type EntityName } from './contract'

/**
 * Maps a file's header onto the contract columns of an entity. Automatic matching runs in three
 * tiers and never overrides an earlier one: the contract name (ignoring case, spaces, underscores
 * and punctuation), then an English or Arabic label (from the message files, plus a few built-in
 * synonyms), then the organization's previous mapping for the entity. The user can change every
 * match. `checkMapping` enforces the natural key and the column groups. Pure module.
 */

export type MatchSource = 'name' | 'label' | 'previous' | 'manual'

/** Contract column → the header column (index) that provides it. Unmapped columns are absent. */
export type ColumnMapping = Record<string, { index: number; source: MatchSource }>

/** Labels per contract column (`columnLabels(entity, en, ar)` from contract.ts). */
export type ColumnLabels = Readonly<Record<string, readonly string[]>>

/** A stored mapping (`import_files.mapping`): contract column → source header text. */
export type StoredMapping = Readonly<Record<string, string>>

const char = (codePoint: number) => String.fromCodePoint(codePoint)
const ARABIC_MARKS = new RegExp(
  `[${char(0x0640)}${char(0x064b)}-${char(0x065f)}${char(0x0670)}]`,
  'g',
)
const ALEF_FORMS = /[أإآٱ]/g
const DIGIT_ZEROS = [0x0660, 0x06f0]

/**
 * The comparison key of a header, name or label: NFKC, lower case, Arabic-Indic digits as ASCII,
 * Arabic diacritics and tatweel removed, alef forms, alef maqsura and taa marbuta folded, and
 * everything that is not a letter or digit dropped (`Lead time (p50, days)` → `leadtimep50days`).
 */
export function headerKey(text: string): string {
  let folded = ''
  for (const character of text.normalize('NFKC')) {
    const code = character.codePointAt(0) ?? 0
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9)
    folded += zero === undefined ? character : String(code - zero)
  }
  return folded
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(ALEF_FORMS, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * A small set of synonyms by column name (any entity), for exports that do not use ZeeSpare's
 * labels. English and Arabic; matched like labels.
 */
export const BUILT_IN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  item_code: [
    'part number',
    'part no',
    'part',
    'sku',
    'item',
    'item number',
    'رقم الصنف',
    'كود الصنف',
    'كود القطعة',
    'الصنف',
  ],
  location_code: [
    'location',
    'location code',
    'branch',
    'warehouse',
    'الموقع',
    'رمز الموقع',
    'كود الموقع',
    'الفرع',
    'المستودع',
  ],
  supplier_code: ['supplier', 'vendor', 'المورد', 'رمز المورد', 'كود المورد'],
  brand_code: ['brand', 'make', 'العلامة التجارية', 'الماركة'],
  demand_date: ['date', 'demand date', 'sales date', 'التاريخ', 'تاريخ الطلب', 'تاريخ البيع'],
  quantity: [
    'qty',
    'demand',
    'demand quantity',
    'sales quantity',
    'الكمية',
    'الطلب',
    'الكمية المباعة',
  ],
  lost_sales_quantity: [
    'lost sales',
    'lost qty',
    'lost quantity',
    'المبيعات المفقودة',
    'الكمية المفقودة',
  ],
  name_en: ['name', 'english name', 'description', 'الاسم الإنجليزي', 'الاسم بالإنجليزية'],
  name_ar: ['arabic name', 'arabic description', 'الاسم العربي', 'الاسم بالعربية', 'الوصف'],
  currency: ['currency code', 'العملة'],
  country_code: ['country', 'الدولة', 'البلد'],
  unit_cost: ['cost', 'التكلفة'],
  unit_price: ['price', 'السعر'],
  city: ['المدينة'],
  status: ['الحالة'],
  is_active: ['active', 'نشط'],
  note: ['notes', 'comment', 'ملاحظة', 'ملاحظات'],
}

/** Comparison keys of the labels and synonyms of each column; keys shared by columns dropped. */
function labelIndex(entity: ContractEntity, labels: ColumnLabels): Map<string, string> {
  const owners = new Map<string, Set<string>>()
  for (const column of entity.columns) {
    const texts = [...(labels[column.name] ?? []), ...(BUILT_IN_SYNONYMS[column.name] ?? [])]
    for (const text of texts) {
      const key = headerKey(text)
      if (key === '') continue
      const set = owners.get(key) ?? new Set<string>()
      set.add(column.name)
      owners.set(key, set)
    }
  }
  const index = new Map<string, string>()
  for (const [key, columns] of owners) {
    if (columns.size === 1) index.set(key, [...columns][0] ?? '')
  }
  return index
}

export type AutoMapOptions = {
  labels?: ColumnLabels
  previous?: StoredMapping | null
}

/**
 * Matches header columns to contract columns. Within a tier the first header wins a column, and
 * a header matches at most one column. Blank headers never match automatically.
 */
export function autoMap(
  entityName: EntityName,
  header: readonly string[],
  options: AutoMapOptions = {},
): ColumnMapping {
  const entity = getEntity(entityName)
  const mapping: ColumnMapping = {}
  const usedHeaders = new Set<number>()
  const keys = header.map(headerKey)

  const assign = (column: string, index: number, source: MatchSource) => {
    if (Object.hasOwn(mapping, column) || usedHeaders.has(index)) return
    mapping[column] = { index, source }
    usedHeaders.add(index)
  }

  // 1. Contract names.
  const byName = new Map(entity.columns.map((column) => [headerKey(column.name), column.name]))
  keys.forEach((key, index) => {
    const column = byName.get(key)
    if (key !== '' && column !== undefined) assign(column, index, 'name')
  })

  // 2. Labels and synonyms.
  const byLabel = labelIndex(entity, options.labels ?? {})
  keys.forEach((key, index) => {
    const column = byLabel.get(key)
    if (key !== '' && column !== undefined) assign(column, index, 'label')
  })

  // 3. The previous mapping: exact header text first, then the comparison key, unambiguous only.
  for (const [column, previousHeader] of Object.entries(options.previous ?? {})) {
    if (!entity.columns.some((candidate) => candidate.name === column)) continue
    if (typeof previousHeader !== 'string' || previousHeader.trim() === '') continue
    const exact = header.flatMap((text, index) =>
      text.trim() === previousHeader.trim() && !usedHeaders.has(index) ? [index] : [],
    )
    const loose = keys.flatMap((key, index) =>
      key !== '' && key === headerKey(previousHeader) && !usedHeaders.has(index) ? [index] : [],
    )
    const candidates = exact.length > 0 ? exact : loose
    if (candidates.length === 1 && candidates[0] !== undefined) {
      assign(column, candidates[0], 'previous')
    }
  }

  // Contract order, so the mapping reads like the template.
  const ordered: ColumnMapping = {}
  for (const column of entity.columns) {
    const entry = mapping[column.name]
    if (entry) ordered[column.name] = entry
  }
  return ordered
}

/** Maps (or unmaps, with null) one column by hand; the header leaves any other column. */
export function setMapping(
  mapping: ColumnMapping,
  column: string,
  index: number | null,
): ColumnMapping {
  const next: ColumnMapping = {}
  for (const [name, entry] of Object.entries(mapping)) {
    if (name !== column && entry.index !== index) next[name] = entry
  }
  if (index !== null) next[column] = { index, source: 'manual' }
  return next
}

export type MappingIssue =
  /** A natural-key column is not mapped (error). */
  | { code: 'key_unmapped'; level: 'error'; column: string }
  /** Some columns of a "provided together" group are mapped, others not (error). */
  | { code: 'group_incomplete'; level: 'error'; group: readonly string[]; missing: string[] }
  /** One header column feeds two contract columns (error). */
  | { code: 'duplicate_source'; level: 'error'; columns: string[]; index: number }
  /** A mapped header index does not exist (error). */
  | { code: 'unknown_source'; level: 'error'; column: string; index: number }
  /** Demand without a quantity column would only delete days (error). */
  | { code: 'value_column_required'; level: 'error'; columns: string[] }
  /** The file has more header columns than an import may store (error). */
  | { code: 'too_many_columns'; level: 'error'; count: number; max: number }
  /** A column new rows need is not mapped: new keys will be rejected (warning). */
  | { code: 'required_for_new_unmapped'; level: 'warning'; column: string }
  /** An optional column is not mapped; the UI explains defaults and the source-unit safeguard. */
  | { code: 'unmapped_optional'; level: 'info'; column: string; default: string | null }
  /** A header column feeds nothing and is ignored (info). */
  | { code: 'unmapped_header'; level: 'info'; index: number; header: string }

/** Checks a mapping against the contract rules for an entity. Errors block the import. */
export function checkMapping(
  entityName: EntityName,
  header: readonly string[],
  mapping: ColumnMapping,
): MappingIssue[] {
  const entity = getEntity(entityName)
  const issues: MappingIssue[] = []
  const mapped = (column: string) => Object.hasOwn(mapping, column)

  if (header.length > IMPORT_LIMITS.headerColumns) {
    issues.push({
      code: 'too_many_columns',
      level: 'error',
      count: header.length,
      max: IMPORT_LIMITS.headerColumns,
    })
  }
  for (const key of entity.natural_key) {
    if (!mapped(key)) issues.push({ code: 'key_unmapped', level: 'error', column: key })
  }
  for (const group of entity.column_groups) {
    const missing = group.filter((column) => !mapped(column))
    if (missing.length > 0 && missing.length < group.length) {
      issues.push({ code: 'group_incomplete', level: 'error', group, missing })
    }
  }
  const byIndex = new Map<number, string[]>()
  for (const [column, entry] of Object.entries(mapping)) {
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= header.length) {
      issues.push({ code: 'unknown_source', level: 'error', column, index: entry.index })
      continue
    }
    byIndex.set(entry.index, [...(byIndex.get(entry.index) ?? []), column])
  }
  for (const [index, columns] of byIndex) {
    if (columns.length > 1)
      issues.push({ code: 'duplicate_source', level: 'error', columns, index })
  }
  if (entity.monthly_parts) {
    const values = ['quantity', 'lost_sales_quantity']
    if (!values.some(mapped)) {
      issues.push({ code: 'value_column_required', level: 'error', columns: values })
    }
  }
  for (const column of entity.columns) {
    if (column.natural_key || mapped(column.name)) continue
    if (column.required_for_new) {
      issues.push({ code: 'required_for_new_unmapped', level: 'warning', column: column.name })
    } else {
      issues.push({
        code: 'unmapped_optional',
        level: 'info',
        column: column.name,
        default: column.default,
      })
    }
  }
  header.forEach((text, index) => {
    if (!byIndex.has(index))
      issues.push({ code: 'unmapped_header', level: 'info', index, header: text })
  })
  return issues
}

export function hasBlockingIssues(issues: readonly MappingIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error')
}

/** The provided contract columns in contract order (`import_files.columns`). */
export function providedColumns(entityName: EntityName, mapping: ColumnMapping): string[] {
  return getEntity(entityName)
    .columns.filter((column) => Object.hasOwn(mapping, column.name))
    .map((column) => column.name)
}

/** Source column index per contract column, null when not provided (for `normalizeRow`). */
export function sourceIndexes(entityName: EntityName, mapping: ColumnMapping): (number | null)[] {
  return getEntity(entityName).columns.map((column) => mapping[column.name]?.index ?? null)
}

/** The mapping as stored for reuse (`import_files.mapping`): contract column → header text. */
export function storedMapping(
  entityName: EntityName,
  header: readonly string[],
  mapping: ColumnMapping,
): Record<string, string> {
  const stored: Record<string, string> = {}
  for (const column of providedColumns(entityName, mapping)) {
    const index = mapping[column]?.index
    if (index !== undefined && header[index] !== undefined) stored[column] = header[index]
  }
  return stored
}
