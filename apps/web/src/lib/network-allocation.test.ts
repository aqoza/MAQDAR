import { expect, it } from 'vitest'
import {
  networkInputSchema,
  networkSaveSchema,
  networkParams,
  networkRpcInput,
} from './network-allocation'
const id = 'a8000000-0000-4000-8000-000000000001'
const input = {
  policy: id,
  drafts: [id],
  maximum: 'calculated',
  backorders: '4.125',
  commitments: 'true',
  lanes: 'true',
}
it('requires an explicit bounded draft selection and precise commitments', () => {
  for (const patch of [
    { drafts: [] },
    { drafts: [id, id] },
    { drafts: Array.from({ length: 21 }, (_, n) => id.slice(0, -2) + String(n).padStart(2, '0')) },
    { backorders: '-1' },
    { backorders: '1.0001' },
    { backorders: 'NaN' },
    { maximum: 'approved' },
  ])
    expect(networkInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
})
it('normalizes Arabic quantity digits and preserves decimal strings in RPCs', () => {
  const parsed = networkInputSchema.parse({ ...input, backorders: '٤.١٢٥' })
  expect(networkRpcInput(parsed)).toMatchObject({
    p_backorders: '4.125',
    p_draft_ids: [id],
    p_basis: 'calculated',
    p_lanes_confirmed: true,
  })
})
it('supports repeated draft query parameters without silently truncating selections', () => {
  expect(networkParams({ draft: [id, 'second'] }).drafts).toEqual([id, 'second'])
  expect(networkParams({ draft: id }).drafts).toEqual([id])
  expect(
    networkSaveSchema.safeParse({
      ...input,
      lanes: 'false',
      request_id: id,
      fingerprint: 'a'.repeat(64),
    }).success,
  ).toBe(false)
})
