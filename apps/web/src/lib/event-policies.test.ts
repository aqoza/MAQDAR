import { expect, it } from 'vitest'
import {
  eventPolicyFormValues,
  eventPolicyInputSchema,
  eventPolicySaveSchema,
} from './event-policies'
const id = '99100000-0000-4000-8000-000000000001'
const valid = {
  event_id: id,
  policy_id: id,
  reason: ' Fixed demand ',
  request_id: id,
  fingerprint: 'a'.repeat(64),
}
it('canonicalizes the reason and never accepts client calculation values', () => {
  expect(eventPolicyInputSchema.parse({ ...valid, target: '999', service_level: '1' })).toEqual({
    event_id: id,
    policy_id: id,
    reason: 'Fixed demand',
  })
})
it.each([
  { event_id: 'bad' },
  { policy_id: null },
  { reason: ' ' },
  { reason: 'a'.repeat(2001) },
  { request_id: '' },
  { fingerprint: 'bad' },
])('rejects invalid save inputs %j', (change) => {
  expect(eventPolicySaveSchema.safeParse({ ...valid, ...change }).success).toBe(false)
})
it('reads only the supported fields from the form', () => {
  const form = new FormData()
  Object.entries({ ...valid, target: '123' }).forEach(([key, value]) => form.set(key, value))
  expect(eventPolicyFormValues(form)).toEqual(valid)
})
