import { describe, expect, it } from 'vitest'
import {
  supplierResponseInput,
  supplierResponseHistorySchema,
  responsePage,
} from './supplier-responses'
const id = '98100000-0000-4000-8000-000000000001'
const input = {
  grant_id: id,
  publication_id: id,
  request_id: id,
  kind: 'batch',
  status: 'received',
  reference: '',
  reason: '',
}
describe('supplier response boundaries', () => {
  it('requires a declined reason and bounds user text without interpreting it', () => {
    expect(supplierResponseInput.safeParse(input).success).toBe(true)
    for (const changed of [
      { status: 'accepted' },
      { status: 'declined', reason: ' ' },
      { reason: 'x'.repeat(2001) },
      { reference: 'x'.repeat(121) },
      { reference: 'bad\nref' },
      { request_id: 'bad' },
    ])
      expect(supplierResponseInput.safeParse({ ...input, ...changed }).success).toBe(false)
    expect(
      supplierResponseInput.parse({
        ...input,
        status: 'declined',
        reason: ' <script>literal text</script> ',
      }).reason,
    ).toBe('<script>literal text</script>')
  })
  it('rejects private fields from the supplier history response', () => {
    const event = {
      id,
      revision: 1,
      status: 'received',
      reference: '',
      reason: '',
      author: 'supplier@example.com',
      created_at: '2026-10-23T20:00:00Z',
    }
    const page = { total: 1, page: 1, size: 25, latest: event, rows: [event] }
    expect(supplierResponseHistorySchema.safeParse(page).success).toBe(true)
    for (const extra of [
      'grant_id',
      'organization_id',
      'supplier_id',
      'request_id',
      'actor_id',
      'stock',
    ])
      expect(
        supplierResponseHistorySchema.safeParse({ ...page, rows: [{ ...event, [extra]: id }] })
          .success,
      ).toBe(false)
    expect(
      supplierResponseHistorySchema.safeParse({ ...page, rows: Array(26).fill(event) }).success,
    ).toBe(false)
  })
  it('bounds URL history pages', () => {
    for (const value of [undefined, [], ['2'], '0', '-1', 'NaN', '100001', '1e2'])
      expect(responsePage(value)).toBe(1)
    expect(responsePage('100000')).toBe(100000)
    expect(responsePage('2')).toBe(2)
  })
})
