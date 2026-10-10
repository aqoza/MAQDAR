import { describe, expect, it } from 'vitest'
import { resolveLocale } from './resolve'

describe('resolveLocale', () => {
  it('defaults to English without a cookie', () => {
    expect(resolveLocale({ cookie: undefined, arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: undefined, arabicEnabled: null })).toBe('en')
  })

  it('returns Arabic only when the cookie asks for it and the organization enables it', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: true })).toBe('ar')
  })

  it('refuses Arabic when the organization has it switched off', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: false })).toBe('en')
  })

  it('refuses Arabic for anonymous users and users without an active organization', () => {
    expect(resolveLocale({ cookie: 'ar', arabicEnabled: null })).toBe('en')
  })

  it('keeps English when the cookie says so, whatever the organization allows', () => {
    expect(resolveLocale({ cookie: 'en', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: 'en', arabicEnabled: false })).toBe('en')
  })

  it('treats unknown or differently cased cookie values as English', () => {
    expect(resolveLocale({ cookie: 'fr', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: 'AR', arabicEnabled: true })).toBe('en')
    expect(resolveLocale({ cookie: '', arabicEnabled: true })).toBe('en')
  })
})
