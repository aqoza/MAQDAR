import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createOrganizationSchema, inviteSchema } from './organizations/schemas'
import { fieldErrorsFrom, validationKeyFor, type ValidationTranslator } from './validation'

/** Stub translator: renders the key and its ICU arguments so tests can assert on both. */
const t: ValidationTranslator = (key, values) =>
  values
    ? `${key}:${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}`
    : key

function issuesOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected a validation failure')
  return result.error
}

describe('validationKeyFor', () => {
  it('maps too_small to required at minimum 1 and tooShort above it', () => {
    const [required] = issuesOf(z.string().min(1), '').issues
    const [tooShort] = issuesOf(z.string().min(8), 'abc').issues
    expect(validationKeyFor(required!)).toEqual({ key: 'required' })
    expect(validationKeyFor(tooShort!)).toEqual({ key: 'tooShort', values: { min: 8 } })
  })

  it('maps too_big to tooLong with the maximum', () => {
    const [issue] = issuesOf(z.string().max(3), 'abcd').issues
    expect(validationKeyFor(issue!)).toEqual({ key: 'tooLong', values: { max: 3 } })
  })

  it('maps invalid_format by field name', () => {
    const schema = z.object({
      slug: z.string().regex(/^[a-z]+$/),
      base_currency: z.string().regex(/^[A-Z]{3}$/),
      home_country: z.string().regex(/^[A-Z]{2}$/),
      other: z.string().regex(/^x$/),
    })
    const error = issuesOf(schema, { slug: 'A', base_currency: 'x', home_country: 'x', other: 'y' })
    const byField = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join('.'), validationKeyFor(issue).key]),
    )
    expect(byField).toEqual({
      slug: 'slugFormat',
      base_currency: 'currency',
      home_country: 'country',
      other: 'generic',
    })
  })

  it('maps an e-mail format failure to invalidEmail regardless of the field name', () => {
    const [issue] = issuesOf(z.object({ contact: z.email() }), { contact: 'nope' }).issues
    expect(validationKeyFor(issue!)).toEqual({ key: 'invalidEmail' })
  })

  it('maps invalid_value to invalidRole', () => {
    const [issue] = issuesOf(z.enum(['owner', 'viewer']), 'god').issues
    expect(validationKeyFor(issue!)).toEqual({ key: 'invalidRole' })
  })

  it('maps invalid_type (a field absent from the form data) to required', () => {
    const [missing] = issuesOf(z.object({ flag: z.boolean() }), {}).issues
    expect(validationKeyFor(missing!)).toEqual({ key: 'required' })
  })

  it('maps the legacy invalid_string code by field', () => {
    const legacy = {
      code: 'invalid_string',
      path: ['email'],
      message: '',
      input: 'x',
    } as unknown as z.core.$ZodIssue
    expect(validationKeyFor(legacy)).toEqual({ key: 'invalidEmail' })
  })
})

describe('fieldErrorsFrom', () => {
  it('returns one translated message per field, first issue wins', () => {
    const error = issuesOf(createOrganizationSchema, {
      name: '',
      slug: '',
      base_currency: 'sa',
      home_country: 'saudi',
      arabic_enabled: false,
    })
    expect(fieldErrorsFrom(error, t)).toEqual({
      fieldErrors: {
        name: 'required',
        slug: 'required',
        base_currency: 'currency',
        home_country: 'country',
      },
    })
  })

  it('passes ICU arguments through to the translator', () => {
    const error = issuesOf(createOrganizationSchema, {
      name: 'x'.repeat(201),
      slug: 'a'.repeat(65),
      base_currency: 'SAR',
      home_country: 'SA',
      arabic_enabled: true,
    })
    expect(fieldErrorsFrom(error, t).fieldErrors).toEqual({
      name: 'tooLong:max=200',
      slug: 'tooLong:max=64',
    })
  })

  it('handles the invitation form', () => {
    const error = issuesOf(inviteSchema, { email: 'bad', role: 'god' })
    expect(fieldErrorsFrom(error, t).fieldErrors).toEqual({
      email: 'invalidEmail',
      role: 'invalidRole',
    })
  })

  it('keeps form-level issues under _form', () => {
    const error = issuesOf(z.string().min(1), '')
    expect(fieldErrorsFrom(error, t)).toEqual({ fieldErrors: { _form: 'required' } })
  })

  it('treats absent fields as required (enum: choose a role)', () => {
    const error = issuesOf(inviteSchema, {})
    expect(fieldErrorsFrom(error, t).fieldErrors).toEqual({
      email: 'required',
      role: 'invalidRole',
    })
  })
})
