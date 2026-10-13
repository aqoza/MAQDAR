import {
  contentTypeFor,
  extensionOf,
  type FileManifest,
  type FileState,
} from '../../lib/imports/client'
import {
  IMPORT_LIMITS,
  compareLoadOrder,
  getEntity,
  guessEntityFromFileName,
  type EntityName,
} from '../../lib/imports/contract'
import type { Delimiter, DelimiterChoice } from '../../lib/imports/csv'
import type { EncodingChoice } from '../../lib/imports/encoding'
import {
  autoMap,
  checkMapping,
  providedColumns,
  sourceIndexes,
  storedMapping,
  type ColumnMapping,
  type ColumnLabels,
  type MappingIssue,
  type StoredMapping,
} from '../../lib/imports/mapping'
import type { DateOrder, DecimalSeparator } from '../../lib/imports/normalize'
import type { InspectResult, ParseRequest } from '../../lib/imports/parse'

/**
 * State and pure helpers of the import wizard (files, their format choices and mappings), kept
 * out of the component so they can be tested. Nothing here touches the network or the DOM.
 */

export type FileOptions = {
  encoding: EncodingChoice
  delimiter: DelimiterChoice
  sheet: string | null
  decimalSeparator: DecimalSeparator
  dateOrder: DateOrder
}

export const DEFAULT_FILE_OPTIONS: FileOptions = {
  encoding: 'auto',
  delimiter: 'auto',
  sheet: null,
  decimalSeparator: '.',
  dateOrder: 'YYYY-MM-DD',
}

/** Why a file cannot be read (ParseFailure codes: unsupported_type, too_large, …, internal). */
export type FileFailure = { code: string; detail?: Record<string, string | number> }

export type WizardFile = {
  id: string
  file: File
  entity: EntityName | null
  options: FileOptions
  inspect: InspectResult | null
  inspecting: boolean
  failure: FileFailure | null
  mapping: ColumnMapping
  /** The user changed the mapping: a new inspection keeps it while the header stays the same. */
  mappingEdited: boolean
}

/** Delimiters by the names the format step shows. */
export const DELIMITER_NAMES = { comma: ',', semicolon: ';', tab: '\t' } as const satisfies Record<
  string,
  Delimiter
>

export type DelimiterName = keyof typeof DELIMITER_NAMES

export function delimiterName(delimiter: Delimiter): DelimiterName {
  return delimiter === ';' ? 'semicolon' : delimiter === '\t' ? 'tab' : 'comma'
}

export type MappingContext = {
  labels?: Partial<Record<EntityName, ColumnLabels>>
  previous?: Partial<Record<EntityName, StoredMapping>>
}

/** A new file: entity guessed from its name (else the preselected one), not inspected yet. */
export function newWizardFile(id: string, file: File, preselected: EntityName | null): WizardFile {
  return {
    id,
    file,
    entity: guessEntityFromFileName(file.webkitRelativePath || file.name) ?? preselected,
    options: { ...DEFAULT_FILE_OPTIONS },
    inspect: null,
    inspecting: true,
    failure: null,
    mapping: {},
    mappingEdited: false,
  }
}

/** The automatic mapping of a file for its entity and header (empty without either). */
export function automaticMapping(file: WizardFile, context: MappingContext): ColumnMapping {
  if (!file.entity || !file.inspect) return {}
  return autoMap(file.entity, file.inspect.header, {
    labels: context.labels?.[file.entity],
    previous: context.previous?.[file.entity] ?? null,
  })
}

/** Applies a fresh inspection; the mapping is redone unless the user's still fits the header. */
export function withInspection(
  file: WizardFile,
  inspect: InspectResult,
  context: MappingContext,
): WizardFile {
  const sameHeader =
    file.inspect !== null && file.inspect.header.join('\u0000') === inspect.header.join('\u0000')
  const next: WizardFile = { ...file, inspect, inspecting: false, failure: null }
  return file.mappingEdited && sameHeader
    ? next
    : { ...next, mapping: automaticMapping(next, context), mappingEdited: false }
}

export function withEntity(
  file: WizardFile,
  entity: EntityName | null,
  context: MappingContext,
): WizardFile {
  const next: WizardFile = { ...file, entity, mappingEdited: false }
  return { ...next, mapping: automaticMapping(next, context) }
}

/** Read without problems and with an entity: ready for the format and mapping steps. */
export function isFileReady(file: WizardFile): boolean {
  return (
    !file.inspecting &&
    file.failure === null &&
    file.inspect !== null &&
    file.inspect.problems.length === 0 &&
    file.entity !== null
  )
}

