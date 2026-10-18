import { handoffPayloadSchema } from './event-purchase-handoffs'
import payload from './event-purchase-handoffs.fixture.json'
/** Synthetic local RPC evidence with large decimals to detect lossy serialization. */
export const handoffFixture = handoffPayloadSchema.parse(payload)
