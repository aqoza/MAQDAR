import { z } from 'zod'
import { ROLES } from '../auth/roles'
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from './slug'

/**
 * Zod schemas for the organization, settings and invitation forms. Field names match the form
 * inputs and the RPC parameters (snake_case). Issues are translated through
 * `fieldErrorsFrom()` in src/lib/validation.ts, so no messages are attached here.
 *
 * Imports stay relative: Vitest resolves no `@/` alias.
 */
export const ORGANIZATION_NAME_MAX_LENGTH = 200

export const organizationNameSchema = z.string().trim().min(1).max(ORGANIZATION_NAME_MAX_LENGTH)

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN)

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/)

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/)

/** Trimmed and lower-cased before the format check, so "  Ali@Example.com " is accepted. */
export const emailSchema = z.string().trim().toLowerCase().min(1).pipe(z.email())

export const roleSchema = z.enum(ROLES)

export const organizationSettingsSchema = z.object({
  name: organizationNameSchema,
  base_currency: currencyCodeSchema,
  home_country: countryCodeSchema,
  arabic_enabled: z.boolean(),
})

export const createOrganizationSchema = organizationSettingsSchema.extend({
  slug: slugSchema,
})

export const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
})

export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type InviteInput = z.infer<typeof inviteSchema>
