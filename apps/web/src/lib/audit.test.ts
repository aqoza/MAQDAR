import { createTranslator } from 'next-intl'
import { expect, it } from 'vitest'
import messages from '../../messages/en.json'
import { auditEntityKey } from './audit'

it('translates planning audit records outside the import contract', () => {
  const t = createTranslator({ locale: 'en', messages, namespace: 'Audit.entities' })
  for (const [table, expected] of [
    ['purchase_proposals', 'Purchase proposals'],
    ['policy_overrides', 'Policy revisions'],
    ['purchase_handoff_batches', 'Purchase handoff batches'],
    ['delivery_scenarios', 'Delivery scenarios'],
    ['purchase_cost_estimates', 'Purchase cost estimates'],
    ['brands', 'Brands'],
  ]) {
    expect(t(auditEntityKey(table))).toBe(expected)
  }
})

it('shows a translated fallback for a future entity instead of a missing message key', () => {
  const t = createTranslator({ locale: 'en', messages, namespace: 'Audit.entities' })
  expect(t(auditEntityKey('future_business_table'))).toBe('Other business record')
})
