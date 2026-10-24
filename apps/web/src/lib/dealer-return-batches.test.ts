import { expect, it } from 'vitest'
import { returnBatchFixture as fixture } from './dealer-return-batches.fixture'
import { returnHandoffJson } from './dealer-return-handoffs'
import {
  batchInputSchema,
  batchSelection,
  returnBatchJson,
  returnBatchCsv,
  returnBatchPayloadSchema,
  returnBatchErrorKey,
  returnBatchParams,
  returnBatchSelectionHref,
} from './dealer-return-batches'
it('freezes copied JSON/CSV, complete approvals, exact quantities and safe spreadsheet cells', () => {
  const json = returnBatchJson(fixture),
    csv = returnBatchCsv(fixture)
  expect(json).toMatchSnapshot()
  expect(csv).toMatchSnapshot()
  const p = JSON.parse(json)
  expect(p.lines[0]).toEqual(JSON.parse(returnHandoffJson(fixture.lines[0])))
  expect(p.lines[0].request.report.input.quantity).toBe('999999999999999.999')
  expect(p).not.toHaveProperty('total_quantity')
  expect(p).not.toHaveProperty('sources_available')
  expect(csv).toContain('"\'=1+1"')
  expect(csv).toContain('قطعة')
  expect(csv).toContain('"requested_return_date"')
  expect(csv).not.toContain('"receipt_date"')
  expect(csv.startsWith('\ufeff')).toBe(true)
})
it('rejects malformed, repeated and oversized selections without silently dropping entries', () => {
  const id = fixture.lines[0].handoff_id
  for (const ids of [
    [],
    [id, id],
    ['bad'],
    Array.from({ length: 51 }, (_, i) => `cd270000-0000-4000-8000-${String(i).padStart(12, '0')}`),
  ])
    expect(batchInputSchema.safeParse(ids).success).toBe(false)
  expect(batchInputSchema.parse([id])).toEqual([id])
  expect(batchSelection({ handoff: [id, 'bad'] })).toEqual([id, 'bad'])
  expect(returnBatchSelectionHref([id])).toContain('handoff=' + id)
})
it('rejects unknown versions and unapproved copied evidence', () => {
  expect(returnBatchPayloadSchema.safeParse({ ...fixture, schema_version: 'v2' }).success).toBe(
    false,
  )
  expect(
    returnBatchPayloadSchema.safeParse({
      ...fixture,
      lines: [
        {
          ...fixture.lines[0],
          approval: { ...fixture.lines[0].approval, eligibility_confirmed: false },
        },
      ],
    }).success,
  ).toBe(false)
})
it('bounds history and translates only known domain errors', () => {
  expect(
    returnBatchParams({
      q: ' abc ',
      page: '999999999',
      size: '100000',
      sort: 'payload',
      dir: 'asc',
    }),
  ).toMatchObject({ q: 'abc', page: 100000, size: 25, sort: 'created_at', dir: 'desc' })
  expect(returnBatchErrorKey('batch_duplicate_item')).toBe('duplicateItem')
  expect(returnBatchErrorKey('private detail')).toBe('unavailable')
})
