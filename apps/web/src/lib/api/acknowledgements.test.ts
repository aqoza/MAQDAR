import { describe, expect, it } from 'vitest'
import { acknowledgementInputSchema, parseAcknowledgementQuery } from './acknowledgements'

const valid = {
  client_event_id: '98000000-0000-4000-8000-000000000001',
  external_system: 'ERP',
  external_reference: '00123',
  status: 'received',
}
describe('acknowledgement input', () => {
  it('preserves reference and text and permits an omitted or null receipt reason', () => {
    expect(acknowledgementInputSchema.parse(valid)).toEqual(valid)
    expect(acknowledgementInputSchema.parse({ ...valid, reason: null }).reason).toBeNull()
    expect(
      acknowledgementInputSchema.parse({ ...valid, status: 'rejected', reason: 'Unknown item' })
        .reason,
    ).toBe('Unknown item')
  })
  it.each([
    { status: 'accepted' },
    { status: 'rejected' },
    { status: 'rejected', reason: null },
    { reason: '' },
    { reason: ' ' },
    { reason: '\nunsafe' },
    { reason: 'x'.repeat(1001) },
    { external_system: '' },
    { external_system: '\t' },
    { external_system: 'a'.repeat(81) },
    { external_reference: 123 },
    { external_reference: 'x'.repeat(201) },
    { client_event_id: 'bad' },
    { organization_id: valid.client_event_id },
  ])('rejects invalid fields %j', (change) => {
    expect(acknowledgementInputSchema.safeParse({ ...valid, ...change }).success).toBe(false)
  })
  it('allows bounded history paging but not handoff creation filters', () => {
    expect(parseAcknowledgementQuery(new URLSearchParams('limit=100&cursor=abc'))).toMatchObject({
      ok: true,
      limit: 100,
      cursor: 'abc',
    })
    for (const query of [
      'created_since=2026-10-01T00:00:00Z',
      'limit=101',
      'limit=1&limit=2',
      'cursor=',
      'status=rejected',
    ])
      expect(parseAcknowledgementQuery(new URLSearchParams(query)).ok).toBe(false)
  })
})
