import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSearch, searchPatterns, searchTokens } from './search'

/**
 * Pairs checked against app.normalize_search() on the local stack (PostgreSQL 17, ICU). The first
 * seven are the fixtures shared with the pgTAP test.
 */
const FIXTURES: Array<[string, string]> = [
  ['FALCON-123', 'falcon 123'],
  ['قِطَعُ فالكون', 'قطع فالكون'],
  ['الأصلية', 'الاصليه'],
  ['مستشفى', 'مستشفي'],
  ['٤٥ ۶۷', '45 67'],
  ['كـــتاب', 'كتاب'],
  ['  A/B__c  ', 'a b c'],
  // Latin letters with accents are kept (U+00E0–U+024F); ß (U+00DF) is below the range.
  ['ÉCOLE Straße', 'école stra e'],
  ['naïve café', 'naïve café'],
  // NFKC expands compatibility characters before folding.
  ['ﷺ test', 'صلي الله عليه وسلم test'],
  ['ﻻ', 'لا'],
  ['ﺍﻟﺴﻼﻡ', 'السلام'],
  ['Ⅻ ①', 'xii 1'],
  ['ǅemal', 'džemal'],
  ['آمن إلى ٱلله', 'امن الي الله'],
  // The Arabic decimal and thousands separators are separators here.
  ['x٫5 ٬', 'x 5'],
  // İ lower-cases to i + U+0307 (combining dot), which is a separator.
  ['İstanbul', 'i stanbul'],
  // Scripts outside Latin and Arabic fold to nothing.
  ['Ꭰ ά Ω ж', ''],
  // Superscript alef + hamza above (combining marks only).
  [String.fromCodePoint(0x0670, 0x0654), ''],
  ['ـ', ''],
  ['', ''],
]

/** Optional shared fixture file written for the pgTAP test; accepts the shapes it may use. */
function sharedFixtures(): Array<[string, string]> {
  const path = fileURLToPath(
    new URL('../../../../../supabase/tests/fixtures/normalize_search.json', import.meta.url),
  )
  if (!existsSync(path)) return []
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const pairs: Array<[string, string]> = []
  const add = (input: unknown, expected: unknown) => {
    if (typeof input !== 'string' || typeof expected !== 'string') {
      throw new Error(`Unexpected fixture entry in ${path}`)
    }
    pairs.push([input, expected])
  }
  const entries = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { cases?: unknown }).cases)
      ? (data as { cases: unknown[] }).cases
      : null
  if (entries) {
    for (const entry of entries) {
      if (Array.isArray(entry)) add(entry[0], entry[1])
      else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        add(record.input ?? record.value, record.expected ?? record.normalized ?? record.output)
      } else throw new Error(`Unexpected fixture entry in ${path}`)
    }
  } else if (data && typeof data === 'object') {
    for (const [input, expected] of Object.entries(data)) add(input, expected)
  }
  return pairs
}

describe('normalizeSearch', () => {
  it.each(FIXTURES)('folds %j to %j like app.normalize_search', (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected)
  })

  it('matches the shared pgTAP fixtures when present', () => {
    for (const [input, expected] of sharedFixtures()) {
      expect(normalizeSearch(input), input).toBe(expected)
    }
  })

  it('treats null and undefined as empty', () => {
    expect(normalizeSearch(null)).toBe('')
    expect(normalizeSearch(undefined)).toBe('')
  })

  it('collapses every separator run into one space', () => {
    expect(normalizeSearch('a\t\n-  b,,c')).toBe('a b c')
  })
})

describe('searchTokens', () => {
  it('splits, de-duplicates and caps the tokens', () => {
    expect(searchTokens('Oil  oil FILTER')).toEqual(['oil', 'filter'])
    expect(searchTokens('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(searchTokens('   ')).toEqual([])
  })

  it('never yields LIKE or PostgREST wildcard characters', () => {
    const tokens = searchTokens('50% off_*\\ (x)')
    for (const token of tokens) expect(token).toMatch(/^[^%_\\*]+$/)
    expect(tokens).toEqual(['50', 'off', 'x'])
  })

  it('builds contains patterns', () => {
    expect(searchPatterns('Falcon ٤٥')).toEqual(['%falcon%', '%45%'])
  })
})
