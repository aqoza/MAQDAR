import { describe, expect, it } from 'vitest'
import { directionOf, intlLocales, isAppLocale, toAppLocale } from './config'

describe('locale config', () => {
  it('accepts only the supported application locales', () => {
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('ar')).toBe(true)
    expect(isAppLocale('fr')).toBe(false)
    expect(isAppLocale(undefined)).toBe(false)
  })

  it('maps Intl tags back to application locales', () => {
    expect(toAppLocale(intlLocales.ar)).toBe('ar')
    expect(toAppLocale(intlLocales.en)).toBe('en')
    expect(toAppLocale('de-DE')).toBe('en')
  })

  it('pins Arabic to Latin digits', () => {
    expect(new Intl.NumberFormat(intlLocales.ar).format(1234.5)).toBe('1,234.5')
  })

  it('mirrors direction for Arabic', () => {
    expect(directionOf('en')).toBe('ltr')
    expect(directionOf('ar')).toBe('rtl')
  })
})
