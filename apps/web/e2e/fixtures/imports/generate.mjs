// Writes the import wizard fixtures used by e2e/imports.spec.ts. The files are committed; run
// this again only to change them: `node e2e/fixtures/imports/generate.mjs` from apps/web. The
// directory's .gitattributes keeps git from normalizing their bytes (BOMs, CRLF, encodings).
//
// - brands.csv: UTF-8 with a byte-order mark and CRLF line endings.
// - items-errors.csv / items-fixed.csv: Windows-1256 (Arabic Excel's "CSV"), CRLF, Arabic names
//   and two Arabic header labels, part codes with leading zeros and a `/`, a grouped amount and
//   formula payloads. The errors file has a bad decimal, an unknown brand and a duplicate code.
// - supplier_items.txt: Excel's "Unicode Text": UTF-16LE with a byte-order mark, tab-delimited,
//   CRLF, Arabic-Indic digits, the Arabic decimal and thousands separators and نعم/لا booleans.
// - items-1904.xlsx: a workbook in the 1904 date system (Mac Excel) with date serials, a code
//   with leading zeros stored as text and one code stored as a number.
// - supplier_items-1900.xlsx: a workbook in the 1900 date system with date serials and booleans.
// - brands-extra.csv: one new brand (UTF-8, LF), for the stale-tab, cancel and delete test.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const DAY_MS = 86_400_000

/** Windows-1256 bytes of `text`; throws on a character the code page cannot hold. */
function windows1256(text) {
  const decoder = new TextDecoder('windows-1256')
  const table = new Map()
  for (let byte = 0; byte < 256; byte += 1) {
    table.set(decoder.decode(new Uint8Array([byte])), byte)
  }
  return Uint8Array.from(Array.from(text), (character) => {
    const byte = table.get(character)
    if (byte === undefined) throw new Error(`Not in Windows-1256: ${character}`)
    return byte
  })
}

/** UTF-16LE with a byte-order mark. */
function utf16le(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
}

function crlf(lines) {
  return `${lines.join('\r\n')}\r\n`
}

/** Excel serial of an ISO date in the 1900 system (valid after 1900-02-28). */
function serial1900(iso) {
  return (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / DAY_MS
}

/** Excel serial of an ISO date in the 1904 system (1904-01-01 is 0). */
function serial1904(iso) {
  return (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1904, 0, 1)) / DAY_MS
}

function dateCell(serial) {
  return { t: 'n', v: serial, z: 'yyyy-mm-dd' }
}

/** A workbook with one sheet; cells may be plain values or SheetJS cell objects. */
function workbook(sheetName, rows, { date1904 }) {
  const sheet = XLSX.utils.aoa_to_sheet(
    rows.map((row) => row.map((cell) => (isCell(cell) ? null : cell))),
  )
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (isCell(cell)) sheet[XLSX.utils.encode_cell({ r, c })] = cell
    }),
  )
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName)
  book.Workbook = { ...(book.Workbook ?? {}), WBProps: { date1904 } }
  book.Props = { Title: sheetName, CreatedDate: new Date(Date.UTC(2026, 9, 1)) }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true })
}

function isCell(value) {
  return typeof value === 'object' && value !== null && 't' in value
}

function write(name, data) {
  writeFileSync(path.join(here, name), data)
  console.log(`wrote ${name} (${data.length} bytes)`)
}

write(
  'brands.csv',
  Buffer.from(
    `\uFEFF${crlf([
      'brand_code,name_en,name_ar,brand_type,country_of_origin',
      'TOY,Toyota,تويوتا,oem,JP',
      'NIS,Nissan,نيسان,oem,JP',
      'AFT,Gulf Aftermarket,الخليج لقطع الغيار,aftermarket,SA',
    ])}`,
    'utf8',
  ),
)

// "رقم القطعة" and "الاسم (بالعربية)" are the Arabic labels of item_code and name_ar.
const ITEMS_HEADER =
  'رقم القطعة,name_en,الاسم (بالعربية),brand_code,product_group,unit_of_measure,unit_cost,currency'
