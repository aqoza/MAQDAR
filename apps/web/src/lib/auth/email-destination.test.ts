import { describe, expect, it } from 'vitest'
import { emailDestination, emailReturnPath } from './email-destination'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
describe('tenant email destinations', () => {
  it('round trips only dashboard and concrete invitations', () => {
    for (const path of ['/dashboard', `/invitations/${id}`]) {
      expect(emailDestination(emailReturnPath(path).replace('/auth/email/', '').split('/'))).toBe(
        path,
      )
    }
  })
  it.each([
    [],
    ['https:', 'evil.com'],
    ['..', 'dashboard'],
    ['invitations', 'other'],
    ['dashboard', 'extra'],
    ['invitations', id, 'extra'],
  ])('refuses unapproved paths %j', (...parts) => {
    expect(emailDestination(parts as string[])).toBeNull()
  })
  it('cannot build arbitrary callback URLs', () => {
    expect(() => emailReturnPath('https://evil.com')).toThrow()
    expect(() => emailReturnPath('//evil.com')).toThrow()
  })
})
