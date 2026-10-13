import { describe, expect, it } from 'vitest'
import type { InspectResult } from '../../lib/imports/parse'
import {
  checkFiles,
  hasMappingErrors,
  isFileReady,
  manifestFor,
  newWizardFile,
  orderForImport,
  parseRequestFor,
  withEntity,
  withInspection,
  withServerFileStates,
  type WizardFile,
} from './wizard-state'

function inspection(header: string[], patch: Partial<InspectResult> = {}): InspectResult {
  return {
    name: 'file.csv',
    size: 100,
    format: 'csv',
    sha256: 'b'.repeat(64),
    encoding: { encoding: 'windows-1256', source: 'fallback', bomLength: 0 },
    dialect: { delimiter: ';', newline: '\r\n', detected: true },
    sheets: [],
    sheet: null,
    date1904: false,
    header,
    preview: [],
    rowCount: null,
    problems: [],
    issues: {},
    ...patch,
  }
}

function fileNamed(name: string, entity: WizardFile['entity'] = null): WizardFile {
  const file = newWizardFile(name, new File(['x'], name), null)
  return entity === null ? file : { ...file, entity }
}

function ready(name: string, header: string[]): WizardFile {
  return withInspection(fileNamed(name), inspection(header), {})
}

describe('newWizardFile', () => {
  it('guesses the entity from the file name, else takes the preselected one', () => {
    expect(newWizardFile('1', new File(['x'], 'Supplier Items (2).csv'), null).entity).toBe(
      'supplier_items',
    )
    expect(newWizardFile('2', new File(['x'], 'export.csv'), 'brands').entity).toBe('brands')
    expect(newWizardFile('3', new File(['x'], 'export.csv'), null).entity).toBeNull()
    expect(newWizardFile('4', new File(['x'], 'items.csv'), 'brands').entity).toBe('items')
  })

  it('starts inspecting with default options', () => {
    const file = newWizardFile('1', new File(['x'], 'items.csv'), null)
    expect(file.inspecting).toBe(true)
    expect(file.options).toEqual({
      encoding: 'auto',
      delimiter: 'auto',
      sheet: null,
      decimalSeparator: '.',
      dateOrder: 'YYYY-MM-DD',
    })
  })
})

describe('mapping state', () => {
  it('maps headers automatically, by name, label and the previous mapping', () => {
    const file = withInspection(
      fileNamed('items.csv'),
      inspection(['item_code', 'Part name', 'Old cost']),
      {
        labels: { items: { name_en: ['Part name'] } },
        previous: { items: { unit_cost: 'Old cost' } },
      },
    )
    expect(file.inspecting).toBe(false)
    expect(file.mapping).toEqual({
      item_code: { index: 0, source: 'name' },
      name_en: { index: 1, source: 'label' },
      unit_cost: { index: 2, source: 'previous' },
    })
    // unit_cost without currency breaks the column group.
    expect(hasMappingErrors(file)).toBe(true)
  })

  it('keeps a hand-made mapping while the header stays the same', () => {
    const file = ready('items.csv', ['item_code', 'x'])
    const edited: WizardFile = {
      ...file,
      mapping: { ...file.mapping, name_en: { index: 1, source: 'manual' } },
      mappingEdited: true,
    }
    const same = withInspection(edited, inspection(['item_code', 'x']), {})
    expect(same.mapping.name_en).toEqual({ index: 1, source: 'manual' })
    const changed = withInspection(edited, inspection(['item_code', 'y']), {})
    expect(changed.mapping.name_en).toBeUndefined()
    expect(changed.mappingEdited).toBe(false)
  })

  it('maps again for a new entity', () => {
    const file = withEntity(ready('data.csv', ['brand_code', 'name_en']), 'brands', {})
    expect(Object.keys(file.mapping)).toEqual(['brand_code', 'name_en'])
    expect(withEntity(file, null, {}).mapping).toEqual({})
  })
})

