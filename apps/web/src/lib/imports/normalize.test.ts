import { describe, expect, it } from 'vitest'
import { parseDecimal } from '../master-data/numbers'
import { getEntity } from './contract'
import {
  displayRawCell,
  isBlankCell,
  normalizeBoolean,
  normalizeCell,
  normalizeCode,
  normalizeDate,
  normalizeDecimal,
  normalizeEnum,
  normalizeIsoCode,
  normalizeRow,
  normalizeText,
  normalizeWeekdays,
  numberToDecimal,
  serialToIsoDate,
  stripInvisible,
  toAsciiDigits,
  type NormalizeIssue,
  type NormalizeOptions,
  type RowPlan,
} from './normalize'

const cp = (code: number) => String.fromCodePoint(code)
const [LRM, RLM, ALM, NBSP, NNBSP, BOM] = [0x200e, 0x200f, 0x061c, 0x00a0, 0x202f, 0xfeff].map(cp)
const CANONICAL = /^-?[0-9]+(?:\.[0-9]+)?$/

describe('characters', () => {
  it('maps Arabic-Indic, extended and fullwidth digits only', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
    expect(toAsciiDigits('１２３')).toBe('123')
    expect(toAsciiDigits('P-١٢ ب')).toBe('P-12 ب')
  })

  it('strips bidi marks, embeddings and stray byte-order marks', () => {
    expect(stripInvisible(`${RLM}12${LRM}${ALM}${BOM}`)).toBe('12')
    expect(stripInvisible(`${cp(0x202b)}abc${cp(0x202c)}${cp(0x2067)}d${cp(0x2069)}`)).toBe('abcd')
  })
})

describe('normalizeDecimal with the dot', () => {
  it.each([
    ['12.5', '12.5'],
    ['1,234,567.125', '1234567.125'],
    ['١٢٣٫٤٥', '123.45'],
    ['١٬٢٣٤٫٥', '1234.5'],
    ['۱۲۳۴', '1234'],
    [`${RLM} 12.5${LRM} `, '12.5'],
    [`${NBSP}7${NBSP}`, '7'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['007', '7'],
    ['1.2300', '1.23'],
    ['12.000', '12'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['-2.5', '-2.5'],
    [`${cp(0x2212)}5`, '-5'],
    ['', ''],
    ['   ', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDecimal(input, '.')).toBe(expected)
  })

  it.each([
    '1,23',
    '12,34.5',
    '1234,567',
    ',123',
    '1,,234',
    '1,234,56',
    '1,5',
    '+5',
    '1e5',
    '1 000',
    '(5)',
    '1.2.3',
    'abc',
    '-',
    '.',
    '5-',
    'SAR 5',
  ])('passes %j through for the database to reject', (input) => {
    const result = normalizeDecimal(input, '.')
    expect(CANONICAL.test(result), result).toBe(false)
    expect(result).toBe(toAsciiDigits(input).trim())
  })

  it('agrees with the master-data number parser', () => {
    const inputs = [
      '12.5',
      '1,234,567.125',
      '١٬٢٣٤٫٥',
      '.5',
      '5.',
      '007',
      '-2.5',
      '-0',
      '1,23',
      '+5',
      '1e5',
      '1 000',
      '0x10',
      '1.2.3',
      '999999999999.999',
      '0.0000000001',
    ]
    for (const input of inputs) {
      const parsed = parseDecimal(input, { scale: 10, integerDigits: 15 })
      const normalized = normalizeDecimal(input, '.')
      if (parsed.ok) {
        expect(CANONICAL.test(normalized), input).toBe(true)
        expect(Number(normalized), input).toBe(parsed.value)
      } else {
        expect(parsed.issue, input).toBe('number')
        expect(CANONICAL.test(normalized), input).toBe(false)
      }
    }
  })
})

describe('normalizeDecimal with the comma', () => {
  it.each([
    ['12,5', '12.5'],
    ['1.234.567,125', '1234567.125'],
    ['1.234', '1234'],
    ['1 234 567,5', '1234567.5'],
    [`1${NBSP}234,5`, '1234.5'],
    [`1${NNBSP}234`, '1234'],
    ['١٢٣٫٤٥', '123.45'],
    ['١٬٢٣٤٫٥', '1234.5'],
    ['١٢٣,٤٥', '123.45'],
    [',5', '0.5'],
    ['-3,0', '-3'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDecimal(input, ',')).toBe(expected)
  })

  it('passes invalid groupings through and flags dot decimals', () => {
    const issues: NormalizeIssue[] = []
    expect(normalizeDecimal('1.5', ',', (issue) => issues.push(issue))).toBe('1.5')
    expect(normalizeDecimal('1,234.5', ',', (issue) => issues.push(issue))).toBe('1,234.5')
    expect(normalizeDecimal('1.23', ',', (issue) => issues.push(issue))).toBe('1.23')
    expect(normalizeDecimal('1,2,3', ',', (issue) => issues.push(issue))).toBe('1,2,3')
    expect(normalizeDecimal('1 234.5', ',', (issue) => issues.push(issue))).toBe('1 234.5')
    expect(issues).toEqual(['ambiguous_decimal', 'ambiguous_decimal'])
  })
})

describe('numberToDecimal', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [12, '12'],
    [12.5, '12.5'],
    [0.1 + 0.2, '0.3'],
    [-1234567.125, '-1234567.125'],
    [1e-7, '0.0000001'],
    [1e21, '1000000000000000000000'],
    [123456789012, '123456789012'],
    [1.23456789012345e-5, '0.0000123456789012345'],
  ])('%d → %j', (value, expected) => {
    expect(numberToDecimal(value)).toBe(expected)
  })

  it('passes non-finite values through as text', () => {
    expect(numberToDecimal(Number.NaN)).toBe('NaN')
    expect(numberToDecimal(Number.POSITIVE_INFINITY)).toBe('Infinity')
  })
})

