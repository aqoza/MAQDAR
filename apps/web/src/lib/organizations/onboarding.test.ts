import { describe, expect, it } from 'vitest'
import { directoryQuery, parseInvitationEmails } from './onboarding'

describe('bulk invitation input', () => {
  it('reads one-column CSV with a header and normalizes addresses', () => {
    expect(parseInvitationEmails('email\r\n"ONE@example.com"\r\ntwo@example.com')).toEqual(['one@example.com', 'two@example.com'])
  })
  it('accepts 1,001 recipients and refuses an oversized queue request', () => {
    const addresses = Array.from({ length: 1001 }, (_, n) => `person${n}@example.com`)
    expect(parseInvitationEmails(addresses.join('\n'))).toHaveLength(1001)
    expect(() => parseInvitationEmails(Array(2001).fill('person@example.com').join('\n'))).toThrow()
  })
  it.each(['a@example.com\nA@example.com', 'email,role\na@example.com,owner', 'bad-address', '', 'a@example.com\n\"unterminated'])('rejects invalid or duplicate CSV: %s', (input) => {
    expect(() => parseInvitationEmails(input)).toThrow()
  })
})
describe('directory query bounds', () => {
  it('keeps page 11 address search available above the Data API row cap', () => {
    expect(directoryQuery({ members_page: '11', members_search: ' User1001@ ' }, 'members')).toEqual({ page: 11, search: 'User1001@' })
  })
  it('bounds malformed page/search values', () => {
    expect(directoryQuery({ members_page: '-1', members_search: ['unsafe'] }, 'members')).toEqual({ page: 1, search: '' })
    expect(directoryQuery({ members_page: '10001' }, 'members').page).toBe(1)
  })
})
