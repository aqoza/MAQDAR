import fixture from './regional-handoffs.fixture.json'
import { handoffPayloadSchema } from './regional-handoffs'
export const handoffFixture = handoffPayloadSchema.parse(fixture)