describe('normalizeDate', () => {
  it('reads each declared order with any of the separators', () => {
    expect(normalizeDate('2024-01-05', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate('2024/1/5', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate('2024.01.05', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate('05/01/2024', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('5-1-2024', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('05.01.2024', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('01/05/2024', 'MM/DD/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('1/5/2024', 'MM/DD/YYYY')).toBe('2024-01-05')
  })

  it('never guesses the order of day and month', () => {
    expect(normalizeDate('05/01/2024', 'YYYY-MM-DD')).toBe('05/01/2024')
    expect(normalizeDate('13/01/2024', 'MM/DD/YYYY')).toBe('13/01/2024')
    expect(normalizeDate('01/13/2024', 'DD/MM/YYYY')).toBe('01/13/2024')
  })

  it('reads a four-digit year first in every order', () => {
    expect(normalizeDate('2024-01-05', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('2024/01/05', 'MM/DD/YYYY')).toBe('2024-01-05')
  })

  it('converts Arabic-Indic digits and strips bidi marks', () => {
    expect(normalizeDate('٢٠٢٤/٠١/٠٥', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate(`${RLM}٠٥/٠١/٢٠٢٤${LRM}`, 'DD/MM/YYYY')).toBe('2024-01-05')
  })

  it('drops a time of day without a zone', () => {
    expect(normalizeDate('2024-01-05 00:00:00', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate('2024-01-05T13:45', 'YYYY-MM-DD')).toBe('2024-01-05')
    expect(normalizeDate('1/5/2024 12:00:00 AM', 'MM/DD/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('05/01/2024 0:00', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('05/01/2024 12:00 ص', 'DD/MM/YYYY')).toBe('2024-01-05')
    expect(normalizeDate('2024-01-05T00:00:00Z', 'YYYY-MM-DD')).toBe('2024-01-05T00:00:00Z')
  })

  it('passes impossible dates and other shapes through', () => {
    expect(normalizeDate('2023-02-29', 'YYYY-MM-DD')).toBe('2023-02-29')
    expect(normalizeDate('2024-02-29', 'YYYY-MM-DD')).toBe('2024-02-29')
    expect(normalizeDate('1900-02-29', 'YYYY-MM-DD')).toBe('1900-02-29')
    expect(normalizeDate('2000-02-29', 'YYYY-MM-DD')).toBe('2000-02-29')
    expect(normalizeDate('2024-13-01', 'YYYY-MM-DD')).toBe('2024-13-01')
    expect(normalizeDate('2024-04-31', 'YYYY-MM-DD')).toBe('2024-04-31')
    expect(normalizeDate('05/01/24', 'DD/MM/YYYY')).toBe('05/01/24')
    expect(normalizeDate('2024-01/05', 'YYYY-MM-DD')).toBe('2024-01/05')
    expect(normalizeDate('Jan 5, 2024', 'MM/DD/YYYY')).toBe('Jan 5, 2024')
    expect(normalizeDate('45292', 'YYYY-MM-DD')).toBe('45292')
    expect(normalizeDate('', 'DD/MM/YYYY')).toBe('')
  })
})

describe('serialToIsoDate', () => {
  it('reads the 1900 date system, including the phantom 1900-02-29', () => {
    expect(serialToIsoDate(1)).toBe('1900-01-01')
    expect(serialToIsoDate(59)).toBe('1900-02-28')
    expect(serialToIsoDate(60)).toBe('1900-02-29')
    expect(serialToIsoDate(61)).toBe('1900-03-01')
    expect(serialToIsoDate(43831)).toBe('2020-01-01')
    expect(serialToIsoDate(45292)).toBe('2024-01-01')
    expect(serialToIsoDate(45292.75)).toBe('2024-01-01')
    expect(serialToIsoDate(2958465)).toBe('9999-12-31')
  })

  it('reads the 1904 date system', () => {
    expect(serialToIsoDate(0, true)).toBe('1904-01-01')
    expect(serialToIsoDate(42369, true)).toBe('2020-01-01')
    expect(serialToIsoDate(45292 - 1462, true)).toBe('2024-01-01')
  })

  it('passes serials outside the calendar through', () => {
    expect(serialToIsoDate(0)).toBe('0')
    expect(serialToIsoDate(-5)).toBe('-5')
    expect(serialToIsoDate(2958466)).toBe('2958466')
    expect(serialToIsoDate(-1, true)).toBe('-1')
    expect(serialToIsoDate(Number.NaN)).toBe('NaN')
  })
})

describe('normalizeBoolean', () => {
  it.each([
    ['true', 'true'],
    ['TRUE', 'true'],
    [' Yes ', 'true'],
    ['1', 'true'],
    ['١', 'true'],
    ['نعم', 'true'],
    ['false', 'false'],
    ['No', 'false'],
    ['0', 'false'],
    ['٠', 'false'],
    ['لا', 'false'],
    [cp(0xfefb), 'false'],
    [`${RLM}نعم`, 'true'],
    ['y', 'y'],
    ['2', '2'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeBoolean(input)).toBe(expected)
  })
})

describe('normalizeWeekdays', () => {
  it.each([
    ['5;6', '5;6'],
    ['6;5', '5;6'],
    ['5,6', '5;6'],
    ['5 6', '5;6'],
    ['{5,6}', '5;6'],
    ['٥؛٦', '5;6'],
    ['Fri;Sat', '5;6'],
    ['friday, saturday', '5;6'],
    ['الجمعة والسبت', '5;6'],
    ['الجمعة،السبت', '5;6'],
    ['7', '7'],
    ['', ''],
    ['{}', ''],
    ['5;5', '5;5'],
    ['5;8', '5;8'],
    ['weekend', 'weekend'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeWeekdays(input)).toBe(expected)
  })
})

describe('codes, enums and text', () => {
  it('keeps codes verbatim apart from invisible marks and edges', () => {
    expect(normalizeCode(`${RLM} p-000001 ${NBSP}`)).toBe('p-000001')
    expect(normalizeCode('00123')).toBe('00123')
    expect(normalizeCode('P/١٢')).toBe('P/١٢')
    expect(normalizeCode('A B')).toBe('A B')
  })

  it('capitalizes ISO codes', () => {
    expect(normalizeIsoCode(' sar ')).toBe('SAR')
    expect(normalizeIsoCode('sa')).toBe('SA')
    expect(normalizeIsoCode('ر.س')).toBe('ر.س')
    expect(normalizeIsoCode('US1')).toBe('US1')
  })

  it('matches enum values in any case', () => {
    const values = ['one_way', 'two_way']
    expect(normalizeEnum('Two way', values)).toBe('two_way')
    expect(normalizeEnum('ONE-WAY', values)).toBe('one_way')
    expect(normalizeEnum('both', values)).toBe('both')
    expect(normalizeEnum(' ', values)).toBe('')
    // Upper-case contract values (unit_of_measure) match in any case and come back as written.
    const units = ['EA', 'SET', 'L', 'KG']
    expect(normalizeEnum('kg', units)).toBe('KG')
    expect(normalizeEnum('Ea', units)).toBe('EA')
    expect(normalizeEnum(' set ', units)).toBe('SET')
    expect(normalizeEnum('box', units)).toBe('box')
  })

  it('makes no-break spaces plain in text', () => {
    expect(normalizeText(`${RLM}فلتر${NBSP}زيت ${LRM}`)).toBe('فلتر زيت')
    expect(normalizeText('Oil filter ١٢')).toBe('Oil filter ١٢')
  })
})

const options = (overrides: Partial<NormalizeOptions> = {}): NormalizeOptions => ({
  decimalSeparator: '.',
  dateOrder: 'YYYY-MM-DD',
  date1904: false,
  ...overrides,
})

describe('normalizeCell for XLSX cells', () => {
  const code = { kind: 'item_code', enum: null } as const
  const decimal = { kind: 'decimal', enum: null } as const
  const date = { kind: 'date', enum: null } as const
  const boolean = { kind: 'boolean', enum: null } as const
  const text = { kind: 'text', enum: null } as const

  it('keeps the shown text of numeric code cells and warns', () => {
    const issues: NormalizeIssue[] = []
    const sink = (issue: NormalizeIssue) => issues.push(issue)
    expect(normalizeCell(code, { t: 'n', v: 123, w: '00123' }, options(), sink)).toBe('00123')
    expect(
      normalizeCell(code, { t: 'n', v: 123456789012, w: '1.23457E+11' }, options(), sink),
    ).toBe('123456789012')
    expect(normalizeCell(code, { t: 'n', v: 42 }, options(), sink)).toBe('42')
    expect(issues).toEqual(['numeric_code_cell', 'numeric_code_cell', 'numeric_code_cell'])
    expect(normalizeCell(code, { t: 's', v: 'P-1' }, options(), sink)).toBe('P-1')
    expect(issues).toHaveLength(3)
  })

  it('uses raw numbers for decimals, whatever the cell shows', () => {
    expect(normalizeCell(decimal, { t: 'n', v: 0.1 + 0.2, w: '0.30' }, options())).toBe('0.3')
    expect(normalizeCell(decimal, { t: 'n', v: 1234.5, w: 'SAR 1,234.50' }, options())).toBe(
      '1234.5',
    )
    expect(
      normalizeCell(decimal, { t: 's', v: '1.234,5' }, options({ decimalSeparator: ',' })),
    ).toBe('1234.5')
  })

  it('reads date serials in the workbook date system', () => {
    expect(normalizeCell(date, { t: 'n', v: 45292, w: '1/1/24' }, options())).toBe('2024-01-01')
    expect(normalizeCell(date, { t: 'n', v: 45292 - 1462 }, options({ date1904: true }))).toBe(
      '2024-01-01',
    )
    expect(normalizeCell(date, { t: 'n', v: 60 }, options())).toBe('1900-02-29')
    expect(
      normalizeCell(date, { t: 's', v: '05/01/2024' }, options({ dateOrder: 'DD/MM/YYYY' })),
    ).toBe('2024-01-05')
    expect(normalizeCell(date, { t: 'd', v: new Date(2024, 0, 5) }, options())).toBe('2024-01-05')
  })

  it('reads boolean, error and empty cells', () => {
    const issues: NormalizeIssue[] = []
    expect(normalizeCell(boolean, { t: 'b', v: true, w: 'TRUE' }, options())).toBe('true')
    expect(normalizeCell(boolean, { t: 'n', v: 0 }, options())).toBe('false')
    expect(normalizeCell(boolean, { t: 'n', v: 2 }, options())).toBe('2')
    expect(normalizeCell(text, { t: 'b', v: false, w: 'FALSE' }, options())).toBe('FALSE')
    expect(
      normalizeCell(decimal, { t: 'e', v: 42, w: '#N/A' }, options(), (issue) =>
        issues.push(issue),
      ),
    ).toBe('#N/A')
    expect(issues).toEqual(['error_cell'])
    expect(normalizeCell(text, { t: 'z' }, options())).toBe('')
    expect(normalizeCell(text, null, options())).toBe('')
    expect(normalizeCell(text, undefined, options())).toBe('')
  })

  it('shows and recognizes blank cells', () => {
    expect(displayRawCell({ t: 'n', v: 5, w: '5.00' })).toBe('5.00')
    expect(displayRawCell({ t: 'n', v: 5 })).toBe('5')
    expect(displayRawCell('x')).toBe('x')
    expect(displayRawCell(null)).toBe('')
    expect(isBlankCell(` ${NBSP}${RLM}`)).toBe(true)
    expect(isBlankCell({ t: 'z' })).toBe(true)
    expect(isBlankCell({ t: 's', v: '  ' })).toBe(true)
    expect(isBlankCell({ t: 'n', v: 0 })).toBe(false)
    expect(isBlankCell('0')).toBe(false)
  })
})

describe('normalizeRow', () => {
  it('gives null for columns not provided and "" for empty cells', () => {
    const entity = getEntity('demand_history')
    const plan: RowPlan = {
      columns: entity.columns,
      // item_code, location_code, demand_date from columns 2, 0, 1; quantity from 3; no lost sales.
      sources: [2, 0, 1, 3, null],
      options: options({ dateOrder: 'DD/MM/YYYY', decimalSeparator: ',' }),
    }
    expect(normalizeRow(plan, ['RUH-01', '05/01/2024', 'P-1', '1.234,5'])).toEqual([
      'P-1',
      'RUH-01',
      '2024-01-05',
      '1234.5',
      null,
    ])
    expect(normalizeRow(plan, ['RUH-01', '05/01/2024', 'P-1'])).toEqual([
      'P-1',
      'RUH-01',
      '2024-01-05',
      '',
      null,
    ])
  })

  it('reports issues with the contract column index', () => {
    const entity = getEntity('items')
    const sources = entity.columns.map((_, index) => (index === 0 ? 0 : null))
    const plan: RowPlan = { columns: entity.columns, sources, options: options() }
    const seen: Array<[NormalizeIssue, number]> = []
    const row = normalizeRow(plan, [{ t: 'n', v: 7, w: '007' }], (issue, index) =>
      seen.push([issue, index]),
    )
    expect(row[0]).toBe('007')
    expect(row.slice(1).every((value) => value === null)).toBe(true)
    expect(seen).toEqual([['numeric_code_cell', 0]])
  })
})
