import { expect, it } from 'vitest'
import { qualityRowSchema } from './forecast-quality'
import { draftSaveSchema, replenishmentReportSchema } from './replenishment'
import { handoffPayloadSchema, handoffJson } from './purchase-handoffs'
import { proposalSchema, workbenchRowSchema } from './policy-workbench'
import { optionalUuidSchema, uuidSchema } from './master-data/schemas'
import quality from './fixtures/postgres-quality.json'
import draft from './fixtures/postgres-draft.json'
import handoff from './fixtures/postgres-handoff.json'

// PostgreSQL accepts these canonical UUIDs without RFC version/variant restrictions.
// These synthetic saved records reproduced live Forecasts and draft-detail failures.
const resourceId = '45fccdfa-6816-12b4-6722-8b9776fc6925'
const requestId = '93000000-0000-4000-8000-000000000001'

it('renders saved forecast quality without changing identifiers or exact scores', () => {
  const row = qualityRowSchema.parse(quality)
  expect(row.item_id).toBe(resourceId)
  expect(row.run_id).toBe(quality.run_id)
  expect(row.rmse).toBe(quality.rmse)
  expect(row.evaluation).toEqual(quality.evaluation)
})

it('reads nested stock and location references in saved replenishment evidence', () => {
  expect(replenishmentReportSchema.parse(draft)).toEqual(draft)
})

it('retains saved handoff references and lossless exported evidence', () => {
  expect(handoffPayloadSchema.parse(handoff)).toEqual(handoff)
  expect(JSON.parse(handoffJson(handoffPayloadSchema.parse(handoff)))).toEqual(handoff)
})

it('accepts database references in forms and policy review rows', () => {
  expect(optionalUuidSchema.parse(' ' + resourceId.toUpperCase() + ' ')).toBe(resourceId)
  expect(uuidSchema.parse(resourceId)).toBe(resourceId)
  expect(optionalUuidSchema.parse('')).toBeNull()
  expect(
    proposalSchema.parse({
      policy_id: resourceId,
      request_id: requestId,
      reorder_point: '1',
      order_up_to: '2',
      reason: 'Synthetic review',
    }).policy_id,
  ).toBe(resourceId)
  expect(
    workbenchRowSchema.parse({
      id: resourceId,
      run_id: resourceId,
      location_id: resourceId,
      item_code: 'SYN-ACME-ACD-017',
      location_code: 'SYN-ACME-OM-MCT',
      unit: 'EA',
      status: 'available',
      to_date: '2026-09-30',
      finished_at: '2026-10-01',
      calculated_reorder: '1',
      calculated_maximum: '2',
      approved_reorder: null,
      approved_maximum: null,
      review_status: 'none',
    }).location_id,
  ).toBe(resourceId)
})

it.each(['bad', '45fccdfa681612b467228b9776fc6925', resourceId + "'", '%', '', null])(
  'continues to reject malformed resource identifiers: %s',
  (value) => {
    expect(uuidSchema.safeParse(value).success).toBe(false)
    expect(qualityRowSchema.safeParse({ ...quality, run_id: value }).success).toBe(false)
  },
)

it('keeps client retry tokens restricted to RFC UUIDs', () => {
  const input = {
    policy: resourceId,
    basis: 'calculated',
    backorders: '0',
    confirmed: 'true',
    fingerprint: 'a'.repeat(64),
    request_id: requestId,
  }
  expect(draftSaveSchema.safeParse(input).success).toBe(true)
  expect(draftSaveSchema.safeParse({ ...input, request_id: resourceId }).success).toBe(false)
})
