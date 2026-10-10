import { describe, expect, it } from 'vitest'
import { ar, deepMerge, en, messagesFor } from './messages'

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (typeof value !== 'object' || value === null) throw new Error(`Unexpected value at ${prefix}`)
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, child]) => {
    Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key))
    return acc
  }, {})
}

// Argument names are followed by `}` or `,` (`{email}`, `{count, plural, …}`); the text inside
// plural or select cases (`one {You have # …}`) is not an argument and may be in any script.
const icuArguments = (message: string) =>
  [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]).sort()

const flatEn = flatten(en)
const flatAr = flatten(ar)

describe('message files', () => {
  it('en.json is complete (no empty strings)', () => {
    for (const [key, value] of Object.entries(flatEn)) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('every ar.json key exists in en.json', () => {
    const missing = Object.keys(flatAr).filter((key) => !(key in flatEn))
    expect(missing).toEqual([])
  })

  it('ar.json keeps the ICU arguments of the English message', () => {
    for (const [key, value] of Object.entries(flatAr)) {
      expect(icuArguments(value), key).toEqual(icuArguments(flatEn[key] ?? ''))
    }
  })

  it('Arabic falls back to English for untranslated keys', () => {
    const merged = flatten(messagesFor('ar'))
    expect(Object.keys(merged).sort()).toEqual(Object.keys(flatEn).sort())
    expect(merged['Nav.dashboard']).toBe(flatAr['Nav.dashboard'])
    expect(merged['Dashboard.empty']).toBe(flatEn['Dashboard.empty'])
  })

  it('English messages are returned untouched', () => {
    expect(messagesFor('en')).toBe(en)
  })
})

describe('deepMerge', () => {
  it('merges nested objects without mutating the base', () => {
    const base = { a: { b: 'en', c: 'en' }, d: 'en' }
    const merged = deepMerge(base, { a: { b: 'ar' } })
    expect(merged).toEqual({ a: { b: 'ar', c: 'en' }, d: 'en' })
    expect(base.a.b).toBe('en')
  })
})
