import { describe, expect, it } from 'vitest'
import {
  clientNamespaces,
  directionOf,
  intlLocaleFor,
  intlLocales,
  isAppLocale,
  isNumberingSystem,
  pickNamespaces,
  timeZoneOrFallback,
  toAppLocale,
} from './config'

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
    expect(toAppLocale('ar-u-nu-arab')).toBe('ar')
    expect(toAppLocale('de-DE')).toBe('en')
  })

  it('pins Arabic to Latin digits by default', () => {
    expect(new Intl.NumberFormat(intlLocales.ar).format(1234.5)).toBe('1,234.5')
  })

  it('mirrors direction for Arabic', () => {
    expect(directionOf('en')).toBe('ltr')
    expect(directionOf('ar')).toBe('rtl')
  })
})

describe('intlLocaleFor', () => {
  it('always uses plain English digits for English', () => {
    expect(intlLocaleFor('en', 'latn')).toBe('en')
    expect(intlLocaleFor('en', 'arab')).toBe('en')
    expect(intlLocaleFor('en')).toBe('en')
  })

  it('adds the numbering system for Arabic', () => {
    expect(intlLocaleFor('ar', 'latn')).toBe('ar-u-nu-latn')
    expect(intlLocaleFor('ar', 'arab')).toBe('ar-u-nu-arab')
  })

  it('falls back to Latin digits for a missing or unknown numbering system', () => {
    expect(intlLocaleFor('ar')).toBe('ar-u-nu-latn')
    expect(intlLocaleFor('ar', null)).toBe('ar-u-nu-latn')
    expect(intlLocaleFor('ar', 'thai')).toBe('ar-u-nu-latn')
    expect(intlLocaleFor('ar', 'ARAB')).toBe('ar-u-nu-latn')
  })

  it('produces tags that format digits as promised', () => {
    expect(new Intl.NumberFormat(intlLocaleFor('ar', 'latn')).format(123)).toBe('123')
    expect(new Intl.NumberFormat(intlLocaleFor('ar', 'arab')).format(123)).toBe('١٢٣')
    expect(new Intl.NumberFormat(intlLocaleFor('en', 'arab')).format(123)).toBe('123')
  })

  it('recognizes only the stored numbering systems', () => {
    expect(isNumberingSystem('latn')).toBe(true)
    expect(isNumberingSystem('arab')).toBe(true)
    expect(isNumberingSystem('arabext')).toBe(false)
    expect(isNumberingSystem(null)).toBe(false)
  })
})

describe('timeZoneOrFallback', () => {
  it('keeps zones the runtime knows', () => {
    expect(timeZoneOrFallback('Asia/Riyadh')).toBe('Asia/Riyadh')
    expect(timeZoneOrFallback('UTC')).toBe('UTC')
  })

  it('falls back to UTC for missing or unknown zones', () => {
    expect(timeZoneOrFallback(null)).toBe('UTC')
    expect(timeZoneOrFallback(undefined)).toBe('UTC')
    expect(timeZoneOrFallback('')).toBe('UTC')
    expect(timeZoneOrFallback('Mars/Olympus_Mons')).toBe('UTC')
  })
})

describe('pickNamespaces', () => {
  it('keeps only the listed namespaces and skips missing ones', () => {
    const messages = { Common: { save: 'Save' }, Items: { title: 'Items' }, Nav: { home: 'Home' } }
    expect(pickNamespaces(messages, ['Common', 'Nav', 'Missing'])).toEqual({
      Common: { save: 'Save' },
      Nav: { home: 'Home' },
    })
  })

  it('lists the namespaces used by Client Components', () => {
    for (const namespace of ['Common', 'Auth', 'Nav', 'Organizations', 'Roles', 'Settings']) {
      expect(clientNamespaces).toContain(namespace)
    }
  })
})
