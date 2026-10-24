import { expect, it } from 'vitest'
import { returnHandoffFixture } from './dealer-return-handoffs.fixture'
import {
  returnHandoffCsv,
  returnHandoffJson,
  returnHandoffPayloadSchema,
  returnHandoffParams,
} from './dealer-return-handoffs'

it('pins versioned JSON/CSV bytes, exact quantities and copied approval evidence', () => {
  const json = returnHandoffJson(returnHandoffFixture),
    csv = returnHandoffCsv(returnHandoffFixture)
  expect(json).toMatchSnapshot()
  expect(csv).toMatchSnapshot()
  expect(JSON.parse(json).request.report.input.quantity).toBe('999999999999999.999')
  expect(csv).toContain('"999999999999999.999"')
  expect(csv.startsWith('\ufeff')).toBe(true)
  expect(csv).toContain('"requested_return_date"')
  expect(csv).not.toContain('"receipt_date"')
  expect(csv).toContain('"\'=1+1"')
  expect(csv).toContain('"INV-""1"""')
  expect(csv).toContain('قطعة')
  expect(csv.split('\r\n')).toHaveLength(3)
})
it('refuses unapproved or unconfirmed payloads and unknown export versions', () => {
  for (const change of [
    { schema_version: 'dealer-return-handoff-v2' },
    { approval: { ...returnHandoffFixture.approval, decision: 'rejected' } },
    { approval: { ...returnHandoffFixture.approval, eligibility_confirmed: false } },
  ])
    expect(
      returnHandoffPayloadSchema.safeParse({ ...returnHandoffFixture, ...change }).success,
    ).toBe(false)
})
it('bounds searchable history without user-selected table columns', () => {
  expect(
    returnHandoffParams({
      q: ' abc ',
      page: '999999999',
      size: '100000',
      sort: 'payload',
      dir: 'asc',
    }),
  ).toMatchObject({ q: 'abc', page: 100000, size: 25, sort: 'created_at', dir: 'desc' })
})
