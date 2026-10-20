import { handoffFixture as single } from './transfer-handoffs.fixture'
import type { NetworkHandoffPayload } from './network-handoffs'

const freight = single.estimate
const dates = freight.source
const branch = dates.source
const zeroId = 'a8200000-0000-4000-8000-000000000099'
const allocationId = 'a8200000-0000-4000-8000-000000000098'
const quantity = '999999999999999.999'
const policy = branch.destination.policy
const receipt = (p: 'p50' | 'p90') => ({
  ...dates.receipts[p]!,
  timing_review_required: false,
})
// Synthetic complete network with a positive branch and a zero branch.
export const handoffFixture: NetworkHandoffPayload = {
  ...single,
  schema_version: 'network-transfer-handoff-v1',
  proposal: {
    id: single.proposal.id,
    revision: single.proposal.revision,
    estimate_id: single.proposal.estimate_id,
    allocation_id: allocationId,
    submitted_by: single.proposal.submitted_by,
    submitted_at: single.proposal.submitted_at,
    reason: single.proposal.reason,
    approved_by: single.proposal.approved_by,
    approved_at: single.proposal.approved_at,
    approval_reason: single.proposal.approval_reason,
  },
  estimate: {
    method: 'network-freight-v1',
    status: 'available',
    scenario_id: freight.scenario_id,
    source_location_id: freight.source_location_id,
    terms_confirmed: true,
    sender: freight.sender,
    rounding: freight.rounding,
    fingerprint: freight.fingerprint,
    totals: [{ currency: 'KWD', minor_units: 3, subtotal: quantity }],
    lines: [
      { ...freight, location_code: policy.location_code, quantity },
      {
        ...freight,
        location_id: zeroId,
        location_code: 'ZERO',
        quantity: '0.000',
        status: 'no_transfer_needed',
        receiver: null,
        terms: null,
        shipment_count: null,
        exact_product: null,
        subtotal: null,
      },
    ],
    source: {
      method: 'network-dates-v1',
      status: 'available',
      allocation_id: allocationId,
      requested_date: dates.requested_date,
      calendars_confirmed: true,
      sender: dates.sender,
      source_calendar: dates.source_calendar,
      dispatch: dates.dispatch,
      fingerprint: dates.fingerprint,
      source_location_id: dates.source_location_id,
      lines: [
        {
          ...dates,
          location_id: freight.location_id,
          location_code: policy.location_code,
          quantity,
          policy_reference: {
            id: policy.policy_id,
            cutoff: policy.cutoff,
            unit: 'EA',
            lead_time: 10,
            review_interval: 4,
          },
          receipts: { p50: receipt('p50'), p90: receipt('p90') },
        },
        {
          ...dates,
          location_id: zeroId,
          location_code: 'ZERO',
          quantity: '0.000',
          status: 'no_transfer_needed',
          policy_reference: null,
          timing_reference_date: null,
          receipts: {},
        },
      ],
      source: {
        method: 'network-allocation-v1',
        status: 'available',
        source_policy_id: branch.source_policy_id,
        source_location_id: branch.source_location_id,
        source_location_code: branch.source_location_code!,
        source_location_type: 'central',
        source_active: true,
        item_id: branch.source_item_id!,
        source_policy: { ...branch.source_policy!, item_code: '000123' },
        basis: branch.basis,
        override_id: branch.override_id,
        backorders: branch.backorders,
        commitments_confirmed: true,
        lanes_confirmed: true,
        source_surplus: quantity,
        total_gap: quantity,
        allocated: quantity,
        remaining_surplus: '0.000',
        retained_available: '20.000',
        fingerprint: branch.fingerprint,
        lines: [
          {
            draft_id: branch.draft_id,
            location_id: freight.location_id,
            location_code: policy.location_code,
            location_type: 'branch',
            active: true,
            gap: quantity,
            quantity,
            remaining_gap: '0.000',
            evidence: branch,
          },
          {
            draft_id: zeroId,
            location_id: zeroId,
            location_code: 'ZERO',
            location_type: 'branch',
            active: true,
            gap: '0.000',
            quantity: '0.000',
            remaining_gap: '0.000',
            evidence: branch,
          },
        ],
      },
    },
  },
}