const FORMULA_NAME = '"=HYPERLINK(""http://evil.test"",""x"")"'

write(
  'items-errors.csv',
  windows1256(
    crlf([
      ITEMS_HEADER,
      '00123,Oil filter,فلتر زيت,TOY,filters,EA,12.5,SAR',
      '90915/YZZD2,Oil filter element,عنصر فلتر الزيت,TOY,filters,EA,"1,250.75",SAR',
      'BRK-01,Brake pad set,طقم فحمات فرامل,NIS,brakes,SET,12.5.0,SAR',
      'BAT-01,Battery 70Ah,بطارية 70 أمبير,NOPE,electrical,EA,300,SAR',
      '00123,Oil filter again,فلتر زيت مكرر,TOY,filters,EA,13,SAR',
      `FRM-01,${FORMULA_NAME},صيغة,AFT,misc,EA,=1+2,SAR`,
    ]),
  ),
)

write(
  'items-fixed.csv',
  windows1256(
    crlf([
      ITEMS_HEADER,
      '00123,Oil filter,فلتر زيت,TOY,filters,EA,12.5,SAR',
      '90915/YZZD2,Oil filter element,عنصر فلتر الزيت,TOY,filters,EA,"1,250.75",SAR',
      'BRK-01,Brake pad set,طقم فحمات فرامل,NIS,brakes,SET,45.5,SAR',
      'BAT-01,Battery 70Ah,بطارية 70 أمبير,AFT,electrical,EA,300,SAR',
      `FRM-01,${FORMULA_NAME},صيغة,AFT,misc,EA,3,SAR`,
    ]),
  ),
)

write(
  'supplier_items.txt',
  utf16le(
    crlf([
      [
        'supplier_code',
        'item_code',
        'supplier_part_number',
        'lead_time_days',
        'unit_price',
        'currency',
        'is_preferred',
        'valid_from',
      ].join('\t'),
      ['SUP-GULF', '00123', 'GP-00123', '١٤', '٨٫٥', 'SAR', 'نعم', '٢٠٢٦-١٠-٠١'].join('\t'),
      ['SUP-GULF', '90915/YZZD2', 'GP-90915', '٧', '١٬٢٥٠٫٧٥', 'SAR', 'لا', '2026-10-01'].join(
        '\t',
      ),
    ]),
  ),
)

write(
  'items-1904.xlsx',
  workbook(
    'Items',
    [
      [
        'item_code',
        'name_en',
        'name_ar',
        'product_group',
        'unit_of_measure',
        'unit_cost',
        'currency',
        'introduced_on',
      ],
      [
        '000777',
        'Air filter',
        'فلتر هواء',
        'filters',
        'EA',
        18.25,
        'SAR',
        dateCell(serial1904('2024-03-15')),
      ],
      [
        4711,
        'Spark plug',
        'شمعة احتراق',
        'ignition',
        'EA',
        6.5,
        'SAR',
        dateCell(serial1904('2025-12-31')),
      ],
      [
        'XL-1904',
        'Wiper blade',
        'ماسحة زجاج',
        'body',
        'SET',
        22,
        'SAR',
        dateCell(serial1904('2020-02-29')),
      ],
    ],
    { date1904: true },
  ),
)

write(
  'supplier_items-1900.xlsx',
  workbook(
    'Supplier items',
    [
      [
        'supplier_code',
        'item_code',
        'lead_time_days',
        'unit_price',
        'currency',
        'is_preferred',
        'valid_from',
      ],
      ['SUP-GULF', '000777', 21, 15.75, 'SAR', true, dateCell(serial1900('2024-03-15'))],
      ['SUP-GULF', 'XL-1904', 10, 19, 'SAR', false, dateCell(serial1900('2026-01-31'))],
    ],
    { date1904: false },
  ),
)

write('brands-extra.csv', Buffer.from('brand_code,name_en,name_ar\nHYU,Hyundai,هيونداي\n', 'utf8'))
