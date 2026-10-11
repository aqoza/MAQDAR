import { createFormatter } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { EMPTY, displayName, formatDateOnly, formatDecimal, formatMoney } from './format'

const en = createFormatter({ locale: 'en', timeZone: 'Asia/Riyadh' })
const arLatn = createFormatter({ locale: 'ar-u-nu-latn', timeZone: 'Asia/Riyadh' })
const arArab = createFormatter({ locale: 'ar-u-nu-arab', timeZone: 'Pacific/Kiritimati' })

/** Intl separates the currency code with a no-break space; compare with plain spaces. */
const SPACES = new RegExp(`[${String.fromCodePoint(0xa0)}${String.fromCodePoint(0x202f)}]`, 'g')
const MARKS = new RegExp(
  `[${[0x200e, 0x200f, 0x061c].map((code) => String.fromCodePoint(code)).join('')}]`,
  'g',
)
const plain = (text: string) => text.replace(SPACES, ' ').replace(MARKS, '')

describe('formatMoney', () => {
  it('shows the ISO code with the currency fraction digits', () => {
    expect(plain(formatMoney(en, 1234.5, 'SAR'))).toBe('SAR 1,234.50')
    expect(plain(formatMoney(en, 1.25, 'KWD'))).toBe('KWD 1.250')
    expect(plain(formatMoney(en, 0.5, 'BHD'))).toBe('BHD 0.500')
    expect(plain(formatMoney(en, 10, 'OMR'))).toBe('OMR 10.000')
    expect(plain(formatMoney(en, 10, 'JOD'))).toBe('JOD 10.000')
  })

  it('follows the numbering system of the locale', () => {
    expect(plain(formatMoney(arLatn, 1234.5, 'SAR'))).toContain('1,234.50')
    expect(plain(formatMoney(arArab, 1234.5, 'SAR'))).toContain('١٬٢٣٤٫٥٠')
  })

  it('handles missing values and currencies', () => {
    expect(formatMoney(en, null, 'SAR')).toBe(EMPTY)
    expect(formatMoney(en, undefined, 'SAR')).toBe(EMPTY)
    expect(formatMoney(en, 12.3456, null)).toBe('12.346')
    expect(formatMoney(en, 12.5, 'sar')).toBe('12.5')
  })
})

describe('formatDecimal', () => {
  it('keeps up to the requested fraction digits', () => {
    expect(formatDecimal(en, 1234.5678)).toBe('1,234.568')
    expect(formatDecimal(en, 0.0000001, 10)).toBe('0.0000001')
    expect(formatDecimal(en, null)).toBe(EMPTY)
  })
})

describe('formatDateOnly', () => {
  it('formats the calendar day regardless of the time zone', () => {
    // Kiritimati is UTC+14 and Riyadh UTC+3: a date column must not move to the next day.
    expect(formatDateOnly(en, '2026-10-11')).toBe('Oct 11, 2026')
    expect(
      formatDateOnly(
        createFormatter({ locale: 'en', timeZone: 'Pacific/Kiritimati' }),
        '2026-01-01',
      ),
    ).toBe('Jan 1, 2026')
    expect(
      formatDateOnly(
        createFormatter({ locale: 'en', timeZone: 'America/Los_Angeles' }),
        '2026-01-01',
      ),
    ).toBe('Jan 1, 2026')
  })

  it('uses the locale digits', () => {
    expect(formatDateOnly(arArab, '2026-10-11')).toContain('٢٠٢٦')
  })

  it('passes through malformed values and shows a dash for empty ones', () => {
    expect(formatDateOnly(en, null)).toBe(EMPTY)
    expect(formatDateOnly(en, '')).toBe(EMPTY)
    expect(formatDateOnly(en, 'soon')).toBe('soon')
  })
})

describe('displayName', () => {
  const both = { name_en: 'Oil filter', name_ar: 'فلتر زيت' }

  it('shows English first in English', () => {
    expect(displayName(both, 'en')).toEqual({
      primary: 'Oil filter',
      primaryLang: 'en',
      secondary: 'فلتر زيت',
      secondaryLang: 'ar',
    })
  })

  it('shows Arabic first in Arabic when there is an Arabic name', () => {
    expect(displayName(both, 'ar-u-nu-latn')).toEqual({
      primary: 'فلتر زيت',
      primaryLang: 'ar',
      secondary: 'Oil filter',
      secondaryLang: 'en',
    })
    expect(displayName({ name_en: 'Oil filter', name_ar: null }, 'ar')).toEqual({
      primary: 'Oil filter',
      primaryLang: 'en',
      secondary: null,
      secondaryLang: 'ar',
    })
  })

  it('treats blank names as missing', () => {
    expect(displayName({ name_en: 'X', name_ar: '  ' }, 'en').secondary).toBeNull()
    expect(displayName({}, 'en').primary).toBe(EMPTY)
  })
})
