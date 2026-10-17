import { expect, it } from 'vitest'
import {
  redistributionInputSchema,
  redistributionSaveSchema,
  redistributionParams,
  redistributionRpcInput,
  redistributionListParams,
} from './redistribution'
const id = 'a8000000-0000-4000-8000-000000000001'
const input = {
  draft: id,
  policy: id,
  maximum: 'calculated',
  backorders: '4.125',
  commitments: 'true',
  lane: 'true',
}
it('requires an explicit maximum and backorders, preserving exact supported decimals', () => {
  expect(
    redistributionInputSchema.parse({ ...input, backorders: '٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩.٩٩٩' }).backorders,
  ).toBe('999999999999999.999')
  for (const backorders of ['', '-1', '1.0001', 'NaN', '1e3', '1000000000000000'])
    expect(redistributionInputSchema.safeParse({ ...input, backorders }).success).toBe(false)
  expect(redistributionInputSchema.safeParse({ ...input, maximum: '' }).success).toBe(false)
  expect(redistributionInputSchema.safeParse({ ...input, maximum: 'approved' }).success).toBe(false)
})
it('maps calculated and specific approved revisions without inventing a selection', () => {
  expect(redistributionRpcInput(redistributionInputSchema.parse(input))).toMatchObject({
    p_basis: 'calculated',
    p_override_id: undefined,
    p_backorders: '4.125',
  })
  expect(
    redistributionRpcInput(redistributionInputSchema.parse({ ...input, maximum: id })),
  ).toMatchObject({ p_basis: 'approved', p_override_id: id })
})
it('defaults missing attestations to false and forbids saving unconfirmed previews', () => {
  const values = redistributionParams({
    draft: [id, 'ignored'],
    policy: id,
    maximum: 'calculated',
    backorders: '0',
  })
  expect(values).toMatchObject({ draft: id, commitments: 'false', lane: 'false' })
  expect(redistributionInputSchema.safeParse(values).success).toBe(true)
  expect(
    redistributionSaveSchema.safeParse({ ...values, request_id: id, fingerprint: 'a'.repeat(64) })
      .success,
  ).toBe(false)
})
it('bounds history filters and pagination', () => {
  expect(
    redistributionListParams({
      draft: id,
      page: '999999',
      size: '999',
      sort: 'report',
      dir: 'wrong',
    }),
  ).toMatchObject({
    page: 100000,
    size: 25,
    sort: 'created_at',
    dir: 'desc',
    filters: { draft: id },
  })
  expect(redistributionListParams({ draft: 'bad' }).filters).toEqual({})
})
