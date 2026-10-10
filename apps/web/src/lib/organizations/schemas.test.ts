import { describe, expect, it } from 'vitest'
import {
  countryCodeSchema,
  createOrganizationSchema,
  currencyCodeSchema,
  emailSchema,
  inviteSchema,
  organizationNameSchema,
  organizationSettingsSchema,
  roleSchema,
  slugSchema,
} from './schemas'

describe('organizationNameSchema', () => {
  it('trims and accepts 1 to 200 characters', () => {
    expect(organizationNameSchema.parse('  Gulf Auto Parts ')).toBe('Gulf Auto Parts')
    expect(organizationNameSchema.safeParse('x'.repeat(200)).success).toBe(true)
  })

  it('rejects blank and over-long names', () => {
    expect(organizationNameSchema.safeParse('   ').success).toBe(false)
    expect(organizationNameSchema.safeParse('x'.repeat(201)).success).toBe(false)
  })
})

describe('slugSchema', () => {
  it('lower-cases and accepts the database pattern', () => {
    expect(slugSchema.parse(' Gulf-Auto-2030 ')).toBe('gulf-auto-2030')
    expect(slugSchema.safeParse('a').success).toBe(true)
  })

  it('rejects empty, malformed and over-long slugs', () => {
    expect(slugSchema.safeParse('').success).toBe(false)
    expect(slugSchema.safeParse('-leading').success).toBe(false)
    expect(slugSchema.safeParse('double--hyphen').success).toBe(false)
    expect(slugSchema.safeParse('under_score').success).toBe(false)
    expect(slugSchema.safeParse('عربي').success).toBe(false)
    expect(slugSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })

  it('reports the empty slug as too_small first', () => {
    const result = slugSchema.safeParse('')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.code).toBe('too_small')
  })
})

describe('currency and country codes', () => {
  it('upper-case the codes', () => {
    expect(currencyCodeSchema.parse('sar')).toBe('SAR')
    expect(countryCodeSchema.parse(' ae ')).toBe('AE')
  })

  it('reject other shapes', () => {
    expect(currencyCodeSchema.safeParse('SA').success).toBe(false)
    expect(currencyCodeSchema.safeParse('SAR1').success).toBe(false)
    expect(countryCodeSchema.safeParse('SAU').success).toBe(false)
    expect(countryCodeSchema.safeParse('').success).toBe(false)
  })
})

describe('emailSchema', () => {
  it('normalizes to trimmed lower-case', () => {
    expect(emailSchema.parse('  Ali@Example.COM ')).toBe('ali@example.com')
  })

  it('rejects empty and malformed addresses', () => {
    expect(emailSchema.safeParse('').success).toBe(false)
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    expect(emailSchema.safeParse('a@b').success).toBe(false)
  })

  it('reports the empty address as too_small, a malformed one as invalid_format', () => {
    const empty = emailSchema.safeParse('')
    const malformed = emailSchema.safeParse('nope')
    if (!empty.success) expect(empty.error.issues[0]?.code).toBe('too_small')
    if (!malformed.success) expect(malformed.error.issues[0]?.code).toBe('invalid_format')
  })
})

describe('roleSchema', () => {
  it('accepts every membership role and nothing else', () => {
    for (const role of ['owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer']) {
      expect(roleSchema.safeParse(role).success, role).toBe(true)
    }
    const result = roleSchema.safeParse('superuser')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.code).toBe('invalid_value')
  })
})

describe('object schemas', () => {
  const settings = {
    name: 'Gulf Auto',
    base_currency: 'sar',
    home_country: 'sa',
    arabic_enabled: true,
  }

  it('organizationSettingsSchema normalizes codes', () => {
    expect(organizationSettingsSchema.parse(settings)).toEqual({
      name: 'Gulf Auto',
      base_currency: 'SAR',
      home_country: 'SA',
      arabic_enabled: true,
    })
  })

  it('createOrganizationSchema adds the slug', () => {
    expect(createOrganizationSchema.parse({ ...settings, slug: 'Gulf-Auto' }).slug).toBe(
      'gulf-auto',
    )
    const result = createOrganizationSchema.safeParse({ ...settings, slug: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('slug')
    }
  })

  it('inviteSchema requires a valid e-mail and role', () => {
    expect(inviteSchema.parse({ email: 'A@B.co', role: 'viewer' })).toEqual({
      email: 'a@b.co',
      role: 'viewer',
    })
    const result = inviteSchema.safeParse({ email: 'x', role: 'god' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual(['email', 'role'])
    }
  })
})