export function mappingIssuesOf(file: WizardFile): MappingIssue[] {
  if (!file.entity || !file.inspect) return []
  return checkMapping(file.entity, file.inspect.header, file.mapping)
}

export function hasMappingErrors(file: WizardFile): boolean {
  return mappingIssuesOf(file).some((issue) => issue.level === 'error')
}

export type FilesCheck = {
  ok: boolean
  tooMany: boolean
  /** Entities (other than demand history) chosen for more than one file. */
  entityTwice: EntityName[]
  needEntity: boolean
  needReady: boolean
}

/** Whether the files step may continue, and why not. */
export function checkFiles(files: readonly WizardFile[]): FilesCheck {
  const tooMany = files.length > IMPORT_LIMITS.filesPerBatch
  const counts = new Map<EntityName, number>()
  for (const file of files) {
    if (file.entity) counts.set(file.entity, (counts.get(file.entity) ?? 0) + 1)
  }
  const entityTwice = [...counts]
    .filter(([entity, count]) => count > 1 && !getEntity(entity).monthly_parts)
    .map(([entity]) => entity)
  const needEntity = files.some((file) => file.entity === null)
  const needReady = files.some((file) => file.entity !== null && !isFileReady(file))
  return {
    ok: files.length > 0 && !tooMany && entityTwice.length === 0 && !needEntity && !needReady,
    tooMany,
    entityTwice,
    needEntity,
    needReady,
  }
}

/** Files in the order they are staged and merged: load order, then name. */
export function orderForImport<T extends Pick<WizardFile, 'entity' | 'file'>>(
  files: readonly T[],
): T[] {
  return [...files].sort(
    (a, b) =>
      (a.entity && b.entity ? compareLoadOrder(a.entity, b.entity) : 0) ||
      a.file.name.localeCompare(b.file.name, 'en', { numeric: true }),
  )
}

/** The parse request for staging (the same one counts the rows first, so totals agree). */
export function parseRequestFor(file: WizardFile, startRow = 1): ParseRequest {
  if (!file.entity || !file.inspect) throw new Error('The file is not ready')
  const inspect = file.inspect
  return {
    entity: file.entity,
    sources: sourceIndexes(file.entity, file.mapping),
    normalize: {
      decimalSeparator: file.options.decimalSeparator,
      dateOrder: file.options.dateOrder,
      date1904: inspect.date1904,
    },
    encoding: inspect.encoding ?? file.options.encoding,
    delimiter: inspect.dialect?.delimiter ?? file.options.delimiter,
    sheet: inspect.sheet,
    startRow,
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : Array.from(text).slice(0, max).join('')
}

/** One entry of `import_create_batch(p_files)`. */
export function manifestFor(file: WizardFile, fileNo: number, rowsTotal: number): FileManifest {
  if (!file.entity || !file.inspect) throw new Error('The file is not ready')
  const extension = extensionOf(file.file.name)
  if (!extension) throw new Error('Unsupported file type')
  const header = file.inspect.header
    .slice(0, IMPORT_LIMITS.headerColumns)
    .map((text) => clip(text, 500))
  return {
    file_no: fileNo,
    entity: file.entity,
    original_name: clip(file.file.name, 255),
    extension,
    content_type: contentTypeFor(extension),
    size_bytes: file.file.size,
    sha256: file.inspect.sha256,
    rows_total: rowsTotal,
    columns: providedColumns(file.entity, file.mapping),
    header,
    mapping: storedMapping(file.entity, header, file.mapping),
    parse: {
      encoding: file.inspect.encoding?.encoding ?? null,
      delimiter: file.inspect.dialect ? delimiterName(file.inspect.dialect.delimiter) : null,
      sheet: file.inspect.sheet,
      date1904: file.inspect.date1904,
      decimal_separator: file.options.decimalSeparator,
      date_order: file.options.dateOrder,
    },
  }
}

/**
 * The runs of the wizard with each file's state replaced by the server's current one (matched by
 * file number). The commit records its errors on the files (references gone, a merge refused),
 * which the states kept from sealing do not show; runs without a server file keep theirs.
 */
export function withServerFileStates<R extends { fileNo: number; state: FileState | null }>(
  runs: readonly R[],
  files: readonly FileState[],
): R[] {
  const byNumber = new Map(files.map((file) => [file.file_no, file]))
  return runs.map((run) => {
    const file = byNumber.get(run.fileNo)
    return file ? { ...run, state: { ...run.state, ...file } } : run
  })
}
