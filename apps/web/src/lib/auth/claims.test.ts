import { describe, expect, it } from 'vitest'
import { describeRejectedClaims, parseClaims } from './claims'

const SUB = 'fb72b124-1b8e-4868-a6a7-1361b44577eb'
const ORG = '2cd8944d-52a1-45e2-9230-6f4fd0a2c6d4'

describe('parseClaims', () => {
  it('reads the hook claims', () => {
    expect(
      parseClaims({ sub: SUB, email: 'a@b.co', org_id: ORG, org_role: 'owner' }),
    ).toMatchObject({
      sub: SUB,
      email: 'a@b.co',
      org_id: ORG,
      org_role: 'owner',
    })
  })

  it('accepts tokens issued before the hook or with odd optional claims', () => {
    expect(parseClaims({ sub: SUB })).toMatchObject({ sub: SUB, org_id: null, org_role: null })
    expect(parseClaims({ sub: SUB, email: null, org_id: 42, org_role: 'root' })).toMatchObject({
      email: undefined,
      org_id: null,
      org_role: null,
    })
    expect(parseClaims({ sub: SUB, org_id: ORG.toUpperCase() })?.org_id).toBe(ORG)
  })

  it('rejects claims without a user id', () => {
    expect(parseClaims({ email: 'a@b.co' })).toBeNull()
    expect(parseClaims({ sub: 'not-a-uuid' })).toBeNull()
    expect(parseClaims(null)).toBeNull()
  })
})

describe('describeRejectedClaims', () => {
  it('names the failing claim and the keys, never the values', () => {
    const description = describeRejectedClaims({ sub: 'secret-value', email: 'a@b.co' })
    expect(description.keys).toEqual(['sub', 'email'])
    expect(JSON.stringify(description)).not.toContain('secret-value')
    expect(JSON.stringify(description)).not.toContain('a@b.co')
  })
})