describe('checkFiles', () => {
  it('needs at least one ready file with an entity', () => {
    expect(checkFiles([]).ok).toBe(false)
    expect(checkFiles([ready('items.csv', ['item_code'])]).ok).toBe(true)
    const unknown = { ...ready('x.csv', ['a']), entity: null }
    expect(checkFiles([unknown])).toMatchObject({ ok: false, needEntity: true })
    const reading = { ...fileNamed('items.csv') }
    expect(checkFiles([reading])).toMatchObject({ ok: false, needReady: true })
    const broken = withInspection(
      fileNamed('items.csv'),
      inspection([''], { problems: [{ code: 'no_header' }] }),
      {},
    )
    expect(isFileReady(broken)).toBe(false)
  })

  it('allows several demand files but one file per other entity', () => {
    const demand = [ready('demand_history_2026-01.csv', ['a']), ready('2026-02.csv', ['a'])]
    expect(demand.map((file) => file.entity)).toEqual(['demand_history', 'demand_history'])
    expect(checkFiles(demand).ok).toBe(true)
    const items = [ready('items.csv', ['a']), ready('parts.csv', ['a'])]
    expect(checkFiles(items)).toMatchObject({ ok: false, entityTwice: ['items'] })
  })

  it('refuses more than 60 files', () => {
    const many = Array.from({ length: 61 }, (_, index) => ready(`2026-${index}.csv`, ['a']))
    expect(checkFiles(many)).toMatchObject({ ok: false, tooMany: true })
  })
})

describe('orderForImport', () => {
  it('puts parents first, then sorts by name with numbers in order', () => {
    const files = [
      fileNamed('demand-10.csv', 'demand_history'),
      fileNamed('items.csv', 'items'),
      fileNamed('demand-9.csv', 'demand_history'),
      fileNamed('brands.csv', 'brands'),
    ]
    expect(orderForImport(files).map((file) => file.file.name)).toEqual([
      'brands.csv',
      'items.csv',
      'demand-9.csv',
      'demand-10.csv',
    ])
  })
})

describe('manifestFor and parseRequestFor', () => {
  const file: WizardFile = {
    ...ready('بنود.csv', ['Part', 'Name', 'x'.repeat(600)]),
    entity: 'items',
    mapping: {
      item_code: { index: 0, source: 'label' },
      name_en: { index: 1, source: 'manual' },
    },
    options: {
      encoding: 'auto',
      delimiter: 'auto',
      sheet: null,
      decimalSeparator: ',',
      dateOrder: 'DD/MM/YYYY',
    },
  }

  it('describes the file for import_create_batch', () => {
    const manifest = manifestFor(file, 3, 1_234)
    expect(manifest).toMatchObject({
      file_no: 3,
      entity: 'items',
      original_name: 'بنود.csv',
      extension: 'csv',
      content_type: 'text/csv',
      size_bytes: 1,
      sha256: 'b'.repeat(64),
      rows_total: 1_234,
      columns: ['item_code', 'name_en'],
      mapping: { item_code: 'Part', name_en: 'Name' },
      parse: {
        encoding: 'windows-1256',
        delimiter: 'semicolon',
        sheet: null,
        date1904: false,
        decimal_separator: ',',
        date_order: 'DD/MM/YYYY',
      },
    })
    expect(manifest.header?.[2]).toHaveLength(500)
  })

  it('stages with the inspected encoding and delimiter and the declared formats', () => {
    const request = parseRequestFor(file, 501)
    expect(request.entity).toBe('items')
    expect(request.sources.slice(0, 3)).toEqual([0, 1, null])
    expect(request.encoding).toEqual(file.inspect?.encoding)
    expect(request.delimiter).toBe(';')
    expect(request.normalize).toEqual({
      decimalSeparator: ',',
      dateOrder: 'DD/MM/YYYY',
      date1904: false,
    })
    expect(request.startRow).toBe(501)
  })
})

describe('withServerFileStates', () => {
  const sealed = {
    file_no: 2,
    entity: 'items' as const,
    status: 'sealed' as const,
    source_stored: true,
    rows_total: 3,
    rows_staged: 3,
    rows_new: 3,
    rows_existing: 0,
    error_count: 0,
    warning_count: 0,
    errors_stored: 0,
    error_counts: {},
    merged_through_row: 0,
    counts: {},
  }

  it('replaces the states kept from sealing with the ones the commit left', () => {
    const runs = [
      { id: 'a', fileNo: 1, state: null },
      { id: 'b', fileNo: 2, state: sealed },
    ]
    const after = {
      ...sealed,
      error_count: 1,
      errors_stored: 1,
      error_counts: { changed_during_commit: { '': 1 } },
    }
    const merged = withServerFileStates(runs, [after])
    expect(merged[1]?.state).toMatchObject({
      error_count: 1,
      error_counts: { changed_during_commit: { '': 1 } },
    })
    expect(merged[1]?.id).toBe('b')
    expect(merged[0]).toBe(runs[0])
  })
})
