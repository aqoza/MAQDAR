import { describe, expect, it } from 'vitest'
import { resolveLocale } from './resolve'

describe('resolveLocale', () => {
  it('defaults to English without a cookie or an organization default', () => {
    expect(resolveLocale({ cookie: undefined, arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: undefined, arabicEnabled: null })).toBe('en')
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: true, organizationDefault: null }),
    ).toBe('en')
  })

  it('returns Arabic when the cookie asks for it and the organization enables it', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: true })).toBe('ar')
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: true, organizationDefault: 'en' })).toBe(
      'ar',
    )
  })

  it('refuses Arabic when the organization has it switched off', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: false })).toBe('en')
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: false, organizationDefault: 'ar' })).toBe(
      'en',
    )
  })

  it('refuses Arabic for anonymous users and users without an active organization', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: null })).toBe('en')
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: null, organizationDefault: 'ar' })).toBe(
      'en',
    )
  })

  it('keeps English when the cookie says so, whatever the organization prefers', () => {
    expect(resolveLocale({ cookie: 'en', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: 'en', arabicEnabled: false })).toBe('en')
    expect(resolveLocale({ cookie: 'en', arabicEnabled: true, organizationDefault: 'ar' })).toBe(
      'en',
    )
  })

  it('uses the organization default when there is no cookie', () => {
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: true, organizationDefault: 'ar' }),
    ).toBe('ar')
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: true, organizationDefault: 'en' }),
    ).toBe('en')
  })

  it('ignores an Arabic organization default while Arabic is switched off', () => {
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: false, organizationDefault: 'ar' }),
    ).toBe('en')
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: null, organizationDefault: 'ar' }),
    ).toBe('en')
  })

  it('treats unknown or differently cased cookie values as no cookie', () => {
    expect(resolveLocale({ cookie: 'fr', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: 'AR', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: '', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: 'fr', arabicEnabled: true, organizationDefault: 'ar' })).toBe(
      'ar',
    )
    expect(resolveLocale({ cookie: '', arabicEnabled: false, organizationDefault: 'ar' })).toBe(
      'en',
    )
  })

  it('ignores unknown organization defaults', () => {
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: true, organizationDefault: 'AR' }),
    ).toBe('en')
    expect(
      resolveLocale({ cookie: undefined, arabicEnabled: true, organizationDefault: 'fr' }),
    ).toBe('en')
  })
})
