import { describe, expect, it } from 'vitest'
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from './slug'

describe('slugify', () => {
  it('lower-cases and hyphenates plain names', () => {
    expect(slugify('Gulf Auto Parts')).toBe('gulf-auto-parts')
    expect(slugify('ACME')).toBe('acme')
  })

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slugify('  Al  Futtaim --- Motors, LLC. ')).toBe('al-futtaim-motors-llc')
    expect(slugify('a_b.c/d')).toBe('a-b-c-d')
  })

  it('never starts or ends with a hyphen', () => {
    expect(slugify('-leading')).toBe('leading')
    expect(slugify('trailing-')).toBe('trailing')
    expect(slugify('***')).toBe('')
  })

  it('folds diacritics to ASCII', () => {
    expect(slugify('Société Générale')).toBe('societe-generale')
    expect(slugify('Åland Öl')).toBe('aland-ol')
    // ß has no NFKD decomposition, so it separates like punctuation.
    expect(slugify('Müller Straße')).toBe('muller-stra-e')
  })

  it('yields an empty string for Arabic or empty input', () => {
    expect(slugify('')).toBe('')
    expect(slugify('شركة الخليج لقطع الغيار')).toBe('')
  })

  it('keeps the ASCII part of a mixed-script name', () => {
    expect(slugify('شركة Gulf 2030')).toBe('gulf-2030')
  })

  it('caps the length without leaving a trailing hyphen', () => {
    const long = Array.from({ length: 40 }, () => 'ab').join(' ')
    const slug = slugify(long)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(SLUG_PATTERN)
  })

  it('always satisfies the database pattern when non-empty', () => {
    for (const name of ['Hello World', 'x', '42 Parts', 'Q8 — Kuwait', 'A--B']) {
      const slug = slugify(name)
      expect(slug, name).toMatch(SLUG_PATTERN)
    }
  })
})
