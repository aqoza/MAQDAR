import { describe, expect, it } from 'vitest'
import { isDocumentNavigation } from './document-request'

const headers = (entries: Record<string, string>) => new Headers(entries)

describe('isDocumentNavigation', () => {
  it('is true for a followed link (Fetch Metadata navigate)', () => {
    expect(
      isDocumentNavigation(headers({ 'sec-fetch-mode': 'navigate', accept: 'text/html,*/*' })),
    ).toBe(true)
  })

  it('is false for fetches, whatever they accept', () => {
    expect(
      isDocumentNavigation(headers({ 'sec-fetch-mode': 'cors', accept: 'application/json' })),
    ).toBe(false)
    expect(
      isDocumentNavigation(headers({ 'sec-fetch-mode': 'same-origin', accept: 'text/html' })),
    ).toBe(false)
  })

  it('falls back to Accept without Fetch Metadata', () => {
    expect(isDocumentNavigation(headers({ accept: 'text/html,application/xhtml+xml' }))).toBe(true)
    expect(isDocumentNavigation(headers({ accept: 'application/json' }))).toBe(false)
    expect(isDocumentNavigation(headers({}))).toBe(false)
  })
})
